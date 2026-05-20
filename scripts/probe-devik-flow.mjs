// Probe Devik party — confirm OB exists in LotOpeningBalance and is being
// missed by the current report API.
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

const party = await db.party.findFirst({
  where: { name: { contains: 'devik', mode: 'insensitive' } },
  select: { id: true, name: true, tag: true, lotPrefixes: true },
})
console.log('Party:', party, '\n')
if (!party) { await db.$disconnect(); process.exit(0) }

const cleanedName = (party.name || '').replace(/\s+/g, ' ').trim().toLowerCase()

const grey = await db.greyEntry.aggregate({
  where: { partyId: party.id },
  _sum: { than: true },
  _count: { _all: true },
})
console.log(`GreyEntry: ${grey._count._all} rows, ${grey._sum.than ?? 0} than\n`)

// LotOpeningBalance has no FK to Party — it stores party name as a string.
// Match case-insensitively + whitespace-tolerant.
const obAll = await db.lotOpeningBalance.findMany()
const obForParty = obAll.filter(o => {
  const n = (o.party || '').replace(/\s+/g, ' ').trim().toLowerCase()
  return n === cleanedName || n.includes(cleanedName) || cleanedName.includes(n)
})
console.log(`LotOpeningBalance matching "${cleanedName}": ${obForParty.length} rows`)
for (const o of obForParty) {
  console.log(`  lot=${o.lotNo}  party="${o.party}"  fy=${o.financialYear}  ob=${o.openingThan}  greyThan=${o.greyThan}  quality=${o.quality}  lrNo=${o.lrNo}  greyDate=${o.greyDate?.toISOString?.().slice(0, 10) ?? '—'}`)
}

// Despatch via lotNo (case-insensitive) so we can show net stock
const lotNos = obForParty.map(o => o.lotNo)
if (lotNos.length) {
  const dParent = await db.despatchEntry.groupBy({
    by: ['lotNo'],
    where: { lotNo: { in: lotNos, mode: 'insensitive' }, despatchLots: { none: {} } },
    _sum: { than: true },
  })
  const dChild = await db.despatchEntryLot.groupBy({
    by: ['lotNo'],
    where: { lotNo: { in: lotNos, mode: 'insensitive' } },
    _sum: { than: true },
  })
  console.log('\nDespatch hits on OB lots:')
  for (const o of obForParty) {
    const p = dParent.find(d => d.lotNo.toUpperCase() === o.lotNo.toUpperCase())?._sum.than ?? 0
    const c = dChild.find(d => d.lotNo.toUpperCase() === o.lotNo.toUpperCase())?._sum.than ?? 0
    console.log(`  ${o.lotNo}  ob=${o.openingThan}  desp=${p + c}  bal=${o.openingThan - (p + c)}`)
  }
}

await db.$disconnect()
