import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'

type Ctx = { params: Promise<{ id: string }> }

/**
 * PATCH /api/admin/users/[id] — suspend/activate or promote/demote.
 * An admin can never change their OWN account (no accidental lockout).
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const me = await getSessionUser()
  if (!me) return NextResponse.json({ ok: false, error: 'ورود لازم است' }, { status: 401 })
  if (me.role !== 'admin')
    return NextResponse.json({ ok: false, error: 'دسترسی ادمین لازم است' }, { status: 403 })

  const { id } = await ctx.params
  if (id === me.id)
    return NextResponse.json(
      { ok: false, error: 'تغییر وضعیت حساب خودتان مجاز نیست' },
      { status: 422 },
    )

  let body: { status?: string; role?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'درخواست نامعتبر است' }, { status: 400 })
  }

  const data: { status?: string; role?: string } = {}
  if (body.status === 'active' || body.status === 'suspended') data.status = body.status
  if (body.role === 'user' || body.role === 'admin') data.role = body.role
  if (Object.keys(data).length === 0)
    return NextResponse.json({ ok: false, error: 'تغییری ارسال نشده است' }, { status: 422 })

  const target = await db.user.findUnique({ where: { id } })
  if (!target) return NextResponse.json({ ok: false, error: 'کاربر یافت نشد' }, { status: 404 })

  // Suspending the last remaining admin would lock the instance out.
  if (target.role === 'admin' && (data.status === 'suspended' || data.role === 'user')) {
    const admins = await db.user.count({ where: { role: 'admin', status: 'active' } })
    if (admins <= 1)
      return NextResponse.json(
        { ok: false, error: 'حداقل یک ادمین فعال باید باقی بماند' },
        { status: 422 },
      )
  }

  const user = await db.user.update({ where: { id }, data })
  // Suspending a user revokes ALL their live sessions immediately.
  if (data.status === 'suspended') await db.session.deleteMany({ where: { userId: id } })

  return NextResponse.json({
    ok: true,
    user: { id: user.id, email: user.email, name: user.name, role: user.role, status: user.status },
  })
}
