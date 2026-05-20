// Backfill 7 historical Yash Collection (Lucknow) sales invoices into
// KsiSalesInvoice for FY 24-25. Header-only — no item lines / ledger
// detail because the source data is only date + vchNumber + amount.
// Idempotent via upsert on the natural key (vchNumber, date, vchType).
//
// USAGE
//   node scripts/backfill-yash-fy2425.mjs           # dry-run (default)
//   node scripts/backfill-yash-fy2425.mjs --apply   # write
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

const APPLY = process.argv.includes('--apply')
const PARTY = 'Yash Collection (Lucknow)'
const FY = '24-25'
const VCH_TYPE = 'Process Job'
const PARTY_GSTIN = '09AEIPA9801M1Z9'
const STATE = 'Uttar Pradesh'

// User-supplied list. Dates are DD-MM-YY → ISO YYYY-MM-DD.
const rows = [
  { date: '2025-02-17', vchNumber: 'KSI/24-25/758', totalAmount: 6061 },
  { date: '2025-03-04', vchNumber: 'KSI/24-25/780', totalAmount: 16781 },
  { date: '2025-03-18', vchNumber: 'KSI/24-25/796', totalAmount: 31112 },
  { date: '2025-03-18', vchNumber: 'KSI/24-25/797', totalAmount: 21238 },
  { date: '2025-03-18', vchNumber: 'KSI/24-25/798', totalAmount: 7455 },
  { date: '2025-03-27', vchNumber: 'KSI/24-25/810', totalAmount: 17744 },
  { date: '2025-03-27', vchNumber: 'KSI/24-25/809', totalAmount: 13380 },
]

console.log(`Mode: ${APPLY ? 'APPLY (will write)' : 'DRY-RUN (read-only)'}`)
console.log(`Party: ${PARTY}  FY: ${FY}  vchType: ${VCH_TYPE}`)
console.log(`Rows planned: ${rows.length}\n`)

let willCreate = 0
let willSkip = 0
for (const r of rows) {
  const existing = await db.ksiSalesInvoice.findUnique({
    where: { ksi_sales_natural_key: { vchNumber: r.vchNumber, date: new Date(r.date), vchType: VCH_TYPE } },
    select: { id: true, totalAmount: true, partyName: true },
  })
  if (existing) {
    console.log(`  SKIP  ${r.vchNumber}  ${r.date}  (already in DB, id=${existing.id}, party="${existing.partyName}")`)
    willSkip++
    continue
  }
  console.log(`  CREATE  ${r.vchNumber}  ${r.date}  ₹${r.totalAmount}`)
  willCreate++
  if (APPLY) {
    await db.ksiSalesInvoice.create({
      data: {
        fy: FY,
        date: new Date(r.date),
        vchNumber: r.vchNumber,
        vchType: VCH_TYPE,
        partyName: PARTY,
        partyGstin: PARTY_GSTIN,
        stateName: STATE,
        placeOfSupply: STATE,
        totalAmount: r.totalAmount,
        // header-only — no lines/ledgers/taxable for this manual backfill
      },
    })
  }
}

console.log(`\n${APPLY ? 'Wrote' : 'Would write'}: ${willCreate} row(s).  Skipped existing: ${willSkip}.`)
if (!APPLY) console.log(`\nDry-run complete. Re-run with --apply to write.`)

await db.$disconnect()
