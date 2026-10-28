/**
 * federation.ts — everything that talks to OTHER hosts.
 *
 * Extracted from kernel.ts so the router stays pure routing. This module
 * owns four concerns and nothing else:
 *
 *  1. Transport      — POST one envelope to a peer ingress (with link auth)
 *  2. Presence       — heartbeat sweep (sys.hello) + roster merge
 *  3. Discovery      — gossip host hints + well-known resolution (NHP 1.1)
 *  4. Redelivery     — store-and-forward drain with exponential backoff
 *
 * Liveness rule (single source of truth): EVERY successful/failed POST
 * goes through postAndTrack, which updates Host.status — no other place
 * may mark a peer online/unreachable.
 *
 * Scale model (why the caps/TTLs exist): each host only exchanges with its
 * OWN peers; a hello carries at most ROSTER_MAX nodes + GOSSIP_HOSTS_MAX
 * host hints, so payloads stay bounded no matter how large the network
 * grows. Learned entries expire (TTL sweep), and first contact with an
 * unknown-but-domain-shaped host resolves via /.well-known/nhp — the
 * same DNS-style discovery Matrix and ActivityPub use.
 */
import { timingSafeEqual } from 'node:crypto'
import type { Host } from '@prisma/client'
import {
  NHP_SYS,
  WELL_KNOWN_PATH,
  isValidEnvelope,
  makeEnvelope,
  type HelloPayload,
  type HostHint,
  type NhpEnvelope,
  type WellKnownDoc,
} from '../../src/core/nodehost/protocol'
import type { Kernel } from './kernel'
import {
  DIR_TTL_MS,
  GOSSIP_HOSTS_MAX,
  HOST_TTL_MS,
  MAX_SEND_ATTEMPTS,
  POST_TIMEOUT_MS,
  RESOLVE_COOLDOWN_MS,
  RESOLVE_TIMEOUT_MS,
  RETRY_BATCH,
  ROSTER_MAX,
  backoffDelayMs,
} from './config'
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
 * Second-hand knowledge hygiene: a hint that points at loopback is a
 * leftover of someone's local sandbox — importing it would poison the
 * directory with unroutable hosts (in the one-NodeHost-per-server
 * deployment model real peers never live on 127.0.0.1).
 */
const isLoopbackish = (address: string) =>
  address.includes('127.0.0.1') || address.includes('localhost')

/**
 * Can this host code be resolved by well-known lookup? Only domain-shaped
 * codes carry DNS meaning ("nodehost.example.com", "host.local:3013").
 * Bare sandbox codes ("alfa") are resolvable only through peering/gossip.
 */
export const isResolvableCode = (code: string) =>
  /^[a-z][a-z0-9+.-]*:\/\//i.test(code) || code.includes('.') || code.includes(':')

