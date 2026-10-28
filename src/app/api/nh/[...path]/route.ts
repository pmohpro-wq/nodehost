import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { canManageNode, sanitizeBootstrap, type RawBootstrap } from '@/lib/tenant'

/**
 * Control-plane GATE — the single door between browsers and the kernel.
 *
 * Tenancy policy lives HERE, not in the kernel:
 *   - every mutation requires a session; node mutations require ownership
 *     (or the admin role); federation management requires the admin role;
 *   - node creation enforces the admin-configured quota (maxNodes, default 50)
 *     and stamps the creator as owner;
 *   - reads are sanitized per viewer (see tenant.ts) — tokens of user-owned
 *     nodes and cross-tenant logs never leave the server.
 *
 * The kernel's own /internal endpoints stay trusted-internal (localhost /
 * Docker network); remote kernels only ever touch /ingress.
 */
const KERNEL_API = process.env.NH_KERNEL_API ?? 'http://127.0.0.1:3013'

type Ctx = { params: Promise<{ path?: string[] }> }

const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'cache-control': 'no-store' } })

const unauthorized = () => json({ ok: false, error: 'برای این عملیات باید وارد شوید' }, 401)
const forbidden = (m: string) => json({ ok: false, error: m }, 403)
const notFound = () => json({ ok: false, error: 'مسیر یافت نشد' }, 404)

/** Forward to the kernel, mapping transport failure to a retryable 503. */
async function passthrough(req: NextRequest, subPath: string, search: string, body?: string) {
  const target = `${KERNEL_API}/internal/${subPath}${search}`
  try {
    const res = await fetch(target, {
      method: req.method,
      headers: { 'content-type': 'application/json' },
      body: body ?? (req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text()),
      cache: 'no-store',
    })
    const text = await res.text()
    return new NextResponse(text, {
      status: res.status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    })
  } catch (err) {
    return json({ ok: false, error: `kernel unreachable (temporary): ${String(err)}` }, 503)
  }
}

async function forward(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { path: segments } = await ctx.params
  const sub = segments ?? []
  const joined = sub.join('/')
  const search = new URL(req.url).search
  const method = req.method
  const viewer = await getSessionUser()

  // ------------------------------------------------------------
  // READS
  // ------------------------------------------------------------

  // GET bootstrap → sanitized per viewer.
  if (method === 'GET' && joined === 'bootstrap') {
    const viewer = await getSessionUser()
    const raw = (await (async () => {
      try {
        const res = await fetch(`${KERNEL_API}/internal/bootstrap`, { cache: 'no-store' })
        if (!res.ok) return null
        return (await res.json()) as RawBootstrap
      } catch {
        return null
      }
    })()) as RawBootstrap | null

    if (!raw) return json({ ok: false, error: 'kernel unreachable (temporary)' }, 503)
    return json(await sanitizeBootstrap(raw, viewer))
  }

  // GET mailbox/<nodeCode> → owner or admin only.
  const mailbox = joined.match(/^mailbox\/([^/]+)$/)
  if (method === 'GET' && mailbox) {
    const viewer = await getSessionUser()
    if (!viewer) return unauthorized()
    const node = await db.node.findUnique({ where: { code: mailbox[1] } })
    if (!node) return json({ ok: false, error: 'نود یافت نشد' }, 404)
    if (!canManageNode(viewer, node)) return forbidden('این نود متعلق به شما نیست')
    return passthrough(req, joined, search)
  }

  // GET nodes/<ref>/apps/<moduleId>[/<rest>] → module app API (owner/admin).
  const appGet = joined.match(/^nodes\/([^/]+)\/apps\/([^/]+)(\/.*)?$/)
  if (method === 'GET' && appGet) {
    const viewer = await getSessionUser()
    if (!viewer) return unauthorized()
    const node = await db.node.findUnique({ where: { id: appGet[1] } })
    if (!node) return json({ ok: false, error: 'نود یافت نشد' }, 404)
    if (!canManageNode(viewer, node)) return forbidden('این نود متعلق به شما نیست')
    return passthrough(req, joined, search)
  }

  // No other anonymous reads: keep the surface explicit instead of open.
  if (method === 'GET') return viewer ? notFound() : unauthorized()

  // ------------------------------------------------------------
  // MUTATIONS — everything below requires a session
  // ------------------------------------------------------------
  if (!viewer) return unauthorized()

  // POST nodes → ONE node per user (their personal server), then kernel create.
  if (method === 'POST' && joined === 'nodes') {
    const mine = await db.node.count({ where: { ownerId: viewer.id, isDemo: false } })
    if (mine >= 1)
      return forbidden('هر کاربر فقط یک نود دارد — نود شخصی شما از قبل ساخته شده است')
    let body: Record<string, unknown> = {}
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      /* kernel validates the name anyway */
    }
    body.ownerId = viewer.id // opaque to the kernel — stored as-is
    return passthrough(req, 'nodes', '', JSON.stringify(body))
  }

  // POST nodes/<id>/modules → owner or admin.
  const toggle = joined.match(/^nodes\/([^/]+)\/modules$/)
  if (method === 'POST' && toggle) {
    const node = await db.node.findUnique({ where: { id: toggle[1] } })
    if (!node) return json({ ok: false, error: 'نود یافت نشد' }, 404)
    if (!canManageNode(viewer, node)) return forbidden('این نود متعلق به شما نیست')
    return passthrough(req, joined, search)
  }

  // POST nodes/<id>/send → owner or admin (module test from the simple UI).
  const send = joined.match(/^nodes\/([^/]+)\/send$/)
  if (method === 'POST' && send) {
    const node = await db.node.findUnique({ where: { id: send[1] } })
    if (!node) return json({ ok: false, error: 'نود یافت نشد' }, 404)
    if (!canManageNode(viewer, node)) return forbidden('این نود متعلق به شما نیست')
    return passthrough(req, joined, search)
  }

  // POST nodes/<id>/apps/<moduleId>[/<rest>] → module app API (owner/admin).
  const appPost = joined.match(/^nodes\/([^/]+)\/apps\/([^/]+)(\/.*)?$/)
  if (method === 'POST' && appPost) {
    const node = await db.node.findUnique({ where: { id: appPost[1] } })
    if (!node) return json({ ok: false, error: 'نود یافت نشد' }, 404)
    if (!canManageNode(viewer, node)) return forbidden('این نود متعلق به شما نیست')
    return passthrough(req, joined, search)
  }

  // DELETE nodes/<id> → owner or admin (demo nodes: admin only).
  const nodeDel = joined.match(/^nodes\/([^/]+)$/)
  if (method === 'DELETE' && nodeDel) {
    const node = await db.node.findUnique({ where: { id: nodeDel[1] } })
    if (!node) return json({ ok: false, error: 'نود یافت نشد' }, 404)
    if (!canManageNode(viewer, node)) return forbidden('این نود متعلق به شما نیست')
    return passthrough(req, joined, search)
  }

  // Federation management + manual heartbeat → admin only.
  if (joined === 'hosts' || /^hosts\/[^/]+$/.test(joined) || joined === 'refresh') {
    if (viewer.role !== 'admin') return forbidden('مدیریت شبکه فقط برای ادمین')
    return passthrough(req, joined, search)
  }

  return notFound()
}

export const GET = forward
export const POST = forward
export const DELETE = forward
export const PUT = forward
export const PATCH = forward

export const dynamic = 'force-dynamic'
