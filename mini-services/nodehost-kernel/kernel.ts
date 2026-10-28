/**
 * kernel.ts — THE NodeHost kernel (routing brain).
 *
 * Responsibilities:
 *  - Route NHP envelopes (local dispatch / federation forward)
 *  - Correlated request/response for modules (ctx.request, replyTo)
 *  - Admin socket sessions (delegated to adminSocket.ts)
 *  - Module runtime ownership (runtime.ts)
 *
 * Everything that talks to OTHER hosts (transport, heartbeat, retry)
 * lives in federation.ts; envelope persistence lives in mailbox.ts;
 * tunables in config.ts. This file stays the routing brain only.
 */
import type { Server as SocketIOServer } from 'socket.io'
import type { Socket } from 'socket.io'
import {
  NHP_SYS,
  NHP_WILDCARD,
  isValidEnvelope,
  makeEnvelope,
  type HelloPayload,
  type NhpAddress,
  type NhpEnvelope,
  type RouteOutcome,
} from '../../src/core/nodehost/protocol'
import type { IDirectoryEntry, ModuleRegistration } from '../../src/core/nodehost/interfaces'
import { bindAdminSocket as bindAdminSocketHandlers, adminRoom } from './adminSocket'
import { HEARTBEAT_MS, REQUEST_TIMEOUT_MS, RETRY_SWEEP_MS } from './config'
import { Federation } from './federation'
import { alreadyDelivered, recordInbound, recordOutbound } from './mailbox'
import { ModuleRuntime } from './runtime'
import { log, prisma } from './store'

type RouteSource = 'local' | 'ingress' | 'module' | 'retry'

interface ReplyWaiter {
  resolve: (env: NhpEnvelope) => void
  timer: NodeJS.Timeout
}

export interface RequestResult {
  ok: boolean
  reply?: NhpEnvelope
  error?: string
}

export class Kernel {
  /** Loaded module implementations (built-ins + future third-party). */
  readonly registry = new Map<string, ModuleRegistration>()
  runtime!: ModuleRuntime
  federation!: Federation

  /** This host's identity row. */
  self!: { id: string; code: string; name: string; address: string; gwPort: number | null }

  /** nodeCode set of currently connected admins. */
  adminOnline = new Set<string>()

  /** env.id of open ctx.request() calls -> reply waiter. */
  private pending = new Map<string, ReplyWaiter>()

  private io!: SocketIOServer
  private bootedAt = Date.now()
  private loops: NodeJS.Timeout[] = []
  /** False until boot() completes — ingress replies 503 (retryable) meanwhile. */
  isBooted = false

  registerModule(reg: ModuleRegistration) {
    this.registry.set(reg.meta.id, reg)
  }

  attachIo(io: SocketIOServer) {
    this.io = io
  }

  // ----------------------------------------------------------
  // Boot
  // ----------------------------------------------------------

  async boot() {
    const { ensureSeed } = await import('./store')
    this.self = await ensureSeed(this.registry)
    this.federation = new Federation(this)
    this.runtime = new ModuleRuntime(this, this.registry)
    await this.runtime.syncAll()
    await log('info', 'kernel', `NodeHost "${this.self.name}" booted`, {
      code: this.self.code,
      modules: [...this.registry.keys()],
    })
    await this.heartbeatOnce() // immediate first contact
    this.loops.push(setInterval(() => void this.heartbeatOnce(), HEARTBEAT_MS))
    this.loops.push(setInterval(() => void this.federation.retryQueued(), RETRY_SWEEP_MS))
    this.isBooted = true
  }

  shutdown() {
    for (const t of this.loops) clearInterval(t)
    for (const w of this.pending.values()) clearTimeout(w.timer)
    this.pending.clear()
  }

  /** Presence sweep delegate (admin socket + REST trigger points). */
  heartbeatOnce() {
    return this.federation.heartbeatOnce()
  }

  // ----------------------------------------------------------
  // Routing
  // ----------------------------------------------------------

  /**
   * The single entry point of every envelope on this host.
   * source: local (admin/module send) | ingress (remote kernel) |
   *         module (module reply) | retry (store-and-forward)
   */
  async route(env: NhpEnvelope, source: RouteSource): Promise<RouteOutcome> {
    if (!isValidEnvelope(env) || env.from.node === '*') {
      await log('warn', 'router', 'rejected invalid envelope', { source })
      return 'rejected'
    }
    if (env.ttl <= 0) {
      await log('warn', 'router', `envelope ${env.id} dropped (ttl exhausted)`)
      return 'rejected'
    }

    const isSelf = env.to.host === this.self.code
    const isWildcard = env.to.host === NHP_WILDCARD

    // Correlated replies resolve ctx.request() waiters; the envelope
    // still flows through normal delivery below (mailbox + dispatch).
    if (isSelf || isWildcard) this.resolvePending(env)

    // Local part
    let localOutcome: RouteOutcome | null = null
    if (isSelf || (isWildcard && source === 'local')) {
      localOutcome = await this.deliverLocal(env)
    }

    // Federation part
    if (isSelf) return localOutcome ?? 'delivered'

    if (isWildcard) {
      const remotes = await prisma.host.findMany({ where: { kind: 'remote' } })
      if (!remotes.length) return localOutcome ?? 'rejected'
      const results = await Promise.all(
        remotes.map((h) =>
          this.forwardRemote({ ...env, to: { host: h.code, node: env.to.node } }),
        ),
      )
      return results.includes('queued') ? 'queued' : 'forwarded'
    }

    // Concrete remote host (also handles multi-hop forwarded traffic)
    return await this.forwardRemote(env)
  }