/** Build the well-known URL for a resolvable host code. */
export const wellKnownUrl = (code: string) => {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(code)) return `${code.replace(/\/+$/, '')}${WELL_KNOWN_PATH}`
  const scheme = isLoopbackish(code) ? 'http' : 'https'
  return `${scheme}://${code}${WELL_KNOWN_PATH}`
}

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
  /** hostCode -> earliest wall-clock time a failed resolve may be retried. */
  private resolveCooldown = new Map<string, number>()

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

  /**
   * Our own hello payload (roster + gossip hints) — sent as the ingress
   * hello response AND as the heartbeat body.
   */
  async selfHello(): Promise<HelloPayload> {
    return {
      host: {
        code: this.kernel.self.code,
        name: this.kernel.self.name,
        gwPort: this.kernel.self.gwPort,
        address: this.kernel.self.address,
      },
      nodes: await localRoster(this.kernel.adminOnline),
      hosts: await this.gossipHosts(),
    }
  }

  /**
   * The OTHER hosts we know — the peer-exchange part of hello. Capped and
   * freshest-first so the payload stays bounded at internet scale; loopback
   * addresses are stripped (second-hand loopback knowledge is always wrong).
   */
  private async gossipHosts(): Promise<HostHint[]> {
    const rows = await prisma.host.findMany({
      where: {
        kind: 'remote',
        code: { not: this.kernel.self.code },
        address: { not: { startsWith: 'unknown://' } },
      },
      orderBy: { lastSeen: 'desc' },
      take: GOSSIP_HOSTS_MAX,
      select: { code: true, name: true, address: true, gwPort: true },
    })
    return rows
      .filter((h) => !isLoopbackish(h.address))
      .map((h) => ({ code: h.code, name: h.name, address: h.address, gwPort: h.gwPort }))
  }

  /** One heartbeat sweep: hello to every known remote host, in parallel. */
  async heartbeatOnce() {
    const remotes = await prisma.host.findMany({ where: { kind: 'remote' } })
    if (!remotes.length) return
    const hello = makeEnvelope<HelloPayload>({
      type: NHP_SYS.HELLO,
      module: 'sys',
      from: { host: this.kernel.self.code, node: 'kernel' },
      to: { host: '*', node: 'kernel' },
      payload: await this.selfHello(),
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

  /**
   * Merge a peer's hello payload into Host + NetDirectory — BATCHED.
   * One read per hello, then createMany + parallel updateMany so a peer
   * with a 500-node roster costs a handful of round trips, not 500 upserts
   * (this is what keeps the merge O(1)-ish at scale).
   */
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

    const roster = (hello.nodes ?? []).slice(0, ROSTER_MAX)
    if (roster.length) {
      const existing = await prisma.netDirectory.findMany({
        where: { hostCode: h.code, nodeCode: { in: roster.map((n) => n.code) } },
        select: { nodeCode: true },
      })
      const known = new Set(existing.map((r) => r.nodeCode))
      const fresh = roster.filter((n) => !known.has(n.code))
      const now = new Date()
      if (fresh.length) {
        await prisma.netDirectory
          .createMany({
            data: fresh.map((n) => ({
              hostCode: h.code,
              nodeCode: n.code,
              nodeName: n.name,
              modules: JSON.stringify(n.modules ?? []),
              adminOnline: !!n.adminOnline,
              isDemo: !!n.isDemo,
              demoToken: n.demoToken ?? null,
              lastSeen: now,
            })),
          })
          .catch(async () => {
            // Concurrent merge raced us — fall back to per-row upserts.
            for (const n of fresh) {
              await prisma.netDirectory.upsert({
                where: { hostCode_nodeCode: { hostCode: h.code, nodeCode: n.code } },
                update: { lastSeen: now },
                create: {
                  hostCode: h.code,
                  nodeCode: n.code,
                  nodeName: n.name,
                  modules: JSON.stringify(n.modules ?? []),
                  adminOnline: !!n.adminOnline,
                  isDemo: !!n.isDemo,
                  demoToken: n.demoToken ?? null,
                  lastSeen: now,
                },
              })
            }
          })
      }
      await Promise.all(
        roster
          .filter((n) => known.has(n.code))
          .map((n) =>
            prisma.netDirectory.updateMany({
              where: { hostCode: h.code, nodeCode: n.code },
              data: {
                nodeName: n.name,
                modules: JSON.stringify(n.modules ?? []),
                adminOnline: !!n.adminOnline,
                isDemo: !!n.isDemo,
                demoToken: n.demoToken ?? null,
                lastSeen: now,
              },
            }),
          ),
      )
    }

    // NHP 1.1 gossip: import the peer's view of OTHER hosts (create-only —
    // we never overwrite what we already know, and liveness stays the
    // exclusive job of postAndTrack).
    await this.mergeHostHints(hello.host.code, hello.hosts ?? [])
  }

  /** Import second-hand host hints as status=unknown rows (never overwrite). */
  private async mergeHostHints(fromHost: string, hints: HostHint[]) {
    for (const hint of hints.slice(0, GOSSIP_HOSTS_MAX)) {
      const code = String(hint?.code ?? '').trim()
      if (!code || code === this.kernel.self.code || code === fromHost) continue
      const address = String(hint.address ?? '').trim()
      // Loopback knowledge is always second-hand garbage — skip it.
      if (address && isLoopbackish(address)) continue
      try {
        const existing = await prisma.host.findUnique({ where: { code } })
        if (!existing) {
          await prisma.host.create({
            data: {
              code,
              name: String(hint.name ?? '').trim() || code,
              address: address || `unknown://${code}`,
              gwPort: hint.gwPort ?? null,
              kind: 'remote',
              status: 'unknown',
              // Knowledge age — if this peer never becomes reachable the
              // TTL sweep drops it instead of hoarding ghosts forever.
              lastSeen: new Date(),
            },
          })
          await log('info', 'host', `host "${code}" discovered via gossip from "${fromHost}"`)
        } else if (existing.address.startsWith('unknown://') && address) {
          // We knew the name, now we finally have a usable address.
          await prisma.host.update({ where: { code }, data: { address } })
        }
      } catch {
        // Concurrent hint import raced us — next heartbeat will reconcile.
      }
    }
  }

  // ----------------------------------------------------------
  // Discovery (NHP 1.1) — well-known resolution
  // ----------------------------------------------------------

  /**
   * Resolve a host code to a routable Host row, lazily:
   *  1. known row with a real address -> return it
   *  2. domain-shaped code -> fetch /.well-known/nhp and adopt the peer
   *  3. otherwise null (the caller rejects; queued rows retry later)
   * Failed lookups cool down so a dead domain costs at most one probe per
   * RESOLVE_COOLDOWN_MS even under a queue drain storm.
   */
  async resolveHost(code: string): Promise<Host | null> {
    const row = await prisma.host.findUnique({ where: { code } })
    if (row && !row.address.startsWith('unknown://')) return row
    if (!isResolvableCode(code)) return null
    const cooldownUntil = this.resolveCooldown.get(code) ?? 0
    if (Date.now() < cooldownUntil) return null

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), RESOLVE_TIMEOUT_MS)
    try {
      const res = await fetch(wellKnownUrl(code), { signal: ctrl.signal })
      clearTimeout(timer)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const doc = (await res.json()) as WellKnownDoc
      const ingress = String(doc?.host?.ingress ?? '').trim()
      if (doc?.nhp !== 1 || !doc?.host?.code || !ingress) throw new Error('bad well-known doc')
      if (doc.host.code !== code) throw new Error(`code mismatch: doc says "${doc.host.code}"`)
      const upserted = await prisma.host.upsert({
        where: { code },
        update: {
          name: doc.host.name || code,
          address: ingress,
          ...(doc.host.gwPort != null ? { gwPort: doc.host.gwPort } : {}),
          kind: 'remote',
        },
        create: {
          code,
          name: doc.host.name || code,
          address: ingress,
          gwPort: doc.host.gwPort ?? null,
          kind: 'remote',
          status: 'unknown',
          lastSeen: new Date(),
        },
      })
      this.resolveCooldown.delete(code)
      await log('info', 'host', `host "${code}" resolved via well-known -> ${ingress}`)
      return upserted
    } catch (err) {
      clearTimeout(timer)
      this.resolveCooldown.set(code, Date.now() + RESOLVE_COOLDOWN_MS)
      await log('warn', 'host', `well-known resolution failed for "${code}"`, {
        error: String(err).replace(/^Error:\s*/, ''),
      })
      return null
    }
  }

  // ----------------------------------------------------------
  // TTL sweep — learned entries expire
  // ----------------------------------------------------------

  /**
   * Drop stale knowledge so the directory self-heals instead of growing
   * forever: roster rows unseen for DIR_TTL_MS and remote hosts last seen
   * (successfully contacted) before HOST_TTL_MS. The local host is never
   * touched. Returns the number of deleted entries (logged by the caller).
   */
  async expireDirectory(now = Date.now()): Promise<{ nodes: number; hosts: number }> {
    const staleNodes = await prisma.netDirectory.deleteMany({
      where: { lastSeen: { lt: new Date(now - DIR_TTL_MS) } },
    })
    const deadHosts = await prisma.host.findMany({
      where: {
        kind: 'remote',
        lastSeen: { lt: new Date(now - HOST_TTL_MS) },
      },
      select: { code: true },
    })
    if (deadHosts.length) {
      await prisma.host.deleteMany({ where: { code: { in: deadHosts.map((h) => h.code) } } })
      await prisma.netDirectory.deleteMany({
        where: { hostCode: { in: deadHosts.map((h) => h.code) } },
      })
    }
    return { nodes: staleNodes.count, hosts: deadHosts.length }
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
