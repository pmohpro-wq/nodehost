import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword, startSession, needsFirstAdmin } from '@/lib/auth'

/**
 * POST /api/auth/register — self-service sign-up.
 * The FIRST user of an instance becomes its admin automatically.
 */
export async function POST(req: NextRequest) {
  let body: { email?: string; name?: string; password?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'درخواست نامعتبر است' }, { status: 400 })
  }

  const email = String(body.email ?? '').trim().toLowerCase()
  const name = String(body.name ?? '').trim()
  const password = String(body.password ?? '')

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return NextResponse.json({ ok: false, error: 'ایمیل نامعتبر است' }, { status: 422 })
  if (name.length < 2 || name.length > 60)
    return NextResponse.json({ ok: false, error: 'نام باید بین ۲ تا ۶۰ نویسه باشد' }, { status: 422 })
  if (password.length < 8)
    return NextResponse.json({ ok: false, error: 'رمز عبور باید حداقل ۸ نویسه باشد' }, { status: 422 })

  const existing = await db.user.findUnique({ where: { email } })
  if (existing)
    return NextResponse.json({ ok: false, error: 'این ایمیل قبلاً ثبت شده است' }, { status: 409 })

  // Bootstrap rule: first registrant of a fresh instance becomes admin.
  const role = (await needsFirstAdmin()) ? 'admin' : 'user'
  const user = await db.user.create({
    data: { email, name, passwordHash: await hashPassword(password), role },
  })
  await startSession(user.id)

  return NextResponse.json({
    ok: true,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  })
}
