import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const agg = await prisma.greyEntry.aggregate({
  where: { sn: { gt: 0 } },
  _max: { sn: true }, _count: true,
})
console.log('Aggregate (sn > 0):', agg)

const aggAll = await prisma.greyEntry.aggregate({ _max: { sn: true }, _count: true })
console.log('Aggregate (all rows):', aggAll)

const high = await prisma.greyEntry.findMany({
  where: { sn: { gt: 1000 } },
  select: { id: true, sn: true, date: true, lotNo: true },
  take: 20,
  orderBy: { sn: 'desc' },
})
console.log(`\nRows with sn > 1000 (${high.length}):`)
for (const r of high) console.log(`  sn=${r.sn} id=${r.id} lot=${r.lotNo}`)

await prisma.$disconnect()
