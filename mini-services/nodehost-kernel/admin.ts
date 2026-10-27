/**
 * admin.ts — internal REST API of the kernel (control-plane).
 * The Next.js control panel proxies to these endpoints; remote kernels
 * only ever talk to /ingress (the NHP data-plane), never to /internal.
 */
import type { Kernel } from './kernel'
import { ENV, newAdminToken, newNodeCode, log, prisma } from './store'

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

/** Route table for /internal/* and /ingress. */
export async function handleApi(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const path = url.pathname.replace(/\/+$/, '') || '/'
  const kernel = (req as Request & { kernel?: Kernel }).kernel!

  // -----------------------------------------------------------
  // NHP data-plane: the ONLY endpoint remote kernels talk to
  // -----------------------------------------------------------
  if (path === '/ingress' && req.method === 'POST') {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return json({ ok: false, error: 'invalid JSON' }, 400)
    }
    const { isValidEnvelope, NHP_SYS } = await import('../../src/core/nodehost/protocol')
    if (!isValidEnvelope(body)) {
      return json({ ok: false, error: 'not a valid NHP v1 envelope' }, 422)
    }
    const outcome = await kernel.route(body, 'ingress')
    if (body.type === NHP_SYS.HELLO) {
      const roster = await import('./store').then((m) =>
        m.localRoster(kernel.adminOnline),
      )
      return json({
        ok: true,
        outcome,
        hello: {
          host: {
            code: kernel.self.code,
            name: kernel.self.name,
            gwPort: kernel.self.gwPort,
            address: kernel.self.address,
          },
          nodes: roster,
        },
      })
    }
    return json({ ok: true, outcome })
  }

  // -----------------------------------------------------------
  // Control-plane: proxied by the Next.js UI
  // -----------------------------------------------------------
  if (path === '/internal/bootstrap' && req.method === 'GET') {
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
    const msgCount = (s: string) =>
      statusRows.find((r) => r.status === s)?._count._all ?? 0
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

  if (path === '/internal/nodes' && req.method === 'POST') {
    const body = await readBody<{ name?: string }>(req)
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

  const nodeToggle = path.match(/^\/internal\/nodes\/([^/]+)\/modules$/)
  if (nodeToggle && req.method === 'POST') {
    const body = await readBody<{ moduleId?: string; enabled?: boolean }>(req)
    const node = await prisma.node.findUnique({ where: { id: nodeToggle[1] } })
    if (!node) return json({ ok: false, error: 'node not found' }, 404)
    if (!body.moduleId) return json({ ok: false, error: 'moduleId required' }, 422)
    await prisma.nodeModuleState.upsert({
      where: { nodeId_moduleId: { nodeId: node.id, moduleId: body.moduleId } },
      update: { enabled: !!body.enabled },
      create: { nodeId: node.id, moduleId: body.moduleId, enabled: !!body.enabled },
    })
    await kernel.runtime.syncAll()
    await log('info', 'kernel', `module "${body.moduleId}" ${body.enabled ? 'enabled' : 'disabled'} on ${node.code}`)
    return json({ ok: true })
  }

  const nodeDelete = path.match(/^\/internal\/nodes\/([^/]+)$/)
  if (nodeDelete && req.method === 'DELETE') {
    const node = await prisma.node.findUnique({ where: { id: nodeDelete[1] } })
    if (node) {
      await prisma.node.delete({ where: { id: node.id } })
      await kernel.runtime.syncAll()
      await log('info', 'kernel', `node "${node.code}" deleted`)
    }
    return json({ ok: true })
  }

  if (path === '/internal/hosts' && req.method === 'POST') {
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

  const hostDelete = path.match(/^\/internal\/hosts\/([^/]+)$/)
  if (hostDelete && req.method === 'DELETE') {
    const host = await prisma.host.findUnique({ where: { id: hostDelete[1] } })
    if (host) {
      if (host.kind === 'local') return json({ ok: false, error: 'میزبان محلی حذف نمی‌شود' }, 422)
      await prisma.host.delete({ where: { id: host.id } })
      await prisma.netDirectory.deleteMany({ where: { hostCode: host.code } })
      await log('info', 'kernel', `remote host "${host.code}" removed`)
    }
    return json({ ok: true })
  }

  const mailbox = path.match(/^\/internal\/mailbox\/([^/]+)$/)
  if (mailbox && req.method === 'GET') {
    const status = url.searchParams.get('status') ?? undefined
    const items = await prisma.nhpMessage.findMany({
      where: { toNode: mailbox[1], direction: 'in', ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 80,
    })
    return json({ ok: true, items })
  }

  if (path === '/internal/refresh' && req.method === 'POST') {
    await kernel.heartbeatOnce()
    return json({ ok: true })
  }

  return json({ ok: false, error: `no route: ${req.method} ${path}` }, 404)
}

export const apiEnv = ENV
