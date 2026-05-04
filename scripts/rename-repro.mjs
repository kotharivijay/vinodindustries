// Bulk-rename RE-PRO lots (1..21 → 101..122 with intentional gap at 107)
// + every cascade reference. Single transaction.
//
// Run dry first:   node scripts/rename-repro.mjs
// Apply changes:   node scripts/rename-repro.mjs --apply
import { PrismaClient } from '@prisma/client'

const APPLY = process.argv.includes('--apply')
const prisma = new PrismaClient()
const db = prisma

// Source → target. Listed in REVERSE source-number order so that even if
// targets overlapped sources (they don't here), no unique-constraint
// collision can occur mid-flight.
const RENAMES = [
  { from: 'RE-PRO-21', to: 'RE-PRO-122' },
  { from: 'RE-PRO-20', to: 'RE-PRO-121' },
  { from: 'RE-PRO-19', to: 'RE-PRO-120' },
  { from: 'RE-PRO-18', to: 'RE-PRO-119' },
  { from: 'RE-PRO-17', to: 'RE-PRO-118' },
  { from: 'RE-PRO-16', to: 'RE-PRO-117' },
  { from: 'RE-PRO-15', to: 'RE-PRO-116' },
  { from: 'RE-PRO-14', to: 'RE-PRO-115' },
  { from: 'RE-PRO-13', to: 'RE-PRO-114' },
  { from: 'RE-PRO-12', to: 'RE-PRO-113' },
  { from: 'RE-PRO-11', to: 'RE-PRO-112' },
  { from: 'RE-PRO-10', to: 'RE-PRO-111' },
  { from: 'RE-PRO-9',  to: 'RE-PRO-110' },
  { from: 'RE-PRO-8',  to: 'RE-PRO-109' },
  { from: 'RE-PRO-7',  to: 'RE-PRO-108' },
  // skip 107 — intentional gap
  { from: 'RE-PRO-6',  to: 'RE-PRO-106' },
  { from: 'RE-PRO-5',  to: 'RE-PRO-105' },
  { from: 'RE-PRO-4',  to: 'RE-PRO-104' },
  { from: 'RE-PRO-3',  to: 'RE-PRO-103' },
  { from: 'RE-PRO-2',  to: 'RE-PRO-102' },
  { from: 'RE-PRO-1',  to: 'RE-PRO-101' },
]

const CASCADES = [
  { name: 'FoldBatchLot',    access: 'foldBatchLot' },
  { name: 'DyeingEntry',     access: 'dyeingEntry' },
  { name: 'DyeingEntryLot',  access: 'dyeingEntryLot' },
  { name: 'FinishEntry',     access: 'finishEntry' },
  { name: 'FinishEntryLot',  access: 'finishEntryLot' },
  { name: 'DespatchEntry',   access: 'despatchEntry' },
  { name: 'DespatchEntryLot', access: 'despatchEntryLot' },
  { name: 'FoldingSlipLot',  access: 'foldingSlipLot' },
  { name: 'PackingLot',      access: 'packingLot' },
]

async function preflight() {
  const errors = []
  const fromSet = new Set(RENAMES.map(r => r.from))
  for (const { from, to } of RENAMES) {
    const src = await db.reProcessLot.findUnique({ where: { reproNo: from } })
    if (!src) errors.push(`Source missing: ${from}`)
    const dst = await db.reProcessLot.findUnique({ where: { reproNo: to } })
    if (dst && !fromSet.has(to)) errors.push(`Target ${to} already exists and is NOT scheduled to be renamed away`)
  }
  return errors
}

async function dryRun() {
  console.log('=== Planned operations ===\n')
  let totalRows = 21 // ReProcessLot rows themselves
  for (const { from, to } of RENAMES) {
    const lot = await db.reProcessLot.findUnique({ where: { reproNo: from } })
    if (!lot) { console.log(`MISSING ${from} → ${to}`); continue }
    const cascadeCounts = []
    let cascadeTotal = 0
    for (const c of CASCADES) {
      const n = await db[c.access].count({ where: { lotNo: from } })
      if (n > 0) { cascadeCounts.push(`${c.name}=${n}`); cascadeTotal += n }
    }
    totalRows += cascadeTotal
    console.log(`${from} → ${to}   id=${lot.id}, cascade rows=${cascadeTotal}${cascadeCounts.length ? ' · ' + cascadeCounts.join(', ') : ''}`)
  }
  console.log(`\nTotal rows to be touched: ${totalRows}`)
}

async function apply() {
  console.log('\n=== Applying renames in a single transaction ===\n')
  await db.$transaction(async tx => {
    for (const { from, to } of RENAMES) {
      const lot = await tx.reProcessLot.findUnique({ where: { reproNo: from } })
      if (!lot) { console.log(`SKIP ${from} (not found)`); continue }
      await tx.reProcessLot.update({ where: { id: lot.id }, data: { reproNo: to } })
      let cascadeRows = 0
      for (const c of CASCADES) {
        const r = await tx[c.access].updateMany({ where: { lotNo: from }, data: { lotNo: to } })
        cascadeRows += r.count
      }
      console.log(`OK   ${from} → ${to}   (${cascadeRows} cascade rows)`)
    }
  }, { timeout: 120000 })
  console.log('\nDone.')
}

async function main() {
  const errors = await preflight()
  if (errors.length > 0) {
    console.error('Preflight FAILED:')
    for (const e of errors) console.error('  ' + e)
    process.exit(1)
  }
  await dryRun()
  if (!APPLY) {
    console.log('\n(dry run — re-run with --apply to write changes)')
    return
  }
  await apply()
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
