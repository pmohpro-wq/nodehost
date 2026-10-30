/**
 * db-report.ts — read-only snapshot of a NodeHost SQLite db (bun:sqlite).
 * Usage: bun scripts/db-report.ts [path-to-db]
 */
import { Database } from 'bun:sqlite'

const path = process.argv[2] ?? '/home/z/my-project/nodehost/db/host-alfa.db'
const db = new Database(path, { readonly: true })

const TABLES = [
  'User',
  'Node',
  'Host',
  'ModuleDef',
  'NodeModuleState',
  'ModuleStorage',
  'NhpMessage',
  'NetDirectory',
  'SysLog',
  'Setting',
] as const

console.log(`== ${path} ==`)
for (const t of TABLES) {
  try {
    const n = db.query(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }
    console.log(`${t.padEnd(16)} ${n.n}`)
  } catch {
    console.log(`${t.padEnd(16)} (no table)`)
  }
}

const users = db.query('SELECT name, role, status FROM User ORDER BY createdAt').all()
console.log('\n-- users --')
for (const u of users as any[]) console.log(`${u.name}  role=${u.role} status=${u.status}`)

const nodes = db.query('SELECT code, name, isDemo, status FROM Node ORDER BY code').all()
console.log('\n-- nodes --')
for (const n of nodes as any[])
  console.log(`${n.code}  ${n.name}  isDemo=${n.isDemo} status=${n.status}`)

const hosts = db.query("SELECT code, name, kind, address FROM Host ORDER BY kind, code").all()
console.log('\n-- hosts --')
for (const h of hosts as any[]) console.log(`${h.code}  kind=${h.kind}  ${h.address}`)

const settings = db.query('SELECT key, value FROM Setting').all()
console.log('\n-- settings --')
for (const s of settings as any[]) console.log(`${s.key} = ${s.value}`)

db.close()
