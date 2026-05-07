// For each Party, derive ALL lot-no prefixes seen in their grey history,
// ordered by frequency (most-used first). Stores them as Party.lotPrefixes.
// E.g. Prakash Shirting (Process):
//   88% PS  + 12% PSRG  →  lotPrefixes = ["PS", "PSRG"]
// Operator can then auto-fill with any of those at entry time, or add/remove
// prefixes manually at /masters/parties.
//
// Algorithm:
//   1. For every greyEntry partyId=P, take the leading letters of lotNo as
//      the candidate prefix (case-insensitive, uppercased).
//   2. Group by party + prefix, count occurrences.
//   3. Drop prefixes shorter than 2 chars (avoids noise).
//   4. Sort prefixes per party by count desc.
//   5. Conflict detection: warn if the SAME prefix is the top choice for
//      two different parties.
//
// Dry-run by default. Pass --apply to write.
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const APPLY = process.argv.includes('--apply')
const MIN_LEN = 2

function extractPrefix(lotNo) {
  if (!lotNo) return null
  const m = String(lotNo).trim().match(/^([A-Za-z]+)/)
  if (!m) return null
  return m[1].toUpperCase()
}

async function main() {
  const parties = await prisma.party.findMany({
    select: {
      id: true, name: true, lotPrefixes: true,
      greyEntries: { select: { lotNo: true } },
    },
  })

  const proposals = []
  const noData = []
  for (const p of parties) {
    if (p.greyEntries.length === 0) { noData.push(p); continue }
    const counts = new Map()
    for (const g of p.greyEntries) {
      const pref = extractPrefix(g.lotNo)
      if (!pref || pref.length < MIN_LEN) continue
      counts.set(pref, (counts.get(pref) || 0) + 1)
    }
    if (counts.size === 0) { noData.push(p); continue }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
    proposals.push({
      id: p.id, name: p.name, current: p.lotPrefixes,
      proposed: sorted.map(([k]) => k),
      breakdown: sorted,
      total: p.greyEntries.length,
    })
  }

  // Conflict scan — top-prefix collisions across parties
  const topPrefixOwners = new Map()
  for (const p of proposals) {
    const top = p.proposed[0]
    if (!topPrefixOwners.has(top)) topPrefixOwners.set(top, [])
    topPrefixOwners.get(top).push(p)
  }
  const conflicts = [...topPrefixOwners.entries()].filter(([, arr]) => arr.length > 1)

  console.log(`Parties scanned:        ${parties.length}`)
  console.log(`With derivable prefix:  ${proposals.length}`)
  console.log(`No grey history:        ${noData.length}`)
  console.log(`Top-prefix conflicts:   ${conflicts.length}`)

  console.log('\n=== PROPOSALS ===')
  proposals.sort((a, b) => a.proposed[0].localeCompare(b.proposed[0]))
  for (const p of proposals) {
    const breakdown = p.breakdown.map(([k, n]) => `${k}×${n}`).join(', ')
    const same = JSON.stringify(p.current) === JSON.stringify(p.proposed)
    const change = same ? '  (unchanged)' : (p.current.length ? `  (was: ${p.current.join(', ')})` : '')
    console.log(`  [${String(p.id).padStart(3)}] ${p.proposed.join(', ').padEnd(18)}  ← ${p.name}  total=${p.total}  ${breakdown}${change}`)
  }

  if (conflicts.length) {
    console.log('\n=== TOP-PREFIX CONFLICTS — same prefix is top for multiple parties ===')
    for (const [pref, arr] of conflicts) {
      console.log(`  ${pref}:`)
      for (const p of arr) console.log(`    [${p.id}] ${p.name}`)
    }
    console.log('\nNote: arrays still get written. Operator should rename one party\'s top prefix at /masters/parties to disambiguate.')
  }

  if (!APPLY) {
    console.log('\n[dry-run only — pass --apply to write Party.lotPrefixes]')
    return
  }

  let updated = 0
  for (const p of proposals) {
    if (JSON.stringify(p.current) === JSON.stringify(p.proposed)) continue
    await prisma.party.update({ where: { id: p.id }, data: { lotPrefixes: p.proposed } })
    updated++
  }
  console.log(`\n✓ Updated ${updated} parties.`)
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
