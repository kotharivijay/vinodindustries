import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  // Look around PS-109 — sn 107..112
  const greys = await prisma.greyEntry.findMany({
    where: { sn: { in: [105, 106, 107, 108, 109, 110, 111, 112, 113, 114] } },
    select: {
      id: true, sn: true, lotNo: true, date: true, challanNo: true,
      createdAt: true, updatedAt: true,
      than: true,
      party: { select: { name: true } },
    },
    orderBy: [{ sn: 'asc' }, { id: 'asc' }],
  })
  for (const g of greys) {
    console.log(`sn=${g.sn} lotNo=${g.lotNo}  date=${g.date.toISOString().slice(0,10)}  createdAt=${g.createdAt.toISOString().slice(0,16)}  challan=${g.challanNo}  ${g.party?.name || '-'}  than=${g.than}`)
  }

  console.log('\n-- All grey rows on 2026-05-01 (1 May) --')
  const may1 = await prisma.greyEntry.findMany({
    where: { date: { gte: new Date('2026-05-01T00:00:00Z'), lt: new Date('2026-05-02T00:00:00Z') } },
    select: { id: true, sn: true, lotNo: true, challanNo: true, than: true, party: { select: { name: true } } },
    orderBy: { sn: 'asc' },
  })
  for (const g of may1) {
    console.log(`sn=${g.sn} id=${g.id} lotNo=${g.lotNo}  challan=${g.challanNo}  party=${g.party?.name || '-'}  than=${g.than}`)
  }

  console.log('\n-- All grey rows on 2026-01-05 (5 Jan) for Prakash ShIrting --')
  const jan5 = await prisma.greyEntry.findMany({
    where: { date: { gte: new Date('2026-01-05T00:00:00Z'), lt: new Date('2026-01-06T00:00:00Z') } },
    select: { id: true, sn: true, lotNo: true, challanNo: true, than: true, party: { select: { name: true } } },
    orderBy: { sn: 'asc' },
  })
  for (const g of jan5) {
    console.log(`sn=${g.sn} id=${g.id} lotNo=${g.lotNo}  challan=${g.challanNo}  party=${g.party?.name || '-'}  than=${g.than}`)
  }
}
main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
