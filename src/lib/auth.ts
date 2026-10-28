/**
 * auth.ts — web-layer identity for NodeHost, TAB-ISOLATED era.
 *
 * Design: the kernel stays user-agnostic; ALL tenancy lives here.
 *  - Passwordless era: the username IS the identity (id = name) and the
 *    only credential is the name itself. This is a deliberate product
 *    decision for frictionless testing — re-login = type the same name.
 *
 *  - TAB ISOLATION (no cookies, no server sessions): the browser sends the
 *    viewer's name in the `x-nh-user` request header on EVERY API call, and
 *    the server re-resolves the account from that header per request. The
 *    tab keeps its session in sessionStorage (per-tab by spec) and its URL
 *    carries `?u=<name>` — so each browser tab is one independent viewer:
 *    two tabs = two users, logout in one never touches the other, and no
 *    shared cookie/storage can leak data across tabs.
 *
 *    Header values travel URL-encoded (Persian names are not latin1-safe),
 *    and every request is validated against the live User table, so a
 *    suspended account is cut off on its very next call.
 */
import { db } from '@/lib/db'

/** Request header carrying the tab's viewer (URL-encoded username). */
export const USER_HEADER = 'x-nh-user'

export interface SafeUser {
  id: string
  name: string
  role: 'user' | 'admin'
  status: 'active' | 'suspended'
  createdAt: string
}

const toSafeUser = (u: {
  id: string
  name: string
  role: string
  status: string
  createdAt: Date
}): SafeUser => ({
  id: u.id,
  name: u.name,
  role: u.role === 'admin' ? 'admin' : 'user',
  status: u.status === 'suspended' ? 'suspended' : 'active',
  createdAt: u.createdAt.toISOString(),
})

/**
 * Resolve the calling tab's user from the `x-nh-user` header.
 * Returns null for guests (no header), unknown names, expired… nothing to
 * expire — and suspended users (rejected on the spot, per request).
 */
export async function getTabUser(req: Request): Promise<SafeUser | null> {
  const raw = req.headers.get(USER_HEADER)?.trim()
  if (!raw) return null
  let name: string
  try {
    name = decodeURIComponent(raw)
  } catch {
    return null
  }
  if (!name) return null
  const user = await db.user.findUnique({ where: { name } })
  if (!user || user.status !== 'active') return null
  return toSafeUser(user)
}

/** True while the instance has no admin yet (first registrant becomes admin). */
export async function needsFirstAdmin(): Promise<boolean> {
  return (await db.user.count({ where: { role: 'admin' } })) === 0
}

// ------------------------------------------------------------
// Instance settings (typed at use site)
// ------------------------------------------------------------

export const DEFAULT_MAX_NODES = 50

/** Read maxNodes — the admin-controlled cap on user-owned nodes per host. */
export async function getMaxNodes(): Promise<number> {
  const row = await db.setting.findUnique({ where: { key: 'maxNodes' } })
  const n = row ? Number(row.value) : NaN
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_MAX_NODES
}

export async function setMaxNodes(value: number): Promise<void> {
  await db.setting.upsert({
    where: { key: 'maxNodes' },
    update: { value: String(Math.max(0, Math.floor(value))) },
    create: { key: 'maxNodes', value: String(Math.max(0, Math.floor(value))) },
  })
}
