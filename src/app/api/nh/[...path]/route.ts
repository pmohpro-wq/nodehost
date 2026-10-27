import { NextRequest, NextResponse } from 'next/server'

/**
 * Control-plane proxy: the UI talks ONLY to this relative path,
 * and we forward to the primary NodeHost kernel (alfa).
 * The kernel's NHP ingress (/ingress) is a data-plane endpoint that
 * remote kernels call directly — it does not go through this proxy.
 */
const KERNEL_API = process.env.NH_KERNEL_API ?? 'http://127.0.0.1:3013'

type Ctx = { params: Promise<{ path?: string[] }> }

async function forward(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params
  const segments = path ?? []
  const search = new URL(req.url).search
  const target = `${KERNEL_API}/internal/${segments.join('/')}${search}`

  const init: RequestInit = {
    method: req.method,
    headers: { 'content-type': 'application/json' },
    cache: 'no-store',
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await req.text()
  }

  try {
    const res = await fetch(target, init)
    const body = await res.text()
    return new NextResponse(body, {
      status: res.status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `kernel unreachable (temporary): ${String(err)}` },
      { status: 503 },
    )
  }
}

export const GET = forward
export const POST = forward
export const DELETE = forward
export const PUT = forward
export const PATCH = forward

export const dynamic = 'force-dynamic'
