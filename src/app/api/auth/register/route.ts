import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { db } from '@/lib/db'
import { hashPassword, startSession, needsFirstAdmin } from '@/lib/auth'

/**
 * POST /api/auth/register — self-service sign-up, two modes:
 *
 *  quick  → { name } only: a throwaway account for FAST TESTING.
 *           Identity fields are auto-generated; the session cookie is the
 *           only way back in (no recoverable password).
 *  full   → { name, email, password }: a re-loginable account.
 *
 * The FIRST user of a fresh instance becomes its admin (both modes).
 */
export async function POST(req: NextRequest) {
  let body: { email?: string; name?: string; password?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'درخواست نامعتبر است' }, { status: 400 })
  }

  const name = String(body.name ?? '').trim()
  const emailInput = String(body.email ?? '').trim().toLowerCase()
  const passwordInput = String(body.password ?? '')

  // Quick mode = name provided, email/password absent.
  const quick = !emailInput && !passwordInput

  let email: string
  let password: string

  if (quick) {
    if (name.length < 2 || name.length > 40)
      return NextResponse.json(
        { ok: false, error: 'نام کاربری باید بین ۲ تا ۴۰ نویسه باشد' },
        { status: 422 },
      )
    // Auto-generated identity: unique, never used for login.
    email = `quick-${randomBytes(6).toString('hex')}@nodehost.local`
    password = randomBytes(24).toString('hex')
  } else {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput))
      return NextResponse.json({ ok: false, error: 'ایمیل نامعتبر است' }, { status: 422 })
    if (name.length < 2 || name.length > 60)
      return NextResponse.json({ ok: false, error: 'نام باید بین ۲ تا ۶۰ نویسه باشد' }, { status: 422 })
    if (passwordInput.length < 8)
      return NextResponse.json({ ok: false, error: 'رمز عبور باید حداقل ۸ نویسه باشد' }, { status: 422 })
    email = emailInput
    password = passwordInput

    const existing = await db.user.findUnique({ where: { email } })
    if (existing)
      return NextResponse.json({ ok: false, error: 'این ایمیل قبلاً ثبت شده است' }, { status: 409 })
  }

  // Bootstrap rule: first registrant of a fresh instance becomes admin.
  const role = (await needsFirstAdmin()) ? 'admin' : 'user'
  const user = await db.user.create({
    data: { email, name, passwordHash: await hashPassword(password), role },
  })
  await startSession(user.id)

  // The user's personal node IS their account's server — create it right away.
  // Kernel being down must not block sign-up: the UI offers a one-click
  // "create my node" fallback in that case.
  let nodeCreated = false
  try {
    const kernelApi = process.env.NH_KERNEL_API ?? 'http://127.0.0.1:3013'
    const res = await fetch(`${kernelApi}/internal/nodes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: `نود ${name}`, ownerId: user.id }),
      cache: 'no-store',
    })
    nodeCreated = res.ok
  } catch {
    nodeCreated = false
  }

  return NextResponse.json({
    ok: true,
    mode: quick ? 'quick' : 'full',
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    nodeCreated,
  })
}