  /** Deliver to local node(s). Persists the mailbox row per target. */
  private async deliverLocal(env: NhpEnvelope): Promise<RouteOutcome> {
    if (env.module === 'sys') return await this.handleSys(env)

    const senderIsLocal = env.from.host === this.self.code

    let targets: { code: string; adminOn: boolean }[] = []
    if (env.to.node === NHP_WILDCARD) {
      const nodes = await prisma.node.findMany({
        where: { status: 'active', moduleStates: { some: { moduleId: env.module, enabled: true } } },
      })
      targets = nodes
        .filter((n) => !(senderIsLocal && n.code === env.from.node))
        .map((n) => ({ code: n.code, adminOn: this.adminOnline.has(n.code) }))
    } else {
      const node = await prisma.node.findUnique({ where: { code: env.to.node } })
      if (!node) {
        await log('warn', 'router', `unknown local node "${env.to.node}"`, { env: env.id })
        return 'rejected'
      }
      targets = [{ code: node.code, adminOn: this.adminOnline.has(node.code) }]
    }

    if (!targets.length) {
      await log('warn', 'router', `no local target for ${env.module}`, { env: env.id })
      return 'rejected'
    }

    let delivered = false
    for (const t of targets) {
      if (!this.runtime.isEnabled(t.code, env.module)) {
        await log('warn', 'router', `module "${env.module}" disabled on ${t.code} — dropped`, {
          env: env.id,
        })
        continue
      }
      // Idempotent delivery: skip if this envelope already reached the node
      // (guards against at-least-once retries creating duplicate side-effects)
      if (await alreadyDelivered(env.id, t.code, env.module)) continue

      await recordInbound(env, { toNode: t.code, adminOnline: t.adminOn, senderIsLocal })
      if (t.adminOn) {
        this.io.to(adminRoom(t.code)).emit('nhp:in', env)
        delivered = true
      }
      await this.runtime.dispatch(env)
    }
    return delivered ? 'delivered' : 'queued'
  }

  /** Forward an envelope to a remote host over HTTP. Queues on failure. */
  private async forwardRemote(
    env: NhpEnvelope,
    existingRowId?: string,
  ): Promise<RouteOutcome> {
    const host = await prisma.host.findUnique({ where: { code: env.to.host } })
    if (!host) {
      await log('warn', 'router', `unknown host "${env.to.host}" — cannot route`, { env: env.id })
      return 'rejected'
    }

    const res = await this.federation.postAndTrack(host, env)

    if (res.ok) {
      await recordOutbound(env, 'forwarded', { existingRowId })
      return 'forwarded'
    }

    // Temporary failure → store-and-forward (nodes never go offline)
    await recordOutbound(env, 'queued', { existingRowId, error: res.error })
    await log('warn', 'router', `host "${host.code}" unreachable — envelope queued`, {
      env: env.id,
      error: res.error,
    })
    return 'queued'
  }

  // ----------------------------------------------------------
  // System layer (hello / ack)
  // ----------------------------------------------------------

  private async handleSys(env: NhpEnvelope): Promise<RouteOutcome> {
    if (env.type === NHP_SYS.HELLO) {
      const p = env.payload as HelloPayload
      if (p?.host?.code) await this.federation.mergeHello(p)
      return 'delivered'
    }
    // sys.ack / sys.error → into the target node's mailbox + admin socket
    const node = await prisma.node.findUnique({ where: { code: env.to.node } })
    if (!node) return 'rejected'
    const adminOn = this.adminOnline.has(node.code)
    await recordInbound(env, {
      toNode: node.code,
      adminOnline: adminOn,
      senderIsLocal: env.from.host === this.self.code,
    })
    if (adminOn) this.io.to(adminRoom(node.code)).emit('nhp:in', env)
    return 'delivered'
  }

  // ----------------------------------------------------------
  // Correlated request/response (ctx.request)
  // ----------------------------------------------------------

