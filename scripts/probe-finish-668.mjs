// Probe finish entry slipNo=668 + lot SSN-179-LOVE to see what's stored
// vs what the user reports seeing. Read-only.
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

const entries = await db.finishEntry.findMany({
  where: {
    OR: [
      { slipNo: 668 },
      { lots: { some: { lotNo: { contains: 'SSN-179', mode: 'insensitive' } } } },
    ],
  },
  include: {
    lots: true,
  },
  orderBy: { id: 'desc' },
})

console.log(`Found ${entries.length} matching FinishEntry row(s).\n`)
for (const e of entries) {
  console.log(`FE id=${e.id}  slipNo=${e.slipNo}  date=${e.date.toISOString().slice(0, 10)}`)
  console.log(`   parent lotNo="${e.lotNo}"  parent than=${e.than}  parent meter=${e.meter}`)
  console.log(`   updatedAt=${e.updatedAt.toISOString().slice(0, 19)}  createdAt=${e.createdAt.toISOString().slice(0, 19)}`)
  console.log(`   lots (${e.lots.length}):`)
  for (const l of e.lots) {
    console.log(`     FEL id=${l.id}  lotNo="${l.lotNo}"  than=${l.than}  meter=${l.meter}  dyeingEntryId=${l.dyeingEntryId}`)
  }
  console.log()
}

// Check downstream folding receipts on the FE lot(s)
const ssnLot = entries.flatMap(e => e.lots).find(l => /ssn-179/i.test(l.lotNo))
if (ssnLot) {
  console.log(`── FoldingReceipts linked to FEL id=${ssnLot.id} (SSN-179-LOVE) ──`)
  const frs = await db.foldingReceipt.findMany({
    where: { lotEntryId: ssnLot.id },
    select: { id: true, slipNo: true, date: true, than: true, lotEntryId: true, createdAt: true },
  })
  for (const fr of frs) {
    console.log(`  FR id=${fr.id}  slipNo=${fr.slipNo}  date=${fr.date.toISOString().slice(0, 10)}  than=${fr.than}`)
  }
  if (frs.length === 0) console.log('  (none)')
}

await db.$disconnect()
