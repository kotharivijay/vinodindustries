// Correct OB greyDate values that were mis-parsed at carry-forward import.
// User-confirmed corrections — each suspect date maps to a single corrected
// date that applies to every OB row currently stored with that suspect date.
//
// Run dry first: node scripts/fix-ob-dates.mjs
// Apply changes: node scripts/fix-ob-dates.mjs --apply
import { PrismaClient } from '@prisma/client'

const APPLY = process.argv.includes('--apply')
const prisma = new PrismaClient()

// Each entry: { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', label: '...' }
const FIXES = [
  { from: '2028-01-26', to: '2026-01-26', label: 'year 2028 → 2026' },
  { from: '2026-10-01', to: '2026-01-10', label: 'swap → 10 Jan 26' },
  { from: '2026-10-03', to: '2026-03-10', label: 'swap → 10 Mar 26' },
  { from: '2026-08-03', to: '2026-03-08', label: 'swap → 8 Mar 26' },
  { from: '2026-08-01', to: '2026-01-08', label: 'swap → 8 Jan 26' },
  { from: '2026-07-01', to: '2026-01-07', label: 'swap → 7 Jan 26' },
  { from: '2026-04-02', to: '2026-02-04', label: 'swap → 4 Feb 26' },
]

function dayRange(iso) {
  const start = new Date(iso + 'T00:00:00.000Z')
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return [start, end]
}

async function main() {
  let totalToFix = 0
  for (const fix of FIXES) {
    const [start, end] = dayRange(fix.from)
    const rows = await prisma.lotOpeningBalance.findMany({
      where: { greyDate: { gte: start, lt: end } },
      select: { id: true, lotNo: true, party: true },
      orderBy: { lotNo: 'asc' },
    })
    console.log(`\n${fix.from} → ${fix.to}  (${fix.label})`)
    console.log(`  ${rows.length} row(s):`)
    rows.forEach(r => console.log(`    ${(r.lotNo || '').padEnd(14)} ${(r.party || '').slice(0, 40)}`))
    totalToFix += rows.length
  }
  console.log(`\nTotal rows to update: ${totalToFix}`)

  if (!APPLY) {
    console.log('\n(dry run — re-run with --apply to write changes)')
    return
  }

  console.log('\nApplying…')
  let totalUpdated = 0
  for (const fix of FIXES) {
    const [start, end] = dayRange(fix.from)
    const newDate = new Date(fix.to + 'T00:00:00.000Z')
    const result = await prisma.lotOpeningBalance.updateMany({
      where: { greyDate: { gte: start, lt: end } },
      data: { greyDate: newDate },
    })
    console.log(`  ${fix.from} → ${fix.to}: updated ${result.count}`)
    totalUpdated += result.count
  }
  console.log(`\nDone: ${totalUpdated} row(s) updated`)
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
