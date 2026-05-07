// Find the closest TallyLedger match for each Party that's NOT in the ledger
// master, and propose a rename so future ledger syncs / tag pills / dropdowns
// recognise the row.
//
// Match heuristic: case-insensitive token overlap with substring containment
// boost. Top candidate is shown with a confidence score; ambiguous ties are
// flagged for manual decision.
//
// Dry-run by default. Pass --apply to execute the renames.

import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const APPLY = process.argv.includes('--apply')

const norm = s => (s || '').trim().toLowerCase()
const tokens = s => norm(s).split(/[\s\-_().,/]+/).filter(t => t.length >= 2)

function score(partyName, ledgerName) {
  const pT = tokens(partyName)
  const lT = tokens(ledgerName)
  if (pT.length === 0 || lT.length === 0) return 0
  const lSet = new Set(lT)
  let common = 0
  for (const t of pT) if (lSet.has(t)) common++
  // proportion of party tokens that landed in the ledger name
  const tokenScore = common / pT.length
  // bonus when the entire party name appears as a substring of the ledger name
  const containBonus = norm(ledgerName).includes(norm(partyName)) ? 0.3 : 0
  // small penalty for very long ledger names so "X Textiles" wins over "X Textiles Pvt Ltd Tax Codes Etc"
  const lengthPenalty = Math.min(0.1, Math.max(0, lT.length - pT.length) * 0.02)
  return tokenScore + containBonus - lengthPenalty
}

async function main() {
  const [parties, ledgers] = await Promise.all([
    prisma.party.findMany({
      include: {
        _count: {
          select: {
            greyEntries: true, despatchEntries: true,
            foldBatchLots: true, finishRecipes: true, finishRecipeTags: true,
          },
        },
      },
    }),
    prisma.tallyLedger.findMany({ where: { firmCode: 'KSI' }, select: { id: true, name: true, parent: true } }),
  ])

  const ledgerSet = new Set(ledgers.map(l => norm(l.name)))
  const partyNameSet = new Set(parties.map(p => norm(p.name)))
  const totalRefs = (p) => p._count.greyEntries + p._count.despatchEntries
    + p._count.foldBatchLots + p._count.finishRecipes + p._count.finishRecipeTags

  const candidates = parties
    .filter(p => !ledgerSet.has(norm(p.name)) && totalRefs(p) > 0)

  if (candidates.length === 0) { console.log('Nothing to relink.'); return }

  console.log(`Found ${candidates.length} parties not in ledger but linked to entries.\n`)

  const plans = []
  for (const p of candidates) {
    const scored = ledgers
      .map(l => ({ ledger: l, s: score(p.name, l.name) }))
      .filter(x => x.s > 0.3)
      .sort((a, b) => b.s - a.s)
      .slice(0, 5)
    const best = scored[0]
    plans.push({
      partyId: p.id, partyName: p.name, refs: totalRefs(p),
      bestLedger: best?.ledger ?? null, bestScore: best?.s ?? 0,
      runners: scored.slice(1).map(x => ({ name: x.ledger.name, score: x.s })),
    })
  }

  // Group by certainty
  const HIGH = 0.95
  const certain = plans.filter(p => p.bestScore >= HIGH)
  const fuzzy = plans.filter(p => p.bestScore > 0.5 && p.bestScore < HIGH)
  const blank = plans.filter(p => p.bestScore <= 0.5 || !p.bestLedger)

  console.log('=== HIGH-CONFIDENCE renames (score ≥ 0.95) ===')
  for (const p of certain) {
    console.log(`  [${p.partyId}] "${p.partyName}"  →  "${p.bestLedger.name}"  (refs: ${p.refs})`)
  }

  console.log(`\n=== FUZZY matches (0.5–0.95) — review before --apply ===`)
  for (const p of fuzzy) {
    console.log(`  [${p.partyId}] "${p.partyName}"  →  "${p.bestLedger.name}"  score=${p.bestScore.toFixed(2)}  (refs: ${p.refs})`)
    if (p.runners.length) {
      console.log(`     runners: ${p.runners.map(r => `"${r.name}" (${r.score.toFixed(2)})`).join(', ')}`)
    }
  }

  if (blank.length) {
    console.log(`\n=== NO MATCH (must be done manually or added to TallyLedger) ===`)
    for (const p of blank) {
      console.log(`  [${p.partyId}] "${p.partyName}"  (refs: ${p.refs})  best="${p.bestLedger?.name ?? '(none)'}" ${p.bestScore.toFixed(2)}`)
    }
  }

  // Apply only HIGH renames automatically; leave fuzzy + blank for the user
  if (!APPLY) {
    console.log(`\n[dry-run only — pass --apply to rename the ${certain.length} HIGH-confidence parties]`)
    return
  }

  if (certain.length === 0) { console.log('\nNothing to apply.'); return }

  let renamed = 0, conflicts = 0
  for (const p of certain) {
    const target = p.bestLedger.name
    // Guard: a Party row may already exist with this name (the canonical one).
    // In that case we shouldn't overwrite — operator should run a separate
    // merge (move FK refs from p.partyId → existing party's id) instead.
    const existing = await prisma.party.findUnique({ where: { name: target } })
    if (existing && existing.id !== p.partyId) {
      console.log(`  CONFLICT: "${target}" already exists (id=${existing.id}). Skipping rename of [${p.partyId}].`)
      conflicts++
      continue
    }
    await prisma.party.update({ where: { id: p.partyId }, data: { name: target } })
    console.log(`  ✓ renamed [${p.partyId}] → "${target}"`)
    renamed++
  }
  console.log(`\nDone. Renamed ${renamed}, conflicts ${conflicts}.`)
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
