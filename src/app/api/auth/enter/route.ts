import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { startSession, needsFirstAdmin } from '@/lib/auth'

/**
 * POST /api/auth/enter — the ONE door of the passwordless era.
 *
 * { name } is the whole contract: the username IS the identity (id = name),
 * and the same string becomes the personal node's routing code, so the
 * network address of the user is (host, name).
 *
 *   - name is new      → account + personal node are created (first
 *                        registrant of a fresh instance becomes admin).
 *   - name already exists → the session opens for that account.
 *
 * Trade-off (deliberate, documented): without passwords anyone who knows
 * the name can open the account. Fine for testing-first deployments; a
 * real credential layer can be added later without changing the wire.
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

  // Existing name → plain login.
  const existing = await db.user.findUnique({ where: { name } })
  if (existing) {
    if (existing.status !== 'active')
      return NextResponse.json({ ok: false, error: 'این حساب غیرفعال است' }, { status: 403 })
    await startSession(existing.id)
    return NextResponse.json({
      ok: true,
      created: false,
      user: { id: existing.id, name: existing.name, role: existing.role },
    })
  }

  // New name → register. The FIRST user of a fresh instance becomes admin.
  const role = (await needsFirstAdmin()) ? 'admin' : 'user'
  const user = await db.user.create({ data: { name, role } })

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
      body: JSON.stringify({ code: name, name, ownerId: user.id }),
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

  await startSession(user.id)
  return NextResponse.json({
    ok: true,
    created: true,
    user: { id: user.id, name: user.name, role: user.role },
    nodeCreated,
  })
}