  /** Wake the waiter of the request this envelope replies to (if any). */
  private resolvePending(env: NhpEnvelope) {
    if (!env.replyTo) return
    this.pending.get(env.replyTo)?.resolve(env)
  }

  private cancelReplyWaiter(envId: string) {
    const w = this.pending.get(envId)
    if (!w) return
    clearTimeout(w.timer)
    this.pending.delete(envId)
  }

  private awaitReply(envId: string, timeoutMs: number): Promise<NhpEnvelope> {
    return new Promise<NhpEnvelope>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(envId)
        reject(new Error(`no reply within ${timeoutMs}ms`))
      }, timeoutMs)
      this.pending.set(envId, {
        resolve: (reply) => {
          clearTimeout(timer)
          this.pending.delete(envId)
          resolve(reply)
        },
        timer,
      })
    })
  }

  // ----------------------------------------------------------
  // API used by module contexts
  // ----------------------------------------------------------

  async sendFromNode(
    from: NhpAddress,
    to: NhpAddress,
    module: string,
    type: string,
    payload: unknown,
  ) {
    const env = makeEnvelope({ type, module, from, to, payload })
    const outcome = await this.route(env, 'module')
    return { envId: env.id, outcome }
  }

  /**
   * Send and await the correlated reply envelope (matched via replyTo).
   * Used by INodeContext.request — the module-level RPC primitive.
   */
  async requestFromNode(
    from: NhpAddress,
    to: NhpAddress,
    module: string,
    type: string,
    payload: unknown,
    opts?: { timeoutMs?: number },
  ): Promise<RequestResult> {
    const env = makeEnvelope({ type, module, from, to, payload })
    const wait = this.awaitReply(env.id, opts?.timeoutMs ?? REQUEST_TIMEOUT_MS)
    const outcome = await this.route(env, 'module')
    if (outcome === 'rejected') {
      this.cancelReplyWaiter(env.id)
      return { ok: false, error: 'request rejected by the local router' }
    }
    try {
      return { ok: true, reply: await wait }
    } catch (err) {
      return { ok: false, error: String(err).replace(/^Error:\s*/, '') }
    }
  }

  async broadcastFromNode(
    from: NhpAddress,
    module: string,
    type: string,
    payload: unknown,
  ): Promise<number> {
    const nodes = await prisma.node.findMany({
      where: {
        status: 'active',
        code: { not: from.node },
        moduleStates: { some: { moduleId: module, enabled: true } },
      },
    })
    const localOutcomes = await Promise.all(
      nodes.map(async (n) => {
        const env = makeEnvelope({
          type,
          module,
          from,
          to: { host: this.self.code, node: n.code },
          payload,
        })
        return this.route(env, 'module')
      }),
    )
    const remotes = await prisma.host.findMany({ where: { kind: 'remote' } })
    const remoteOutcomes = await Promise.all(
      remotes.map(async (h) => {
        const env = makeEnvelope({
          type,
          module,
          from,
          to: { host: h.code, node: NHP_WILDCARD },
          payload,
        })
        return this.forwardRemote(env)
      }),
    )
    return [...localOutcomes, ...remoteOutcomes].filter((o) => o !== 'rejected').length
  }

  async getDirectory(): Promise<IDirectoryEntry[]> {
    const locals = await prisma.node.findMany({
      where: { status: 'active' },
      include: { moduleStates: { where: { enabled: true } }, host: true },
    })
    const remoteRows = await prisma.netDirectory.findMany()
    const entries: IDirectoryEntry[] = [
      ...locals.map((n) => ({
        hostCode: n.host.code,
        hostName: n.host.name,
        nodeCode: n.code,
        nodeName: n.name,
        modules: n.moduleStates.map((s) => s.moduleId),
        adminOnline: this.adminOnline.has(n.code),
      })),
      ...remoteRows.map((r) => ({
        hostCode: r.hostCode,
        nodeCode: r.nodeCode,
        nodeName: r.nodeName,
        modules: JSON.parse(r.modules) as string[],
        adminOnline: r.adminOnline,
        isDemo: r.isDemo,
        ...(r.isDemo && r.demoToken ? { demoToken: r.demoToken } : {}),
      })),
    ]
    return entries.sort(
      (a, b) => a.hostCode.localeCompare(b.hostCode) || a.nodeCode.localeCompare(b.nodeCode),
    )
  }

  // ----------------------------------------------------------
  // Admin socket sessions (wire protocol in adminSocket.ts)
  // ----------------------------------------------------------

  bindAdminSocket(socket: Socket) {
    bindAdminSocketHandlers(this, socket)
  }

  stats() {
    return {
      hostCode: this.self.code,
      hostName: this.self.name,
      uptimeSec: Math.round((Date.now() - this.bootedAt) / 1000),
      adminsOnline: this.adminOnline.size,
      modulesLoaded: [...this.registry.keys()],
    }
  }
}
