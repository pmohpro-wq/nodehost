import { PrismaClient } from '@prisma/client'

/**
 * db.ts — Prisma client for the web layer.
 *
 * The client is a process-wide singleton (cached on globalThis so HMR
 * in dev doesn't fork a new one every reload). Every API route imports
 * `db` and calls `db.user.findUnique(...)` etc.
 *
 * The twist (Task 17 / Task 22): SQLite + Prisma's pooled connection
 * survives for the whole process lifetime. When the kernel restarts
 * and rewrites the db file under our feet (a fresh inode), the pooled
 * connection points at a dead inode and every write fails with
 * `attempt to write a readonly database` (SQLite extended_code 1032).
 * Restarting the web server fixes it — but that's an ops burden the
 * user shouldn't carry. Instead `db` is a Proxy that delegates to a
 * mutable holder: `resetDbClient()` swaps the holder and every
 * existing importer picks up the new client without a re-import.
 *
 * `withDbRetry(fn)` is the self-healing wrapper — call it for writes
 * that must not surface a 500 just because the kernel bounced.
 */

const globalForPrisma = globalThis as unknown as {
  __prismaHolder?: { current: PrismaClient }
}

function makeClient(): PrismaClient {
  return new PrismaClient({ log: ['warn', 'error'] })
}

if (!globalForPrisma.__prismaHolder) {
  globalForPrisma.__prismaHolder = { current: makeClient() }
}
// In production the holder is NOT cached on globalThis (no HMR), but
// the singleton still lives for the whole process — so we always read
// through the holder, never through a captured reference.

const holder = globalForPrisma.__prismaHolder

/**
 * A Proxy that forwards EVERY property access to the CURRENT Prisma
 * client in the holder. After `resetDbClient()` swaps the holder,
 * `db.user`, `db.node`, `db.$queryRawUnsafe` etc. all resolve to the
 * fresh client — no re-import needed.
 */
export const db = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = holder.current
    const value = Reflect.get(client, prop, client)
    if (typeof value === 'function') return value.bind(client)
    return value
  },
})

/**
 * Tear down the current Prisma client and create a fresh one in its
 * place. After the call, every importer of `db` picks up the new
 * client automatically (the Proxy reads through the holder).
 *
 * Safe to call repeatedly; cheap when nothing is wrong (one disconnect).
 */
export async function resetDbClient(): Promise<void> {
  const old = holder.current
  await old.$disconnect().catch(() => {})
  holder.current = makeClient()
}

/**
 * Detect SQLite errors that mean "the connection is dead, not the
 * query is wrong". These are the only ones worth a transparent retry.
 */
function isConnectionError(err: unknown): boolean {
  const msg = String(err ?? '')
  return (
    msg.includes('readonly database') ||
    msg.includes('disk I/O error') ||
    msg.includes('file is not a database') ||
    msg.includes('SQLITE_READONLY') ||
    msg.includes('SQLITE_IOERR') ||
    msg.includes('no such table')
  )
}

/**
 * Run `fn` against the db; if it throws a SQLite connection-level
 * error, reset the client ONCE and retry. This is the web layer's
 * self-healing path: a user never sees a 500 just because the kernel
 * restarted under our feet.
 *
 * Use this for writes that MUST succeed (auth/enter, admin mutations).
 * Read-heavy routes can call `db` directly — a transient read failure
 * is fine to surface as a retry in the UI.
 */
export async function withDbRetry<T>(fn: (client: PrismaClient) => Promise<T>): Promise<T> {
  try {
    return await fn(db)
  } catch (err) {
    if (!isConnectionError(err)) throw err
    console.warn(
      '[db] connection-level error, resetting Prisma client and retrying:',
      String(err).slice(0, 200),
    )
    await resetDbClient()
    return await fn(db)
  }
}
