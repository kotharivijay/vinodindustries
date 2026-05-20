// Probe Yash Collection (Lucknow) existing data so the FY24-25 backfill
// uses the canonical party name + matches existing party state spelling.
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

console.log('— Party name variants on KsiSalesInvoice —')
const variants = await db.ksiSalesInvoice.groupBy({
  by: ['partyName'],
  where: { partyName: { contains: 'yash', mode: 'insensitive' } },
  _count: { _all: true },
})
for (const v of variants) console.log(`  [${v._count._all}x] "${v.partyName}"`)
if (variants.length === 0) console.log('  (no rows)')

console.log('\n— Canonical (any) ledger in TallyLedger matching "yash collection" —')
const ledgers = await db.tallyLedger.findMany({
  where: { name: { contains: 'yash', mode: 'insensitive' }, firmCode: 'KSI' },
  select: { id: true, name: true, parent: true, gstNo: true, address: true, state: true, mobileNos: true },
})
for (const l of ledgers) {
  console.log(`  id=${l.id}  name="${l.name}"  state=${l.state || '—'}  gst=${l.gstNo || '—'}  parent=${l.parent || '—'}`)
}

console.log('\n— Existing FY 24-25 invoices on this party (if any) —')
const fy2425 = await db.ksiSalesInvoice.findMany({
  where: {
    partyName: { contains: 'yash', mode: 'insensitive' },
    fy: '24-25',
  },
  select: { id: true, vchNumber: true, vchType: true, date: true, totalAmount: true, partyName: true },
  orderBy: { date: 'asc' },
})
for (const i of fy2425) console.log(`  id=${i.id}  ${i.vchType} ${i.vchNumber}  ${i.date.toISOString().slice(0, 10)}  ₹${i.totalAmount}  party="${i.partyName}"`)
if (fy2425.length === 0) console.log('  (no rows — fresh backfill)')

console.log('\n— vchType most-common across FY 25-26 (for a sane default) —')
const recent = await db.ksiSalesInvoice.findMany({
  where: {
    partyName: { contains: 'yash', mode: 'insensitive' },
  },
  select: { vchType: true, partyGstin: true, stateName: true, placeOfSupply: true },
  take: 5,
})
for (const r of recent) console.log(`  type=${r.vchType}  gstin=${r.partyGstin}  state=${r.stateName}  pos=${r.placeOfSupply}`)

await db.$disconnect()
