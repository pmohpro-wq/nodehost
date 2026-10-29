/**
 * admin.ts — internal REST API of the kernel (control-plane).
 * The Next.js control panel proxies to these endpoints; remote kernels
 * only ever talk to /ingress (the NHP data-plane), never to /internal.
 *
 * Routing is a flat, ordered match over (path, method) — small enough
 * to stay readable, explicit enough to stay auditable.
 */
import type { Kernel } from './kernel'
import { isValidEnvelope, makeEnvelope, NHP_SYS, WELL_KNOWN_PATH } from '../../src/core/nodehost/protocol'
import { checkIdShape, ENGLISH_ID_ERROR, ID_RE } from '../../src/lib/identity'
import { verifyIngressAuth } from './federation'
import { listMailbox, markRowDelivered } from './mailbox'
import { log, newAdminToken, newNodeCode, prisma } from './store'

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  })

const readBody = async <T>(req: Request): Promise<T> => {
  try {
    return (await req.json()) as T
  } catch {
    return {} as T
  }
}

/**
 * NHP data-plane: the ONLY endpoint remote kernels talk to.
 * When NHP_LINK_SECRET is configured, requests MUST carry
 * "Authorization: Bearer <secret>" — otherwise 401.
 */
async function handleIngress(req: Request, kernel: Kernel): Promise<Response> {
  if (!verifyIngressAuth(req.headers.get('authorization'))) {
    await log('warn', 'router', 'ingress rejected unauthorized request', {
      host: req.headers.get('host') ?? '',
    })
    return json({ ok: false, error: 'unauthorized ingress' }, 401)
  }
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'invalid JSON' }, 400)
  }
  if (!isValidEnvelope(body)) {
    return json({ ok: false, error: 'not a valid NHP v1 envelope' }, 422)
  }
  const outcome = await kernel.route(body, 'ingress')
  if (body.type === NHP_SYS.HELLO) {
    return json({ ok: true, outcome, hello: await kernel.federation.selfHello() })
  }
  return json({ ok: true, outcome })
}

