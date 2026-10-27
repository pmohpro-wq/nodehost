/**
 * kernel.ts — THE NodeHost kernel.
 *
 * Responsibilities:
 *  - Route NHP envelopes (local dispatch / federation forward)
 *  - Store-and-forward: nodes never go offline; temporary failures queue
 *  - Heartbeat federation (sys.hello + roster exchange)
 *  - Admin socket sessions (admins connect ONLY to their own node)
 *  - Module runtime ownership
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
  type RosterEntry,
} from '../../src/core/nodehost/protocol'
import type { IDirectoryEntry, ModuleRegistration } from '../../src/core/nodehost/interfaces'
import { ModuleRuntime } from './runtime'
import { ENV, localRoster, log, prisma } from './store'

type RouteSource = 'local' | 'ingress' | 'module' | 'retry'

const ROOM = (nodeCode: string) => `node:${nodeCode}`

export class Kernel {
  /** Loaded module implementations (built-ins + future third-party). */
  readonly registry = new Map<string, ModuleRegistration>()
  runtime!: ModuleRuntime

  /** This host's identity row. */
  self!: { id: string; code: string; name: string; address: string; gwPort: number | null }

  /** nodeCode set of currently connected admins. */
  adminOnline = new Set<string>()

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
    this.runtime = new ModuleRuntime(this, this.registry)
    await this.runtime.syncAll()
    await log('info', 'kernel', `NodeHost "${this.self.name}" booted`, {
      code: this.self.code,
      modules: [...this.registry.keys()],
    })
    await this.heartbeatOnce() // immediate first contact
    this.loops.push(setInterval(() => void this.heartbeatOnce(), 8000))
    this.loops.push(setInterval(() => void this.retryQueued(), 7000))
    this.isBooted = true
  }

  shutdown() {
    for (const t of this.loops) clearInterval(t)
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

    // Local part
    let localOutcome: RouteOutcome | null = null
    if (isSelf || (isWildcard && source === 'local')) {
      localOutcome = await this.deliverLocal(env)
    }

    // Federation part
    if (isSelf) return localOutcome ?? 'delivered'

    if (isWildcard) {
      const remotes = await prisma.host.findMany({ where: { kind: 'remote' } })
      const results: RouteOutcome[] = []
      for (const h of remotes) {
        const copy: NhpEnvelope = { ...env, to: { host: h.code, node: env.to.node } }
        results.push(await this.forwardRemote(copy))
      }
      if (!results.length) return localOutcome ?? 'rejected'
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
      const enabled = this.runtime.isEnabled(t.code, env.module)
      if (!enabled) {
        await log('warn', 'router', `module "${env.module}" disabled on ${t.code} — dropped`, {
          env: env.id,
        })
        continue
      }
      // Idempotent delivery: skip if this envelope already reached the node
      // (guards against at-least-once retries creating duplicate side-effects)
      const dup = await prisma.nhpMessage.findFirst({
        where: { envId: env.id, toNode: t.code, direction: 'in', module: env.module },
        select: { id: true },
      })
      if (dup) continue
      const rowStatus = t.adminOn ? 'delivered' : 'queued'
      await prisma.nhpMessage.create({
        data: {
          envId: env.id,
          channel: senderIsLocal ? 'local' : 'remote',
          direction: 'in',
          module: env.module,
          type: env.type,
          fromHost: env.from.host,
          fromNode: env.from.node,
          toHost: this.self.code,
          toNode: t.code,
          payload: JSON.stringify(env.payload ?? {}),
          envelope: JSON.stringify(env),
          status: rowStatus,
          deliveredAt: t.adminOn ? new Date() : null,
        },
      })
      if (t.adminOn) {
        this.io.to(ROOM(t.code)).emit('nhp:in', env)
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

    const outcome = await this.postEnvelope(host.address, env)

    if (outcome.ok) {
      if (outcome.hello) await this.mergeHello(outcome.hello)
      await prisma.host.update({
        where: { id: host.id },
        data: { status: 'online', lastSeen: new Date() },
      })
      const data = {
        status: 'forwarded',
        attempts: existingRowId ? undefined : 1,
        error: null,
        deliveredAt: new Date(),
      } as Record<string, unknown>
      if (existingRowId) {
        await prisma.nhpMessage.update({ where: { id: existingRowId }, data })
      } else {
        await prisma.nhpMessage.create({
          data: {
            envId: env.id,
            channel: 'remote',
            direction: 'out',
            module: env.module,
            type: env.type,
            fromHost: env.from.host,
            fromNode: env.from.node,
            toHost: env.to.host,
            toNode: env.to.node,
            payload: JSON.stringify(env.payload ?? {}),
            envelope: JSON.stringify(env),
            status: 'forwarded',
            attempts: 1,
            deliveredAt: new Date(),
          },
        })
      }
      return 'forwarded'
    }

    // Temporary failure → store-and-forward (nodes never go offline)
    if (existingRowId) {
      await prisma.nhpMessage.update({
        where: { id: existingRowId },
        data: { status: 'queued', error: outcome.error.slice(0, 500) },
      })
    } else {
      await prisma.nhpMessage.create({
        data: {
          envId: env.id,
          channel: 'remote',
          direction: 'out',
          module: env.module,
          type: env.type,
          fromHost: env.from.host,
          fromNode: env.from.node,
          toHost: env.to.host,
          toNode: env.to.node,
          payload: JSON.stringify(env.payload ?? {}),
          envelope: JSON.stringify(env),
          status: 'queued',
          attempts: 1,
          error: outcome.error.slice(0, 500),
        },
      })
    }
    await log('warn', 'router', `host "${host.code}" unreachable — envelope queued`, {
      env: env.id,
      error: outcome.error,
    })
    return 'queued'
  }

  // ----------------------------------------------------------
  // System layer (hello / ack)
  // ----------------------------------------------------------

  private async handleSys(env: NhpEnvelope): Promise<RouteOutcome> {
    if (env.type === NHP_SYS.HELLO) {
      const p = env.payload as HelloPayload
      if (p?.host?.code) await this.mergeHello({ ...p, host: { ...p.host } })
      return 'delivered'
    }
    // sys.ack / sys.error → into the target node's mailbox + admin socket
    const node = await prisma.node.findUnique({ where: { code: env.to.node } })
    if (!node) return 'rejected'
    const adminOn = this.adminOnline.has(node.code)
    await prisma.nhpMessage.create({
      data: {
        envId: env.id,
        channel: env.from.host === this.self.code ? 'local' : 'remote',
        direction: 'in',
        module: 'sys',
        type: env.type,
        fromHost: env.from.host,
        fromNode: env.from.node,
        toHost: this.self.code,
        toNode: node.code,
        payload: JSON.stringify(env.payload ?? {}),
        envelope: JSON.stringify(env),
        status: adminOn ? 'delivered' : 'queued',
        deliveredAt: adminOn ? new Date() : null,
      },
    })
    if (adminOn) this.io.to(ROOM(node.code)).emit('nhp:in', env)
    return 'delivered'
  }

  /** Merge a peer's hello payload into Host + NetDirectory. */
  private async mergeHello(hello: HelloPayload) {
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

  // ----------------------------------------------------------
  // Federation loops
  // ----------------------------------------------------------

  /** One heartbeat sweep: hello to every known remote host. */
  async heartbeatOnce() {
    const remotes = await prisma.host.findMany({ where: { kind: 'remote' } })
    if (!remotes.length) return
    const roster = await localRoster(this.adminOnline)
    const hello = makeEnvelope<HelloPayload>({
      type: NHP_SYS.HELLO,
      module: 'sys',
      from: { host: this.self.code, node: 'kernel' },
      to: { host: '*', node: 'kernel' },
      payload: {
        host: {
          code: this.self.code,
          name: this.self.name,
          gwPort: this.self.gwPort,
          address: this.self.address,
        },
        nodes: roster,
      },
    })

    for (const h of remotes) {
      const res = await this.postEnvelope(h.address, { ...hello, to: { host: h.code, node: 'kernel' } })
      if (res.ok) {
        if (res.hello) await this.mergeHello(res.hello)
        if (h.status !== 'online') {
          await log('info', 'host', `peer "${h.code}" is online`)
        }
        await prisma.host.update({
          where: { id: h.id },
          data: { status: 'online', lastSeen: new Date() },
        })
      } else {
        if (h.status !== 'unreachable') {
          await log('warn', 'host', `peer "${h.code}" unreachable (temporary)`, {
            error: res.error,
          })
        }
        await prisma.host.update({
          where: { id: h.id },
          data: { status: 'unreachable' },
        })
      }
    }
  }

  /** Store-and-forward drain: retry queued remote envelopes. */
  private async retryQueued() {
    // ONLY outbound forward-queue rows are retried. Inbound rows with
    // status=queued are the admin mailbox (admin offline) — they simply wait.
    const rows = await prisma.nhpMessage.findMany({
      where: { status: 'queued', channel: 'remote', direction: 'out', attempts: { lt: 6 } },
      take: 50,
    })
    if (rows.length) {
      console.log(`[retry] draining ${rows.length} queued envelope(s)`)
    }
    for (const row of rows) {
      try {
        const env = JSON.parse(row.envelope) as NhpEnvelope
        if (!isValidEnvelope(env)) {
          await prisma.nhpMessage.update({
            where: { id: row.id },
            data: { status: 'dead', error: 'corrupt envelope in queue' },
          })
          continue
        }
        const host = await prisma.host.findUnique({ where: { code: env.to.host } })
        if (!host) {
          await prisma.nhpMessage.update({
            where: { id: row.id },
            data: { status: 'dead', error: 'host vanished from registry' },
          })
          continue
        }
        const res = await this.postEnvelope(host.address, env)
        if (res.ok) {
          if (res.hello) await this.mergeHello(res.hello)
          await prisma.nhpMessage.update({
            where: { id: row.id },
            data: { status: 'forwarded', error: null, deliveredAt: new Date() },
          })
          await prisma.host.update({
            where: { id: host.id },
            data: { status: 'online', lastSeen: new Date() },
          })
          await log('info', 'router', `queued envelope ${row.envId} delivered after retry`)
        } else {
          const attempts = row.attempts + 1
          await prisma.nhpMessage.update({
            where: { id: row.id },
            data: {
              attempts,
              error: res.error.slice(0, 500),
              ...(attempts >= 6 ? { status: 'dead' } : {}),
            },
          })
          if (attempts >= 6) {
            await log('error', 'router', `envelope ${row.envId} dead-lettered`, {
              to: env.to,
            })
          }
        }
      } catch (err) {
        await prisma.nhpMessage
          .update({ where: { id: row.id }, data: { status: 'dead', error: String(err).slice(0, 500) } })
          .catch(() => {})
      }
    }
  }

  private async postEnvelope(
    address: string,
    env: NhpEnvelope,
  ): Promise<{ ok: boolean; error: string; hello?: HelloPayload }> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 5000)
    try {
      const res = await fetch(address, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
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
    let count = 0
    for (const n of nodes) {
      const env = makeEnvelope({
        type,
        module,
        from,
        to: { host: this.self.code, node: n.code },
        payload,
      })
      const out = await this.route(env, 'module')
      if (out !== 'rejected') count++
    }
    const remotes = await prisma.host.findMany({ where: { kind: 'remote' } })
    for (const h of remotes) {
      const env = makeEnvelope({
        type,
        module,
        from,
        to: { host: h.code, node: NHP_WILDCARD },
        payload,
      })
      const out = await this.forwardRemote(env)
      if (out !== 'rejected') count++
    }
    return count
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
  // Admin socket sessions
  // ----------------------------------------------------------

  bindAdminSocket(socket: Socket) {
    let boundNode: string | null = null

    socket.on('admin:hello', async (p: { nodeCode: string; token: string }, cb) => {
      const node = await prisma.node.findUnique({
        where: { code: String(p?.nodeCode ?? '') },
        include: { host: true },
      })
      if (!node || node.token !== String(p?.token ?? '') || node.status !== 'active') {
        cb?.({ ok: false, error: 'نود یافت نشد یا توکن نامعتبر است' })
        await log('warn', 'kernel', `failed admin login for "${p?.nodeCode}"`)
        return
      }
      boundNode = node.code
      this.adminOnline.add(node.code)
      socket.join(ROOM(node.code))

      const mailbox = await prisma.nhpMessage.findMany({
        where: { toNode: node.code, direction: 'in' },
        orderBy: { createdAt: 'desc' },
        take: 60,
      })
      cb?.({
        ok: true,
        node: {
          code: node.code,
          name: node.name,
          isDemo: node.isDemo,
          host: { code: node.host.code, name: node.host.name },
        },
        mailbox: mailbox.reverse(),
      })
      await log('info', 'kernel', `admin connected to "${node.code}"`)
      // Publish our updated roster to peers ASAP
      void this.heartbeatOnce()
    })

    socket.on('nhp:send', async (p: {
      to: NhpAddress
      module: string
      type: string
      payload: unknown
    }, cb) => {
      if (!boundNode) return cb?.({ ok: false, error: 'ابتدا به نود متصل شوید' })
      const env = makeEnvelope({
        type: String(p?.type ?? ''),
        module: String(p?.module ?? ''),
        from: { host: this.self.code, node: boundNode },
        to: p?.to ?? { host: '*', node: '*' },
        payload: p?.payload ?? {},
      })
      const outcome = await this.route(env, 'local')
      cb?.({ ok: outcome !== 'rejected', envId: env.id, outcome })
    })

    socket.on('chat:history', async (p: { peerHost: string; peerNode: string }, cb) => {
      if (!boundNode) return cb?.({ ok: false, items: [] })
      const peerHost = String(p?.peerHost ?? '')
      const peerNode = String(p?.peerNode ?? '')
      const items = await prisma.nhpMessage.findMany({
        where: {
          module: 'chat',
          type: 'chat.message',
          OR: [
            { fromHost: peerHost, fromNode: peerNode, toNode: boundNode },
            { fromNode: boundNode, toHost: peerHost, toNode: peerNode },
          ],
        },
        orderBy: { createdAt: 'asc' },
        take: 200,
      })
      cb?.({ ok: true, items })
    })

    socket.on('broadcast:history', async (_p, cb) => {
      if (!boundNode) return cb?.({ ok: false, items: [] })
      const items = await prisma.nhpMessage.findMany({
        where: { toNode: boundNode, module: 'broadcast' },
        orderBy: { createdAt: 'desc' },
        take: 60,
      })
      cb?.({ ok: true, items })
    })

    socket.on('mailbox:list', async (p: { status?: string }, cb) => {
      if (!boundNode) return cb?.({ ok: false, items: [] })
      const items = await prisma.nhpMessage.findMany({
        where: {
          toNode: boundNode,
          direction: 'in',
          ...(p?.status ? { status: p.status } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 80,
      })
      cb?.({ ok: true, items })
    })

    socket.on('mailbox:clear', async (_p, cb) => {
      if (!boundNode) return cb?.({ ok: false })
      await prisma.nhpMessage.deleteMany({ where: { toNode: boundNode, direction: 'in' } })
      cb?.({ ok: true })
      await log('info', 'kernel', `mailbox cleared for "${boundNode}"`)
    })

    socket.on('net:refresh', async (_p, cb) => {
      await this.heartbeatOnce()
      cb?.({ ok: true, directory: await this.getDirectory() })
    })

    socket.on('disconnect', async () => {
      if (boundNode) {
        this.adminOnline.delete(boundNode)
        await log('info', 'kernel', `admin of "${boundNode}" went offline (node stays online)`)
        void this.heartbeatOnce()
      }
    })
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
