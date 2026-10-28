// Verify both host DBs received the multi-tenant schema.
import { PrismaClient } from '@prisma/client'

async function check(url: string) {
  const db = new PrismaClient({ datasources: { db: { url } } })
  const tables = await db.$queryRawUnsafe<{ name: string }[]>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('User','Session','Setting')`,
  )
  const cols = await db.$queryRawUnsafe<{ name: string }[]>(`PRAGMA table_info(Node)`)
  console.log(
    url,
    '| tables:', tables.map((t) => t.name).join(',') || 'MISSING',
    '| Node.ownerId:', cols.some((c) => c.name === 'ownerId') ? 'OK' : 'MISSING',
  )
  await db.$disconnect()
}

await check('file:/home/z/my-project/nodehost/db/host-alfa.db')
await check('file:/home/z/my-project/nodehost/db/host-beta.db')
