/**
 * federation.ts — everything that talks to OTHER hosts.
 *
 * Extracted from kernel.ts so the router stays pure routing. This module
 * owns three concerns and nothing else:
 *
 *  1. Transport      — POST one envelope to a peer ingress (with link auth)
 *  2. Presence       — heartbeat sweep (sys.hello) + roster merge
 *  3. Redelivery     — store-and-forward drain with exponential backoff
 *
 * Liveness rule (single source of truth): EVERY successful/failed POST
 * goes through postAndTrack, which updates Host.status — no other place
 * may mark a peer online/unreachable.
 */
import { timingSafeEqual } from 'node:crypto'
import {
  NHP_SYS,
  isValidEnvelope,
  makeEnvelope,
  type HelloPayload,
  type NhpEnvelope,
} from '../../src/core/nodehost/protocol'
import type { Kernel } from './kernel'
import { MAX_SEND_ATTEMPTS, POST_TIMEOUT_MS, RETRY_BATCH, backoffDelayMs } from './config'
import {
  bumpRowAttempt,
  markRowDead,
  markRowForwarded,
  recordOutbound,
} from './mailbox'
import { ENV, localRoster, log, prisma } from './store'

/** Row of the Host table (subset the federation layer touches). */
export interface PeerHost {
  id: string
  code: string
  address: string
  status?: string
}

export type PostResult = { ok: boolean; error: string; hello?: HelloPayload }

/** Header value sent to peers when NHP_LINK_SECRET is configured. */
export const linkAuthHeader = () =>
  ENV.linkSecret ? `Bearer ${ENV.linkSecret}` : ''

/**
 * Verify an inbound Authorization header against the configured secret.
 * Open mode (no secret configured) always accepts — legacy deployments
 * keep working until both sides opt in.
 */
export function verifyIngressAuth(header: string | null): boolean {
  if (!ENV.linkSecret) return true
  const expected = `Bearer ${ENV.linkSecret}`
  return timingSafeEqualStr(header ?? '', expected)
}

