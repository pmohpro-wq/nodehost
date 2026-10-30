/**
 * wipe-data.ts — clean-slate reset for a NodeHost SQLite db.
 *
 * Wipes ALL user/test DATA: users, nodes (+ their module states and
 * storage), NHP mailbox, network directory, system logs.
 *
 * PRESERVES (deliberately, NOT fake data):
 *   - Host rows  → the server's own identity (kind=local, e.g. code "zzz")
 *     is admin-owned state chosen by the owner; it must survive resets.
 *   - ModuleDef  → the system's real builtin module registry.
 *   - Setting    → admin config (e.g. maxNodes).
 *
 * Usage:
 *   bun scripts/wipe-data.ts <db-path>            # dry-run: shows what would go
 *   bun scripts/wipe-data.ts <db-path> --apply    # actually deletes
 *
 * FK-safe order: children first (NodeModuleState, ModuleStorage) → Node →
 * User; NhpMessage / NetDirectory / SysLog have no FKs.
 */
import { Database } from 'bun:sqlite'

const path = process.argv[2]
const apply = process.argv.includes('--apply')

if (!path) {
  console.error('usage: bun scripts/wipe-data.ts <db-path> [--apply]')
  process.exit(1)
}

const DATA_TABLES = [
  'NodeModuleState',
  'ModuleStorage',
  'Node',
  'User',
  'NhpMessage',
  'NetDirectory',
  'SysLog',
] as const

const db = new Database(path)
db.exec('PRAGMA foreign_keys = ON')

const before: Record<string, number> = {}
for (const t of DATA_TABLES) {
  const row = db.query(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }
  before[t] = row.n
}

console.log(`== ${path} ${apply ? '(APPLY)' : '(dry-run)'} ==`)
for (const t of DATA_TABLES) console.log(`  ${t.padEnd(16)} ${before[t]} rows → 0`)

// Guard rails: identity must stay.
const hosts = db.query('SELECT code, kind FROM Host').all() as { code: string; kind: string }[]
console.log('  kept Host rows:', hosts.map((h) => `${h.code}(${h.kind})`).join(', ') || '(none)')

if (!apply) {
  console.log('dry-run only — re-run with --apply to delete.')
  process.exit(0)
}

const total = Object.values(before).reduce((a, b) => a + b, 0)
if (total === 0) {
  console.log('nothing to delete — already clean.')
  process.exit(0)
}

db.exec('BEGIN')
try {
  for (const t of DATA_TABLES) db.exec(`DELETE FROM "${t}"`)
  db.exec('COMMIT')
} catch (err) {
  db.exec('ROLLBACK')
  console.error('WIPE FAILED, rolled back:', err)
  process.exit(1)
}

// Verify
let dirty = 0
for (const t of DATA_TABLES) {
  const row = db.query(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }
  if (row.n !== 0) {
    console.error(`VERIFY FAILED: ${t} still has ${row.n} rows`)
    dirty++
  }
}
console.log(
  dirty === 0
    ? `OK — ${total} rows deleted across ${DATA_TABLES.length} tables; identity/registry/settings intact.`
    : `finished WITH ERRORS in ${dirty} tables`,
)
db.close()
process.exit(dirty === 0 ? 0 : 1)
