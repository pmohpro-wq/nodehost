/**
 * auth.ts — web-layer identity for NodeHost.
 *
 * Design: the kernel stays user-agnostic; ALL tenancy lives here.
 *  - Passwords: scrypt (node:crypto) — no external dependency.
 *  - Sessions: the cookie carries a random 32-byte token; the DB stores
 *    only its sha256, so a database leak never yields usable cookies.
 *  - Bootstrap rule for self-hosted instances: the FIRST user to register
 *    becomes the admin when no admin exists yet.
 */
import { randomBytes, scrypt as _scrypt, timingSafeEqual, createHash } from 'node:crypto'
import { promisify } from 'node:util'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'

const scrypt = promisify(_scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>

export const SESSION_COOKIE = 'nh_session'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const KEY_LEN = 64

// ------------------------------------------------------------
// Passwords
// ------------------------------------------------------------

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scrypt(password, salt, KEY_LEN)
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':')
  if (!saltHex || !hashHex) return false
  const hash = await scrypt(password, Buffer.from(saltHex, 'hex'), KEY_LEN)
  const expected = Buffer.from(hashHex, 'hex')
  return hash.length === expected.length && timingSafeEqual(hash, expected)
}

// ------------------------------------------------------------
// Sessions
// ------------------------------------------------------------

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex')

export interface SafeUser {
  id: string
  email: string
  name: string
  role: 'user' | 'admin'
  status: 'active' | 'suspended'
  createdAt: string
}

const toSafeUser = (u: {
  id: string
  email: string
  name: string
  role: string
  status: string
  createdAt: Date
}): SafeUser => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role === 'admin' ? 'admin' : 'user',
  status: u.status === 'suspended' ? 'suspended' : 'active',
  createdAt: u.createdAt.toISOString(),
})

/** Create a session row + set the httpOnly cookie. */
export async function startSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString('base64url')
  await db.session.create({
    data: { tokenHash: sha256(token), userId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
  })
  const jar = await cookies()
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  })
}

/** Delete the session row + clear the cookie. */
export async function endSession(): Promise<void> {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (token) await db.session.deleteMany({ where: { tokenHash: sha256(token) } })
  jar.delete(SESSION_COOKIE)
}

/**
 * Resolve the signed-in user from the session cookie.
 * Returns null for guests, expired sessions and suspended users.
 */
export async function getSessionUser(): Promise<SafeUser | null> {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (!token) return null
  const session = await db.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: true },
  })
  if (!session || session.expiresAt.getTime() < Date.now()) return null
  if (session.user.status !== 'active') return null
  return toSafeUser(session.user)
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
