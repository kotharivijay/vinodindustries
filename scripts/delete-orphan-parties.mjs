// Delete Party master rows that are
//   1) NOT present in TallyLedger (any firmCode), AND
//   2) NOT linked to any entry across grey / despatch / fold / finish recipes / finishRecipeTags
//
// Dry-run by default; pass --apply to actually delete.
//
// Match is case-insensitive on trimmed name. We're conservative:
// any cross-firm TallyLedger match counts as "exists in ledger".
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const APPLY = process.argv.includes('--apply')

const norm = s => (s || '').trim().toLowerCase()

async function main() {
  const [parties, ledgers] = await Promise.all([
    prisma.party.findMany({
      include: {
        _count: {
          select: {
            greyEntries: true,
            despatchEntries: true,
            foldBatchLots: true,
            finishRecipes: true,
            finishRecipeTags: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.tallyLedger.findMany({ select: { name: true, firmCode: true } }),
  ])

  // Note: 5 explicit FK tables above. Other Party-derived references may exist
  // (e.g. legacy text fields stored as party names). Those are NOT FK and
  // won't break referential integrity if the row is deleted, but flag them
  // here if the caller wants to be cautious.
  const ledgerSet = new Set(ledgers.map(l => norm(l.name)))

  const totalLinked = (p) =>
    (p._count.greyEntries
    + p._count.despatchEntries
    + p._count.foldBatchLots
    + p._count.finishRecipes
    + p._count.finishRecipeTags)

  const orphans = []
  const inLedger = []
  const linked = []

  for (const p of parties) {
    const inLedgers = ledgerSet.has(norm(p.name))
    const links = totalLinked(p)
    if (!inLedgers && links === 0) orphans.push(p)
    else if (inLedgers) inLedger.push(p)
    else linked.push(p) // not in ledger but linked — keep
  }

  console.log(`Total parties:           ${parties.length}`)
  console.log(`In TallyLedger master:   ${inLedger.length}`)
  console.log(`Not in ledger but used:  ${linked.length}`)
  console.log(`Not in ledger AND unused (deletable): ${orphans.length}`)

  if (linked.length) {
    console.log('\nNot in ledger but USED — kept (sample 20):')
    for (const p of linked.slice(0, 20)) {
      console.log(`  - ${p.name}  (g:${p._count.greyEntries} d:${p._count.despatchEntries} f:${p._count.foldBatchLots} fr:${p._count.finishRecipes + p._count.finishRecipeTags})`)
    }
    if (linked.length > 20) console.log(`  ... +${linked.length - 20} more`)
  }

  console.log(`\n--- Deletable parties (${orphans.length}) ---`)
  for (const p of orphans) console.log(`  id=${p.id}  ${p.name}${p.tag ? `  [${p.tag}]` : ''}`)

  if (!APPLY) {
    console.log('\n[dry-run only — pass --apply to delete]')
    return
  }
  if (orphans.length === 0) { console.log('Nothing to delete.'); return }

  // Delete in chunks to keep the transaction sane
  const BATCH = 500
  let deleted = 0
  for (let i = 0; i < orphans.length; i += BATCH) {
    const chunk = orphans.slice(i, i + BATCH).map(p => p.id)
    const r = await prisma.party.deleteMany({ where: { id: { in: chunk } } })
    deleted += r.count
  }
  console.log(`\nDeleted ${deleted} party rows.`)
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
