import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const rows = await prisma.greyEntry.findMany({
  where: { lotNo: { equals: 'PS-44', mode: 'insensitive' } },
  select: {
    id: true, sn: true, lotNo: true, date: true, challanNo: true,
    than: true, weight: true, grayMtr: true, marka: true,
    party: { select: { name: true } },
    quality: { select: { name: true } },
  },
  orderBy: [{ date: 'asc' }, { id: 'asc' }],
})

let totalThan = 0, totalMtr = 0
console.log(`Found ${rows.length} grey row(s) for PS-44:\n`)
for (const r of rows) {
  console.log(`  sn=${r.sn} id=${r.id}  date=${r.date.toISOString().slice(0,10)}  ch=${r.challanNo}`)
  console.log(`     party=${r.party?.name}  quality=${r.quality?.name}`)
  console.log(`     than=${r.than}  weight=${r.weight}  grayMtr=${r.grayMtr || '-'}  marka=${r.marka || '-'}`)
  totalThan += r.than
  totalMtr += r.grayMtr || 0
}
console.log(`\nTOTAL  than=${totalThan}  grayMtr=${totalMtr}`)
await prisma.$disconnect()
