import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyPassword, startSession } from '@/lib/auth'

/** POST /api/auth/login — email + password → session cookie. */
export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'درخواست نامعتبر است' }, { status: 400 })
  }

  const email = String(body.email ?? '').trim().toLowerCase()
  const password = String(body.password ?? '')
  if (!email || !password)
    return NextResponse.json({ ok: false, error: 'ایمیل و رمز عبور الزامی است' }, { status: 422 })

  const user = await db.user.findUnique({ where: { email } })
  // Same generic message for unknown email and wrong password (no user enumeration).
  if (!user || !(await verifyPassword(password, user.passwordHash)))
    return NextResponse.json({ ok: false, error: 'ایمیل یا رمز عبور نادرست است' }, { status: 401 })
  if (user.status !== 'active')
    return NextResponse.json(
      { ok: false, error: 'حساب شما توسط ادمین به حالت تعلیق درآمده است' },
      { status: 403 },
    )

  await startSession(user.id)
  return NextResponse.json({
    ok: true,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  })
}
