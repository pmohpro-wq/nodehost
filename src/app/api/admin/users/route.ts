import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'

/** GET /api/admin/users — admin-only user directory (with node counts). */
export async function GET() {
  const me = await getSessionUser()
  if (!me) return NextResponse.json({ ok: false, error: 'ورود لازم است' }, { status: 401 })
  if (me.role !== 'admin')
    return NextResponse.json({ ok: false, error: 'دسترسی ادمین لازم است' }, { status: 403 })

  const users = await db.user.findMany({
    orderBy: { createdAt: 'asc' },
    include: { _count: { select: { nodes: true } } },
  })
  return NextResponse.json({
    ok: true,
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      role: u.role,
      status: u.status,
      createdAt: u.createdAt.toISOString(),
      nodeCount: u._count.nodes,
    })),
  })
}
