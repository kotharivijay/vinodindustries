import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const top = await prisma.greyEntry.findMany({
  where: { sn: { gt: 0 } },
  orderBy: { sn: 'desc' },
  take: 15,
  select: { id: true, sn: true, lotNo: true, date: true, challanNo: true, party: { select: { name: true } } },
})
console.log('Top 15 by SN:')
for (const r of top) console.log(`  sn=${r.sn} id=${r.id} date=${r.date.toISOString().slice(0,10)} ch=${r.challanNo} lot=${r.lotNo} party=${r.party?.name}`)

const around130 = await prisma.greyEntry.findMany({
  where: { sn: { gte: 100, lte: 200 } },
  orderBy: { sn: 'desc' },
  take: 15,
  select: { id: true, sn: true, lotNo: true, date: true },
})
console.log('\nSNs 100-200:')
for (const r of around130) console.log(`  sn=${r.sn} id=${r.id} date=${r.date.toISOString().slice(0,10)} lot=${r.lotNo}`)

await prisma.$disconnect()
