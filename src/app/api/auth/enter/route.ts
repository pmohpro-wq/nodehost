import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { needsFirstAdmin } from '@/lib/auth'
import { resolveIdGate } from '@/lib/identity'

/**
 * POST /api/auth/enter — the ONE door of the passwordless era.
 *
 * { name } is the whole contract: the username IS the identity (id = name),
 * and the same string becomes the personal node's routing code, so the
 * network address of the user is (host, name).
 *
 *   - name is new      → account + personal node are created (first
 *                        registrant of a fresh instance becomes admin).
 *   - name already exists → the account opens for that name.
 *
 * The ONE identity law lives in src/lib/identity.ts and this door is its
 * main consumer:
 *   - EXISTING names log in EXACTLY as they are (legacy Persian ids keep
 *     working — the ladder never breaks an existing holder);
 *   - NEW ids must pass the full ladder: shape → exact/case-alias →
 *     English-only law (`[a-z][a-z0-9]*`). New ids travel in URLs,
 *     headers and NHP addresses, so they must be ASCII-safe.
 *
 * No cookie is issued: the TAB keeps the session (sessionStorage + ?u=
 * in the address bar) and presents it as the `x-nh-user` header on every
 * call — which is what makes two tabs two independent users.
 */
export async function POST(req: NextRequest) {
  let body: { name?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'درخواست نامعتبر است' }, { status: 400 })
  }

  const name = String(body.name ?? '').trim()
  if (name.length < 2 || name.length > 40)
    return NextResponse.json(
      { ok: false, error: 'نام کاربری باید بین ۲ تا ۴۰ نویسه باشد' },
      { status: 422 },
    )
  // '|' is the chat conversation-key separator (conv:<host>|<node>) — a name
  // containing it would forge cross-recipient keys; control chars break URLs.
  if (/[\u0000-\u001f\u007f|]/.test(name))
    return NextResponse.json(
      { ok: false, error: 'این نویسه در نام کاربری مجاز نیست' },
      { status: 422 },
    )

  // Existing name → plain login. Exact match first: legacy holders (any
  // alphabet) keep their id forever.
  const existing = await db.user.findUnique({ where: { name } })
  if (existing) {
    if (existing.status !== 'active')
      return NextResponse.json({ ok: false, error: 'این حساب غیرفعال است' }, { status: 403 })
    return NextResponse.json({
      ok: true,
      created: false,
      user: { id: existing.id, name: existing.name, role: existing.role },
    })
  }

  // New id → the full ladder. The case-alias leg is a case-insensitive
  // scan (SQLite lower() is ASCII-scoped — exactly the alphabet new ids
  // live in; Persian names can never collide with an English id anyway).
  const alias = await db.$queryRawUnsafe<{ name: string }[]>(
    'SELECT name FROM User WHERE lower(name) = ? LIMIT 1',
    name.toLowerCase(),
  )
  const gate = resolveIdGate(name, false, alias.length > 0)
  if (!gate.ok)
    return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status })

  // New name → register. The FIRST user of a fresh instance becomes admin.
  const role = (await needsFirstAdmin()) ? 'admin' : 'user'
  const user = await db.user.create({ data: { name: gate.id, role } })

  // The personal node IS the account's server — its routing code is the
  // username itself. Kernel being down must not block sign-up: the UI
  // offers a one-click "create my node" fallback in that case. A taken
  // code (legacy node with the same name) rolls the whole signup back.
  let nodeCreated = false
  try {
    const kernelApi = process.env.NH_KERNEL_API ?? 'http://127.0.0.1:3013'
    const res = await fetch(`${kernelApi}/internal/nodes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: gate.id, name: gate.id, ownerId: user.id }),
      cache: 'no-store',
    })
    if (res.status === 409) {
      await db.user.delete({ where: { id: user.id } })
      return NextResponse.json(
        { ok: false, error: 'این نام با نود دیگری در این نودهاست تداخل دارد' },
        { status: 409 },
      )
    }
    nodeCreated = res.ok
  } catch {
    nodeCreated = false
  }

  return NextResponse.json({
    ok: true,
    created: true,
    user: { id: user.id, name: user.name, role: user.role },
    nodeCreated,
  })
}
