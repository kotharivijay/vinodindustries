// One-shot data fix: for each partyName drift group flagged by
// audit-partyname-drift.mjs, rewrite KsiSalesInvoice + KsiHdfcReceipt rows
// to match the canonical TallyLedger spelling.
//
// Idempotent — running it twice is a no-op (the second run finds zero
// rows to update). Re-runnable safely after a fresh sync that
// reintroduces drift.
//
// USAGE
//   node scripts/fix-partyname-drift.mjs           # dry-run, no writes
//   node scripts/fix-partyname-drift.mjs --apply   # write the updates
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

const APPLY = process.argv.includes('--apply')
const canon = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase()

const invRows = await db.ksiSalesInvoice.groupBy({
  by: ['partyName'],
  _count: { _all: true },
})
const rcptRows = await db.ksiHdfcReceipt.groupBy({
  by: ['partyName'],
  where: { hidden: false },
  _count: { _all: true },
})

// Build canonical → set of raw spellings + per-table counts
const groups = new Map() // canonKey → { raws: Map<raw, { inv: number, rcpt: number }> }
const bump = (raw, kind, count) => {
  const k = canon(raw)
  if (!k) return
  if (!groups.has(k)) groups.set(k, new Map())
  const inner = groups.get(k)
  if (!inner.has(raw)) inner.set(raw, { inv: 0, rcpt: 0 })
  inner.get(raw)[kind] += count
}
for (const r of invRows) bump(r.partyName, 'inv', r._count._all)
for (const r of rcptRows) bump(r.partyName, 'rcpt', r._count._all)

const ledgers = await db.tallyLedger.findMany({
  where: { firmCode: 'KSI' },
  select: { id: true, name: true },
})
const ledgerByCanon = new Map()
for (const l of ledgers) {
  const k = canon(l.name)
  if (!ledgerByCanon.has(k)) ledgerByCanon.set(k, [])
  ledgerByCanon.get(k).push(l)
}

const plan = [] // { canonicalName, raw, invCount, rcptCount }
for (const [k, inner] of groups) {
  if (inner.size <= 1) continue // no drift
  const matches = ledgerByCanon.get(k) || []
  if (matches.length === 0) {
    console.log(`SKIP: no TallyLedger for canonical "${k}" — raw spellings: ${[...inner.keys()].map(s => `"${s}"`).join(', ')}`)
    continue
  }
  if (matches.length > 1) {
    console.log(`SKIP: ${matches.length} TallyLedgers share canonical "${k}" — manual review needed`)
    continue
  }
  const canonical = matches[0].name
  for (const [raw, c] of inner) {
    if (raw === canonical) continue // already aligned
    plan.push({ canonicalName: canonical, raw, invCount: c.inv, rcptCount: c.rcpt })
  }
}

console.log(`\nMode: ${APPLY ? 'APPLY (will write)' : 'DRY-RUN (read-only)'}`)
console.log(`Renames planned: ${plan.length}\n`)

for (const p of plan) {
  console.log(`  "${p.raw}"`)
  console.log(`     → "${p.canonicalName}"`)
  console.log(`     invs=${p.invCount}  rcpts=${p.rcptCount}`)
}

if (!APPLY) {
  console.log('\nDry-run complete. Re-run with --apply to write.\n')
  await db.$disconnect()
  process.exit(0)
}

if (plan.length === 0) {
  console.log('\nNothing to do.\n')
  await db.$disconnect()
  process.exit(0)
}

let totalInv = 0
let totalRcpt = 0
for (const p of plan) {
  const inv = await db.ksiSalesInvoice.updateMany({
    where: { partyName: p.raw },
    data: { partyName: p.canonicalName },
  })
  const rcpt = await db.ksiHdfcReceipt.updateMany({
    where: { partyName: p.raw },
    data: { partyName: p.canonicalName },
  })
  console.log(`  ✓ "${p.raw}" → "${p.canonicalName}"  invs=${inv.count}  rcpts=${rcpt.count}`)
  totalInv += inv.count
  totalRcpt += rcpt.count
}

console.log(`\nDone. Updated ${totalInv} invoice row(s) + ${totalRcpt} receipt row(s).\n`)
await db.$disconnect()
