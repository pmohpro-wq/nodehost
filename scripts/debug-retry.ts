import { PrismaClient } from '@prisma/client'
const p = new PrismaClient({ datasources: { db: { url: 'file:/home/z/my-project/db/host-alfa.db' } } })
const rows = await p.nhpMessage.findMany({
  where: { status: 'queued', channel: 'remote', direction: 'out', attempts: { lt: 6 } },
})
console.log('matched rows:', rows.length)
for (const r of rows) {
  console.log('env col length:', r.envelope.length)
  const env = JSON.parse(r.envelope)
  console.log('isValid:', env.nhp === 1 && !!env.id && !!env.type && !!env.module && !!env.from && !!env.to)
  console.log('toHost:', env.to?.host)
}
await p.$disconnect()
