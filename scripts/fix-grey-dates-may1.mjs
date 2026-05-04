import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const TARGET_SNS = [107, 108, 109, 110, 111, 112, 113]
const NEW_DATE = new Date('2026-05-01T00:00:00.000Z')

async function main() {
  const before = await prisma.greyEntry.findMany({
    where: { sn: { in: TARGET_SNS } },
    select: { id: true, sn: true, lotNo: true, date: true, challanNo: true },
    orderBy: { sn: 'asc' },
  })
  console.log('Before:')
  for (const g of before) console.log(`  sn=${g.sn} lot=${g.lotNo} challan=${g.challanNo} date=${g.date.toISOString().slice(0,10)}`)

  const r = await prisma.greyEntry.updateMany({
    where: { sn: { in: TARGET_SNS } },
    data: { date: NEW_DATE },
  })
  console.log(`\nUpdated ${r.count} rows.`)

  const after = await prisma.greyEntry.findMany({
    where: { sn: { in: TARGET_SNS } },
    select: { id: true, sn: true, lotNo: true, date: true, challanNo: true },
    orderBy: { sn: 'asc' },
  })
  console.log('\nAfter:')
  for (const g of after) console.log(`  sn=${g.sn} lot=${g.lotNo} challan=${g.challanNo} date=${g.date.toISOString().slice(0,10)}`)
}
main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