/**
 * Length-safe, constant-time string comparison for link secrets.
 * Falls back to a deterministic length check when lengths differ
 * (early exit on length is acceptable — it leaks length only).
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) {
    // Burn equivalent time so the caller cannot measure length precisely.
    timingSafeEqual(ab, ab)
    return false
  }
  return timingSafeEqual(ab, bb)
}

export class Federation {
  /** rowId -> earliest wall-clock time the row may be retried again. */
  private nextAttemptAt = new Map<string, number>()

  constructor(private kernel: Kernel) {}

  // ----------------------------------------------------------
  // Transport
  // ----------------------------------------------------------

  /** POST one envelope to a peer's ingress; update peer liveness. */
  async postAndTrack(host: PeerHost, env: NhpEnvelope): Promise<PostResult> {
    const res = await this.postEnvelope(host.address, env)
    if (res.ok) {
      if (res.hello) await this.mergeHello(res.hello)
      await prisma.host.update({
        where: { id: host.id },
        data: { status: 'online', lastSeen: new Date() },
      })
    } else {
      await prisma.host
        .update({ where: { id: host.id }, data: { status: 'unreachable' } })
        .catch(() => {})
    }
    return res
  }

  private async postEnvelope(address: string, env: NhpEnvelope): Promise<PostResult> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), POST_TIMEOUT_MS)
    try {
      const auth = linkAuthHeader()
      const res = await fetch(address, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(auth ? { authorization: auth } : {}),
        },
        body: JSON.stringify(env),
        signal: ctrl.signal,
      })
      clearTimeout(timer)
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        hello?: HelloPayload
        error?: string
      }
      if (!res.ok || body.ok === false) {
        return { ok: false, error: body.error ?? `HTTP ${res.status}` }
      }
      return { ok: true, error: '', ...(body.hello ? { hello: body.hello } : {}) }
    } catch (err) {
      clearTimeout(timer)
      return { ok: false, error: String(err).replace(/^Error:\s*/, '') }
    }
  }

  // ----------------------------------------------------------
  // Presence (hello / roster merge)
  // ----------------------------------------------------------

  /** Merge a peer's hello payload into Host + NetDirectory. */
  async mergeHello(hello: HelloPayload) {
    if (!hello?.host?.code) return
    const h = hello.host
    await prisma.host.upsert({
      where: { code: h.code },
      update: {
        name: h.name,
        ...(h.address ? { address: h.address } : {}),
        ...(h.gwPort != null ? { gwPort: h.gwPort } : {}),
        kind: 'remote',
        status: 'online',
        lastSeen: new Date(),
      },
      create: {
        code: h.code,
        name: h.name,
        address: h.address ?? `unknown://${h.code}`,
        gwPort: h.gwPort ?? null,
        kind: 'remote',
        status: 'online',
        lastSeen: new Date(),
      },
    })
    for (const n of hello.nodes ?? []) {
      await prisma.netDirectory.upsert({
        where: { hostCode_nodeCode: { hostCode: h.code, nodeCode: n.code } },
        update: {
          nodeName: n.name,
          modules: JSON.stringify(n.modules ?? []),
          adminOnline: !!n.adminOnline,
          isDemo: !!n.isDemo,
          demoToken: n.demoToken ?? null,
          lastSeen: new Date(),
        },
        create: {
          hostCode: h.code,
          nodeCode: n.code,
          nodeName: n.name,
          modules: JSON.stringify(n.modules ?? []),
          adminOnline: !!n.adminOnline,
          isDemo: !!n.isDemo,
          demoToken: n.demoToken ?? null,
          lastSeen: new Date(),
        },
      })
    }
  }

  /** Our own hello payload (roster) — sent as the ingress hello response. */
  async selfHello(): Promise<HelloPayload> {
    return {
      host: {
        code: this.kernel.self.code,
        name: this.kernel.self.name,
        gwPort: this.kernel.self.gwPort,
        address: this.kernel.self.address,
      },
      nodes: await localRoster(this.kernel.adminOnline),
    }
  }

  /** One heartbeat sweep: hello to every known remote host, in parallel. */
  async heartbeatOnce() {
    const remotes = await prisma.host.findMany({ where: { kind: 'remote' } })
    if (!remotes.length) return
    const roster = await localRoster(this.kernel.adminOnline)
    const hello = makeEnvelope<HelloPayload>({
      type: NHP_SYS.HELLO,
      module: 'sys',
      from: { host: this.kernel.self.code, node: 'kernel' },
      to: { host: '*', node: 'kernel' },
      payload: {
        host: {
          code: this.kernel.self.code,
          name: this.kernel.self.name,
          gwPort: this.kernel.self.gwPort,
          address: this.kernel.self.address,
        },
        nodes: roster,
      },
    })

    await Promise.all(
      remotes.map(async (h) => {
        const res = await this.postAndTrack(h, { ...hello, to: { host: h.code, node: 'kernel' } })
        if (res.ok) {
          if (h.status !== 'online') {
            await log('info', 'host', `peer "${h.code}" is online`)
          }
        } else if (h.status !== 'unreachable') {
          await log('warn', 'host', `peer "${h.code}" unreachable (temporary)`, {
            error: res.error,
          })
        }
      }),
    )
  }

  // ----------------------------------------------------------
  // Redelivery (store-and-forward with exponential backoff)
  // ----------------------------------------------------------

  /**
   * Drain queued outbound envelopes with per-row exponential backoff.
   * Backoff state lives in memory (rowId -> nextAttemptAt) so the Prisma
   * schema stays untouched; a kernel restart simply forgets delays, which
   * is safe (one immediate retry per queued row).
   */
  async retryQueued() {
    const rows = await prisma.nhpMessage.findMany({
      where: {
        status: 'queued',
        channel: 'remote',
        direction: 'out',
        attempts: { lt: MAX_SEND_ATTEMPTS },
      },
      take: RETRY_BATCH,
    })
    const now = Date.now()
    const due = rows.filter((r) => (this.nextAttemptAt.get(r.id) ?? 0) <= now)
    if (rows.length) {
      console.log(
        `[retry] drain sweep: ${due.length}/${rows.length} due (backoff defers the rest)`,
      )
    }
    for (const row of due) {
      try {
        const env = JSON.parse(row.envelope) as NhpEnvelope
        if (!isValidEnvelope(env)) {
          await this.settle(row.id)
          await markRowDead(row.id, 'corrupt envelope in queue')
          continue
        }
        const host = await prisma.host.findUnique({ where: { code: env.to.host } })
        if (!host) {
          await this.settle(row.id)
          await markRowDead(row.id, 'host vanished from registry')
          continue
        }
        const res = await this.postAndTrack(host, env)
        if (res.ok) {
          this.settle(row.id)
          await markRowForwarded(row.id)
          await log('info', 'router', `queued envelope ${row.envId} delivered after retry`)
        } else {
          const attempts = row.attempts + 1
          const verdict = await bumpRowAttempt(
            row.id,
            row.attempts,
            MAX_SEND_ATTEMPTS,
            res.error,
          )
          if (verdict === 'dead') {
            this.settle(row.id)
            await log('error', 'router', `envelope ${row.envId} dead-lettered`, {
              to: env.to,
            })
          } else {
            // Exponential backoff: 7s → 14s → 28s → 56s → 112s (capped).
            this.nextAttemptAt.set(row.id, Date.now() + backoffDelayMs(attempts))
          }
        }
      } catch (err) {
        this.settle(row.id)
        await markRowDead(row.id, String(err))
      }
    }
  }

  /** Forget the backoff entry of a row that left the queue. */
  private settle(rowId: string) {
    this.nextAttemptAt.delete(rowId)
  }
}
