import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getTabUser } from '@/lib/auth'
import { checkIdShape, ENGLISH_ID_ERROR, ID_RE } from '@/lib/identity'

const KERNEL_API = process.env.NH_KERNEL_API ?? 'http://127.0.0.1:3013'

/**
 * PATCH /api/admin/host-identity { code } — the admin sets THIS NodeHost's
 * public id (the "alfa" of every address id@hostId on this instance).
 *
 * The web layer owns the WHO (admin only); the kernel owns the HOW
 * (POST /internal/host/identity persists the new code on the local Host
 * row and flips kernel.self.code live — routing follows in the same tick).
 * The same identity law (src/lib/identity.ts) is checked on both sides:
 * shape + English-only, plus a remote-host code clash check in the kernel.
 *
 * The database file (DATABASE_URL) is independent of the id — renaming the
 * host never moves data, and existing users/nodes keep working; their
 * addresses simply read id@<new-host-id> from the next bootstrap poll on.
 */
export async function PATCH(req: NextRequest) {
  const me = await getTabUser(req)
  if (!me) return NextResponse.json({ ok: false, error: 'ورود لازم است' }, { status: 401 })
  if (me.role !== 'admin')
    return NextResponse.json({ ok: false, error: 'دسترسی ادمین لازم است' }, { status: 403 })

  let body: { code?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'درخواست نامعتبر است' }, { status: 400 })
  }

  const gate = checkIdShape(String(body.code ?? ''))
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status })
  if (!ID_RE.test(gate.id))
    return NextResponse.json({ ok: false, error: ENGLISH_ID_ERROR }, { status: 422 })

  try {
    const res = await fetch(`${KERNEL_API}/internal/host/identity`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: gate.id }),
      cache: 'no-store',
    })
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
    if (!res.ok || !data.ok)
      return NextResponse.json(
        { ok: false, error: data.error ?? 'تغییر آیدی نودهاست ناموفق بود' },
        { status: res.status === 200 ? 502 : res.status },
      )
    return NextResponse.json({ ok: true, code: gate.id })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `کرنل در دسترس نیست: ${String(err)}` },
      { status: 503 },
    )
  }
}

/** GET — current host id (convenience for the admin card; bootstrap has it too). */
export async function GET(req: NextRequest) {
  const me = await getTabUser(req)
  if (!me) return NextResponse.json({ ok: false, error: 'ورود لازم است' }, { status: 401 })
  const host = await db.host.findFirst({ where: { kind: 'local' }, select: { code: true, name: true } })
  if (!host) return NextResponse.json({ ok: false, error: 'host row missing' }, { status: 500 })
  return NextResponse.json({ ok: true, code: host.code, name: host.name })
}
