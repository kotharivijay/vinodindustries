import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const APPLY = process.argv.includes('--apply')

const rows = await prisma.greyEntry.findMany({
  where: { lotNo: { equals: 'PSRG-130', mode: 'insensitive' } },
  select: { id: true, sn: true, lotNo: true, date: true, challanNo: true, party: { select: { name: true } } },
})
console.log(`Found ${rows.length} row(s) for lot PSRG-130:`)
for (const r of rows) {
  console.log(`  id=${r.id} sn=${r.sn} date=${r.date.toISOString().slice(0,10)} ch=${r.challanNo} party=${r.party?.name}`)
}
if (rows.length === 0) { await prisma.$disconnect(); process.exit(0) }

// Make sure SN 130 isn't already taken by some other row
const conflict = await prisma.greyEntry.findFirst({ where: { sn: 130, NOT: { lotNo: { equals: 'PSRG-130', mode: 'insensitive' } } } })
if (conflict) {
  console.log(`\n⚠ SN 130 is already used by id=${conflict.id} lot=${conflict.lotNo}. Aborting.`)
  await prisma.$disconnect(); process.exit(1)
}

if (!APPLY) {
  console.log(`\n[dry-run — pass --apply to set sn=130 on the row(s) above]`)
} else {
  const r = await prisma.greyEntry.updateMany({
    where: { lotNo: { equals: 'PSRG-130', mode: 'insensitive' } },
    data: { sn: 130 },
  })
  console.log(`\n✓ Updated ${r.count} row(s) to sn=130.`)
}
await prisma.$disconnect()
