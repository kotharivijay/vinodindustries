import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const taggedParties = await prisma.party.count({ where: { tag: { not: null } } })
console.log('Party rows with tag set:', taggedParties)

const sample = await prisma.party.findMany({
  where: { tag: { not: null } },
  select: { id: true, name: true, tag: true },
  orderBy: { name: 'asc' },
  take: 20,
})
console.log('\nSample tagged parties:')
for (const p of sample) console.log(`  ${p.name}  tag="${p.tag}"`)
await prisma.$disconnect()
