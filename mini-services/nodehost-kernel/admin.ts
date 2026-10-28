/**
 * admin.ts — internal REST API of the kernel (control-plane).
 * The Next.js control panel proxies to these endpoints; remote kernels
 * only ever talk to /ingress (the NHP data-plane), never to /internal.
 *
 * Routing is a flat, ordered match over (path, method) — small enough
 * to stay readable, explicit enough to stay auditable.
 */
import type { Kernel } from './kernel'
import { isValidEnvelope, makeEnvelope, NHP_SYS } from '../../src/core/nodehost/protocol'
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
 * POST /internal/nodes/:code/send — trusted-internal test send.
 * The web proxy enforces ownership; the kernel just delivers a LOCAL
 * node→node envelope. This exists so the simplified UI can exercise a
 * node's modules over plain REST — no browser socket needed.
 */
async function sendFromNode(req: Request, kernel: Kernel, ref: string): Promise<Response> {
  const body = await readBody<{ module?: string; type?: string; payload?: unknown }>(req)
  const node = await prisma.node.findFirst({
    where: { OR: [{ id: ref }, { code: ref }] },
    include: { host: true },
  })
  if (!node) return json({ ok: false, error: 'node not found' }, 404)
  const moduleId = String(body.module ?? '').trim()
  const type = String(body.type ?? '').trim()
  if (!moduleId || !type) return json({ ok: false, error: 'module and type are required' }, 422)
  const addr = { host: node.host.code, node: node.code }
  const env = makeEnvelope({ from: addr, to: addr, module: moduleId, type, payload: body.payload ?? {} })
  const outcome = await kernel.route(env, 'local')
  // The loopback send reached the node's mailbox + module regardless of a
  // live admin socket — reflect that in the node's history.
  await markRowDelivered(env.id, node.code)
  return json({ ok: true, outcome, envId: env.id })
}

async function createNode(req: Request, kernel: Kernel): Promise<Response> {
  const body = await readBody<{ name?: string; ownerId?: string }>(req)
  const name = String(body.name ?? '').trim()
  if (!name) return json({ ok: false, error: 'نام نود الزامی است' }, 422)
  const host = await prisma.host.findFirst({ where: { kind: 'local' } })
  if (!host) return json({ ok: false, error: 'host row missing' }, 500)
  const node = await prisma.node.create({
    data: {
      code: newNodeCode(),
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

async function toggleNodeModule(req: Request, kernel: Kernel, nodeId: string): Promise<Response> {
  const body = await readBody<{ moduleId?: string; enabled?: boolean }>(req)
  const node = await prisma.node.findUnique({ where: { id: nodeId } })
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

async function deleteNode(kernel: Kernel, nodeId: string): Promise<Response> {
  const node = await prisma.node.findUnique({ where: { id: nodeId } })
  if (node) {
    await prisma.node.delete({ where: { id: node.id } })
    await kernel.runtime.syncAll()
    await log('info', 'kernel', `node "${node.code}" deleted`)
  }
  return json({ ok: true })
}

async function addHost(req: Request, kernel: Kernel): Promise<Response> {
  const body = await readBody<{ code?: string; name?: string; address?: string; gwPort?: number }>(req)
  const name = String(body.name ?? '').trim()
  const address = String(body.address ?? '').trim().replace(/\/+$/, '')
  if (!name || !address) return json({ ok: false, error: 'نام و آدرس میزبان الزامی است' }, 422)
  try {
    new URL(address)
  } catch {
    return json({ ok: false, error: 'آدرس نامعتبر است' }, 422)
  }
  const code = String(body.code ?? '').trim() || `host-${newAdminToken().slice(3, 9)}`
  const host = await prisma.host.upsert({
    where: { code },
    update: { name, address, gwPort: body.gwPort ?? null },
    create: { code, name, address, gwPort: body.gwPort ?? null, kind: 'remote' },
  })
  await log('info', 'kernel', `remote host "${code}" added`)
  void kernel.heartbeatOnce()
  return json({ ok: true, host })
}

async function deleteHost(hostId: string): Promise<Response> {
  const host = await prisma.host.findUnique({ where: { id: hostId } })
  if (host) {
    if (host.kind === 'local') return json({ ok: false, error: 'میزبان محلی حذف نمی‌شود' }, 422)
    await prisma.host.delete({ where: { id: host.id } })
    await prisma.netDirectory.deleteMany({ where: { hostCode: host.code } })
    await log('info', 'kernel', `remote host "${host.code}" removed`)
  }
  return json({ ok: true })
}

/** Route table for /internal/* and /ingress. */
export async function handleApi(req: Request, kernel: Kernel): Promise<Response> {
  const url = new URL(req.url)
  const path = url.pathname.replace(/\/+$/, '') || '/'

  if (path === '/ingress' && req.method === 'POST') {
    return handleIngress(req, kernel)
  }

  if (path === '/internal/bootstrap' && req.method === 'GET') {
    return handleBootstrap(kernel)
  }

  if (path === '/internal/nodes' && req.method === 'POST') {
    return createNode(req, kernel)
  }

  const nodeToggle = path.match(/^\/internal\/nodes\/([^/]+)\/modules$/)
  if (nodeToggle && req.method === 'POST') {
    return toggleNodeModule(req, kernel, nodeToggle[1])
  }

  const nodeSend = path.match(/^\/internal\/nodes\/([^/]+)\/send$/)
  if (nodeSend && req.method === 'POST') {
    return sendFromNode(req, kernel, nodeSend[1])
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
