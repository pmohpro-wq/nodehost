import { prisma } from '../mini-services/nodehost-kernel/store'
const ghosts = await prisma.host.findMany({ where: { kind: 'remote', code: { startsWith: 'host-' } } })
console.log(`deleting ${ghosts.length} ghost hosts (random codes from old buggy addHost)`)
for (const g of ghosts) {
  await prisma.netDirectory.deleteMany({ where: { hostCode: g.code } })
  await prisma.host.delete({ where: { id: g.id } })
  console.log(`  - ${g.code}  ${g.address}`)
}
const remaining = await prisma.host.findMany()
console.log(`remaining hosts: ${remaining.map(h => h.code).join(', ') || '(none)'}`)
await prisma.$disconnect()
