/**
 * One-off cleanup: remove a signup test artifact (user + personal node +
 * module rows) directly from the host db. Used after a registration smoke
 * test that must not leave residue behind.
 *
 * Usage: bun scripts/cleanup-test-user.ts <name>
 */
import { PrismaClient } from '@prisma/client'

const name = process.argv[2]
if (!name) {
  console.error('usage: bun scripts/cleanup-test-user.ts <name>')
  process.exit(1)
}

const db = new PrismaClient()

const node = await db.node.findFirst({ where: { code: name } })
if (node) {
  await db.moduleStorage.deleteMany({ where: { nodeId: node.id } })
  await db.nodeModuleState.deleteMany({ where: { nodeId: node.id } })
  await db.node.delete({ where: { id: node.id } })
  console.log(`node removed: ${node.id} (${node.code})`)
} else {
  console.log('node not found — ok')
}

const user = await db.user.findUnique({ where: { name } })
if (user) {
  await db.user.delete({ where: { id: user.id } })
  console.log(`user removed: ${user.id} (${user.name})`)
} else {
  console.log('user not found — ok')
}

await db.$disconnect()
console.log('cleanup done')