// -----------------------------------------------------------
// Control-plane: proxied by the Next.js UI
// -----------------------------------------------------------
async function handleBootstrap(kernel: Kernel): Promise<Response> {
  const [host, nodes, modules, hosts, directory, statusRows, logs] = await Promise.all([
    prisma.host.findFirst({ where: { kind: 'local' } }),
    prisma.node.findMany({
      where: { host: { kind: 'local' } },
      include: { moduleStates: { orderBy: { moduleId: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.moduleDef.findMany({ orderBy: { id: 'asc' } }),
    prisma.host.findMany({ where: { kind: 'remote' }, orderBy: { code: 'asc' } }),
    kernel.getDirectory(),
    prisma.nhpMessage.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.sysLog.findMany({ orderBy: { createdAt: 'desc' }, take: 40 }),
  ])
  const msgCount = (s: string) => statusRows.find((r) => r.status === s)?._count._all ?? 0
  return json({
    ok: true,
    host,
    nodes,
    modules,
    hosts,
    directory,
    stats: {
      ...kernel.stats(),
      nodes: nodes.length,
      modulesEnabled: nodes.reduce(
        (acc, n) => acc + n.moduleStates.filter((s) => s.enabled).length,
        0,
      ),
      msgsDelivered: msgCount('delivered'),
      msgsQueued: msgCount('queued'),
      msgsForwarded: msgCount('forwarded'),
      msgsDead: msgCount('dead'),
      hostsOnline: hosts.filter((h) => h.status === 'online').length,
    },
    logs,
  })
}

/**
 * POST /internal/nodes/:ref/send — trusted-internal primitive send.
 * The web proxy enforces ownership; the kernel just routes the envelope.
 * `to` is OPTIONAL: { host, node }. When absent the envelope loops back
 * to the sender node itself (self-test). When present it must resolve
 * to a local node or a known remote host — that's the real messenger path.
 */
async function sendFromNode(req: Request, kernel: Kernel, ref: string): Promise<Response> {
  const body = await readBody<{ to?: { host?: string; node?: string }; module?: string; type?: string; payload?: unknown }>(req)
  const node = await prisma.node.findFirst({
    where: { OR: [{ id: ref }, { code: ref }] },
    include: { host: true },
  })
  if (!node) return json({ ok: false, error: 'node not found' }, 404)
  const moduleId = String(body.module ?? '').trim()
  const type = String(body.type ?? '').trim()
  if (!moduleId || !type) return json({ ok: false, error: 'module and type are required' }, 422)

  const from = { host: node.host.code, node: node.code }
  let to = from
  if (body.to?.host && body.to?.node) {
    const th = String(body.to.host)
    const tn = String(body.to.node)
    if (th === node.host.code) {
      // Local destination — the node must exist here.
      const target = await prisma.node.findUnique({ where: { code: tn } })
      if (!target) return json({ ok: false, error: `unknown local node "${tn}"` }, 422)
    } else {
      // Federated destination — the host must be known OR resolvable
      // (NHP 1.1 lazily adopts domain-shaped peers via well-known).
      const known = await prisma.host.findUnique({ where: { code: th } })
      if (!known) {
        const resolved = await kernel.federation.resolveHost(th)
        if (!resolved) return json({ ok: false, error: `میزبان "${th}" شناخته نمی‌شود و قابل کشف هم نیست` }, 422)
      }
    }
    to = { host: th, node: tn }
  }

  const env = makeEnvelope({ from, to, module: moduleId, type, payload: body.payload ?? {} })
  const outcome = await kernel.route(env, 'local')
  // A loopback send reached the node's mailbox + module regardless of a
  // live admin socket — reflect that in the node's history. Real remote
  // sends are tracked by recordOutbound inside the router itself.
  if (to === from) await markRowDelivered(env.id, node.code)
  return json({ ok: true, outcome, envId: env.id })
}

/**
 * GET|POST /internal/nodes/:ref/apps/:moduleId[/<path>] — serve a live
 * module instance's own app API (onApi). The web proxy verified node
 * ownership; here we only verify the module is actually enabled (live).
 */
async function moduleAppApi(
  req: Request,
  kernel: Kernel,
  ref: string,
  moduleId: string,
  rest: string,
): Promise<Response> {
  const node = await prisma.node.findFirst({
    where: { OR: [{ id: ref }, { code: ref }] },
    include: { host: true },
  })
  if (!node) return json({ ok: false, error: 'node not found' }, 404)

  const url = new URL(req.url)
  let body: unknown = {}
  if (req.method === 'POST') {
    try {
      body = await req.json()
    } catch {
      body = {}
    }
  }
  const reply = await kernel.runtime.callApi(node.code, moduleId, {
    method: req.method === 'POST' ? 'POST' : 'GET',
    path: rest,
    query: Object.fromEntries(url.searchParams),
    body,
  })
  if (!reply)
    return json(
      { ok: false, error: 'ماژول روی این نود فعال نیست' },
      409,
    )
  return json(reply.json, reply.status ?? 200)
}

/**
 * POST /internal/host/identity { code } — the admin sets THIS NodeHost's
 * public id (the routing code every address is built on: id@hostId).
 *
 * The new id passes the ONE identity law (src/lib/identity.ts): shape +
 * the English-only rule — a host id travels in NHP addresses, URLs and
 * federation links, so it must be ASCII-safe. It must also not collide
 * with a REMOTE host row (a local/remote code pair would make routing
 * ambiguous).
 *
 * What changes: the local Host row's code + the live kernel.self.code —
 * routing (to.host === self.code) picks the new id up in the same tick.
 * What deliberately does NOT change: the database file (DATABASE_URL is
 * independent of the id) and existing nodes/users. Remote peers keep a
 * stale row under the old code until their TTL sweep — hello traffic
 * re-learns the new id as a fresh host in the meantime (documented).
 */
async function setHostIdentity(req: Request, kernel: Kernel): Promise<Response> {
  const body = await readBody<{ code?: string }>(req)
  const gate = checkIdShape(String(body.code ?? ''))
  if (!gate.ok) return json({ ok: false, error: gate.error }, gate.status)
  if (!ID_RE.test(gate.id)) return json({ ok: false, error: ENGLISH_ID_ERROR }, 422)

  const clash = await prisma.host.findFirst({ where: { code: gate.id, kind: 'remote' } })
  if (clash)
    return json(
      { ok: false, error: 'این آیدی هم‌نام یک میزبانِ دوردست شناخته‌شده است' },
      409,
    )

  const current = await prisma.host.findFirst({ where: { kind: 'local' } })
  if (!current) return json({ ok: false, error: 'host row missing' }, 500)
  if (current.code === gate.id) return json({ ok: true, code: gate.id, unchanged: true })

  const host = await prisma.host.update({ where: { id: current.id }, data: { code: gate.id } })
  kernel.self = {
    id: host.id,
    code: host.code,
    name: host.name,
    address: host.address,
    gwPort: host.gwPort,
  }
  // Live module contexts freeze their identity at attach time — refresh
  // them so the very next contacts/chat call addresses id@<new-host-id>.
  await kernel.runtime.refreshIdentities()
  await log('info', 'kernel', `host id changed: "${current.code}" → "${gate.id}"`)
  return json({ ok: true, code: gate.id, previous: current.code })
}

/**
 * POST /internal/nodes — create a node.
 * Identity era (id = name): the web layer passes the user's username as
 * `code`, so ONE string is the user id, the node id and the network
 * address. `code` is optional for callers that just want a generated one.
 */
async function createNode(req: Request, kernel: Kernel): Promise<Response> {
  const body = await readBody<{ code?: string; name?: string; ownerId?: string }>(req)
  const code = String(body.code ?? '').trim()
  const name = String(body.name ?? '').trim() || code
  if (!name) return json({ ok: false, error: 'نام نود الزامی است' }, 422)
  if (code && (code.length < 2 || code.length > 40))
    return json({ ok: false, error: 'کد نود باید بین ۲ تا ۴۰ نویسه باشد' }, 422)
  const host = await prisma.host.findFirst({ where: { kind: 'local' } })
  if (!host) return json({ ok: false, error: 'host row missing' }, 500)
  if (code) {
    const taken = await prisma.node.findUnique({ where: { code } })
    if (taken) return json({ ok: false, error: 'این نام قبلاً در این نودهاست گرفته شده است' }, 409)
  }
  const node = await prisma.node.create({
    data: {
      code: code || newNodeCode(),
      name: name.slice(0, 60),
      token: newAdminToken(),
      hostId: host.id,
      // Opaque creator id stamped by the web layer (tenant gate).
      // The kernel itself never interprets it.
      ownerId: body.ownerId ? String(body.ownerId) : null,
      moduleStates: {
        create: (await prisma.moduleDef.findMany()).map((m) => ({ moduleId: m.id })),
      },
    },
    include: { moduleStates: true },
  })
  await kernel.runtime.syncAll()
  await log('info', 'kernel', `node "${node.code}" created (${name})`)
  return json({ ok: true, node })
}

async function toggleNodeModule(req: Request, kernel: Kernel, ref: string): Promise<Response> {
  const body = await readBody<{ moduleId?: string; enabled?: boolean }>(req)
  const node = await prisma.node.findFirst({ where: { OR: [{ id: ref }, { code: ref }] } })
  if (!node) return json({ ok: false, error: 'node not found' }, 404)
  if (!body.moduleId) return json({ ok: false, error: 'moduleId required' }, 422)
  await prisma.nodeModuleState.upsert({
    where: { nodeId_moduleId: { nodeId: node.id, moduleId: body.moduleId } },
    update: { enabled: !!body.enabled },
    create: { nodeId: node.id, moduleId: body.moduleId, enabled: !!body.enabled },
  })
  await kernel.runtime.syncAll()
  await log(
    'info',
    'kernel',
    `module "${body.moduleId}" ${body.enabled ? 'enabled' : 'disabled'} on ${node.code}`,
  )
  return json({ ok: true })
}

/**
 * DELETE /internal/nodes/:ref — remove a node and everything it owns.
 *
 * Cascade (the node IS the account's server — leaving the web account
 * behind would create a login-with-nothing zombie):
 *  1. Node row — Prisma cascades NodeModuleState + ModuleStorage.
 *  2. Its mailbox history (NhpMessage rows to/from its code) — otherwise
 *     queued deliveries retry forever against a node that no longer exists.
 *  3. The owner's web account (User row) — ONLY when this was their last
 *     node (quota is one, but stay safe); their tab session dies on the
 *     very next request (the header fails resolution). The freed id can
 *     register again fresh.
 *
 * The web proxy decides WHO may call this (admin-only, never one's own
 * node) — the kernel stays the trusted-internal executor.
 */
async function deleteNode(kernel: Kernel, ref: string): Promise<Response> {
  const node = await prisma.node.findFirst({ where: { OR: [{ id: ref }, { code: ref }] } })
  if (!node) return json({ ok: false, error: 'node not found' }, 404)

  await prisma.node.delete({ where: { id: node.id } })
  await prisma.nhpMessage.deleteMany({
    where: { OR: [{ fromNode: node.code }, { toNode: node.code }] },
  })

  let accountRemoved: string | null = null
  if (node.ownerId) {
    const remaining = await prisma.node.count({ where: { ownerId: node.ownerId } })
    if (remaining === 0) {
      const owner = await prisma.user.findUnique({ where: { id: node.ownerId } })
      if (owner) {
        await prisma.user.delete({ where: { id: owner.id } })
        accountRemoved = owner.name
      }
    }
  }

  await kernel.runtime.syncAll()
  await log('info', 'kernel', `node "${node.code}" deleted${accountRemoved ? ` (account "${accountRemoved}" removed with it)` : ''}`)
  return json({ ok: true, deleted: node.code, ...(accountRemoved ? { accountRemoved } : {}) })
}

/**
 * POST /internal/hosts — introduce a REMOTE NodeHost to this one
 * (federation peering). Every signed-in user may introduce a host via
 * the web proxy; the kernel only validates the wire shape. `code` is the
 * peer's host id (optional — generated when absent), `name` is optional
 * display naming (defaults to the code), `address` is the peer's ingress
 * URL and is the one required field.
 */
async function addHost(req: Request, kernel: Kernel): Promise<Response> {
  const body = await readBody<{ code?: string; name?: string; address?: string; gwPort?: number }>(req)
  const address = String(body.address ?? '').trim().replace(/\/+$/, '')
  if (!address) return json({ ok: false, error: 'آدرس نودهاست (ingress) الزامی است' }, 422)
  try {
    new URL(address)
  } catch {
    return json({ ok: false, error: 'آدرس نامعتبر است' }, 422)
  }
  let code = String(body.code ?? '').trim()
  if (code) {
    const gate = checkIdShape(code)
    if (!gate.ok) return json({ ok: false, error: gate.error }, gate.status)
    code = gate.id
  } else {
    code = `host-${newAdminToken().slice(3, 9)}`
  }
  const name = String(body.name ?? '').trim() || code
  // A peer may never take over THIS host's routing code — the upsert below
  // would silently rewrite the local row otherwise.
  const local = await prisma.host.findFirst({ where: { kind: 'local' } })
  if (local && local.code === code)
    return json({ ok: false, error: 'این آیدی متعلق به همین نودهاست است' }, 409)
  const host = await prisma.host.upsert({
    where: { code },
    update: { name, address, gwPort: body.gwPort ?? null },
    create: { code, name, address, gwPort: body.gwPort ?? null, kind: 'remote' },
  })
  await log('info', 'kernel', `remote host "${code}" introduced`)
  void kernel.heartbeatOnce()
  return json({ ok: true, host })
}

async function deleteHost(ref: string): Promise<Response> {
  // Accept BOTH the row id and the routing code — callers (proxy, tests)
  // naturally speak codes; a code-only lookup that silently no-ops was a
  // booby trap ("ok:true" while nothing was deleted).
  const host = await prisma.host.findFirst({ where: { OR: [{ id: ref }, { code: ref }] } })
  if (host) {
    if (host.kind === 'local') return json({ ok: false, error: 'میزبان محلی حذف نمی‌شود' }, 422)
    await prisma.host.delete({ where: { id: host.id } })
    await prisma.netDirectory.deleteMany({ where: { hostCode: host.code } })
    await log('info', 'kernel', `remote host "${host.code}" removed`)
  } else {
    return json({ ok: false, error: 'host not found' }, 404)
  }
  return json({ ok: true })
}

/**
 * GET /.well-known/nhp — the public discovery document (NHP 1.1).
 * Any kernel that receives mail for (thisHost, node) and does not know
 * this host yet fetches THIS to learn the ingress URL. No auth: the same
 * information is already in every hello response we send.
 */
function wellKnown(kernel: Kernel): Response {
  return json({
    ok: true,
    nhp: 1,
    host: {
      code: kernel.self.code,
      name: kernel.self.name,
      ingress: kernel.self.address,
      gwPort: kernel.self.gwPort,
    },
  })
}

/** Route table for /internal/* and /ingress. */
export async function handleApi(req: Request, kernel: Kernel): Promise<Response> {
  const url = new URL(req.url)
  const path = url.pathname.replace(/\/+$/, '') || '/'

  if (path === WELL_KNOWN_PATH && req.method === 'GET') {
    return wellKnown(kernel)
  }

  if (path === '/ingress' && req.method === 'POST') {
    return handleIngress(req, kernel)
  }

  if (path === '/internal/bootstrap' && req.method === 'GET') {
    return handleBootstrap(kernel)
  }

  if (path === '/internal/nodes' && req.method === 'POST') {
    return createNode(req, kernel)
  }

  if (path === '/internal/host/identity' && req.method === 'POST') {
    return setHostIdentity(req, kernel)
  }

  const nodeToggle = path.match(/^\/internal\/nodes\/([^/]+)\/modules$/)
  if (nodeToggle && req.method === 'POST') {
    return toggleNodeModule(req, kernel, nodeToggle[1])
  }

  const nodeSend = path.match(/^\/internal\/nodes\/([^/]+)\/send$/)
  if (nodeSend && req.method === 'POST') {
    return sendFromNode(req, kernel, nodeSend[1])
  }

  const nodeApp = path.match(/^\/internal\/nodes\/([^/]+)\/apps\/([^/]+)(?:\/(.*))?$/)
  if (nodeApp && (req.method === 'GET' || req.method === 'POST')) {
    return moduleAppApi(req, kernel, nodeApp[1], nodeApp[2], nodeApp[3] ?? '')
  }

  const nodeDelete = path.match(/^\/internal\/nodes\/([^/]+)$/)
  if (nodeDelete && req.method === 'DELETE') {
    return deleteNode(kernel, nodeDelete[1])
  }

  if (path === '/internal/hosts' && req.method === 'POST') {
    return addHost(req, kernel)
  }

  const hostDelete = path.match(/^\/internal\/hosts\/([^/]+)$/)
  if (hostDelete && req.method === 'DELETE') {
    return deleteHost(hostDelete[1])
  }

  const mailbox = path.match(/^\/internal\/mailbox\/([^/]+)$/)
  if (mailbox && req.method === 'GET') {
    const status = url.searchParams.get('status') ?? undefined
    const items = await listMailbox(mailbox[1], status)
    return json({ ok: true, items })
  }

  if (path === '/internal/refresh' && req.method === 'POST') {
    await kernel.heartbeatOnce()
    return json({ ok: true })
  }

  return json({ ok: false, error: `no route: ${req.method} ${path}` }, 404)
}
