// READ-ONLY audit. Finds every partyName in KsiSalesInvoice + KsiHdfcReceipt
// whose canonical form (lowercased, whitespace-collapsed, trimmed) has more
// than one raw spelling. For each drift group we look up the canonical
// TallyLedger row so the follow-up fix can use the live name.
//
// No writes. Run as:  node scripts/audit-partyname-drift.mjs
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

const canon = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase()
const visible = (s) => `"${s}" (len=${s.length}, ws=${(s.match(/\s/g) || []).length})`

const invRows = await db.ksiSalesInvoice.groupBy({
  by: ['partyName'],
  _count: { _all: true },
  _sum: { totalAmount: true },
})
const rcptRows = await db.ksiHdfcReceipt.groupBy({
  by: ['partyName'],
  where: { hidden: false },
  _count: { _all: true },
})

// canonKey → { rawNames: Map<rawName, { invCount, invSum, rcptCount }> }
const groups = new Map()
const bump = (raw, kind, count, sum = 0) => {
  const k = canon(raw)
  if (!k) return
  if (!groups.has(k)) groups.set(k, new Map())
  const inner = groups.get(k)
  if (!inner.has(raw)) inner.set(raw, { invCount: 0, invSum: 0, rcptCount: 0 })
  const e = inner.get(raw)
  if (kind === 'inv') { e.invCount += count; e.invSum += sum }
  else e.rcptCount += count
}
for (const r of invRows) bump(r.partyName, 'inv', r._count._all, r._sum.totalAmount || 0)
for (const r of rcptRows) bump(r.partyName, 'rcpt', r._count._all)

// Only groups with drift (>1 raw spelling) are interesting
const drift = [...groups.entries()].filter(([, inner]) => inner.size > 1)
drift.sort((a, b) => b[1].size - a[1].size)

console.log(`\n${drift.length} partyName drift group(s) found across ${groups.size} canonical names.\n`)

// Pull all candidate ledger names in one shot
const candidates = drift.map(([k]) => k)
const ledgers = await db.tallyLedger.findMany({
  where: { firmCode: 'KSI' },
  select: { id: true, name: true, parent: true },
})
const ledgerByCanon = new Map()
for (const l of ledgers) {
  const k = canon(l.name)
  if (!ledgerByCanon.has(k)) ledgerByCanon.set(k, [])
  ledgerByCanon.get(k).push(l)
}

for (const [k, inner] of drift) {
  const ledgerMatches = ledgerByCanon.get(k) || []
  const canonicalName = ledgerMatches[0]?.name ?? '— (no TallyLedger match) —'
  console.log(`\n• Canonical: "${canonicalName}"`)
  if (ledgerMatches.length === 0) {
    console.log('    ⚠ no TallyLedger row matches this canonical form — fix needs manual review')
  } else if (ledgerMatches.length > 1) {
    console.log(`    ⚠ ${ledgerMatches.length} TallyLedger rows share this canonical: ${ledgerMatches.map(l => `#${l.id} "${l.name}"`).join(', ')}`)
  }
  for (const [raw, e] of inner) {
    const tag = raw === canonicalName ? ' ← canonical' : ''
    console.log(`    ${visible(raw)}  invs=${e.invCount} (₹${e.invSum.toLocaleString('en-IN')})  rcpts=${e.rcptCount}${tag}`)
  }
}

console.log('\n')
await db.$disconnect()
