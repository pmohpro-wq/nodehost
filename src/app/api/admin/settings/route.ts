import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, getMaxNodes, setMaxNodes } from '@/lib/auth'

/** GET /api/admin/settings — instance settings (admin only). */
export async function GET() {
  const me = await getSessionUser()
  if (!me) return NextResponse.json({ ok: false, error: 'ورود لازم است' }, { status: 401 })
  if (me.role !== 'admin')
    return NextResponse.json({ ok: false, error: 'دسترسی ادمین لازم است' }, { status: 403 })

  return NextResponse.json({ ok: true, maxNodes: await getMaxNodes() })
}

/** PATCH /api/admin/settings — update maxNodes (the per-host node cap). */
export async function PATCH(req: NextRequest) {
  const me = await getSessionUser()
  if (!me) return NextResponse.json({ ok: false, error: 'ورود لازم است' }, { status: 401 })
  if (me.role !== 'admin')
    return NextResponse.json({ ok: false, error: 'دسترسی ادمین لازم است' }, { status: 403 })

  let body: { maxNodes?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'درخواست نامعتبر است' }, { status: 400 })
  }

  const n = Number(body.maxNodes)
  if (!Number.isInteger(n) || n < 0 || n > 100_000)
    return NextResponse.json({ ok: false, error: 'عدد صحیح بین ۰ تا ۱۰۰۰۰۰ وارد کنید' }, { status: 422 })

  await setMaxNodes(n)
  return NextResponse.json({ ok: true, maxNodes: n })
}
