// Dry-run plan for marka → RP-XX remap.
// Markas (under Rohan Process) used as fake lots in folds 63/87/89/90:
//   Kishan, Pista, Sita, Vishal, Ram
// Source RP-XX lots are identified by GreyEntry rows under Rohan Process whose
// `marka` column matches one of those names.
// Target rows: foldBatchLot.lotNo IN markas under those folds + their dyeingEntry / dyeingEntryLot rows.
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const MARKAS = ['Kishan', 'Pista', 'Sita', 'Vishal', 'Ram']
const FOLD_NOS = ['63', '87', '89', '90']

const norm = s => (s || '').trim().toLowerCase()
const eqMarka = (a, b) => norm(a) === norm(b)

async function main() {
  // 1) Source RP lots: GreyEntry rows where party = Rohan Process and marka in MARKAS
  const greyParty = await prisma.party.findFirst({ where: { name: { contains: 'Rohan Process', mode: 'insensitive' } } })
  if (!greyParty) { console.log('Rohan Process party not found in Party table'); process.exit(1) }

  const greys = await prisma.greyEntry.findMany({
    where: { partyId: greyParty.id, marka: { in: MARKAS, mode: 'insensitive' } },
    select: { id: true, lotNo: true, marka: true, than: true, date: true },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
  })

  // Aggregate source capacity per (marka, lotNo)
  const sourcesByMarka = new Map()
  for (const g of greys) {
    const m = MARKAS.find(x => eqMarka(x, g.marka))
    if (!m) continue
    if (!sourcesByMarka.has(m)) sourcesByMarka.set(m, new Map())
    const lotMap = sourcesByMarka.get(m)
    lotMap.set(g.lotNo, (lotMap.get(g.lotNo) || 0) + g.than)
  }

  console.log('=== SOURCE CAPACITY (marka → RP-lot total than) ===')
  for (const m of MARKAS) {
    const lots = sourcesByMarka.get(m)
    if (!lots) { console.log(`${m}: (no grey rows found)`); continue }
    const total = [...lots.values()].reduce((a, b) => a + b, 0)
    console.log(`${m}: total=${total}`)
    for (const [lot, t] of lots) console.log(`   ${lot}: ${t}`)
  }

  // 2) Target foldBatchLot rows in folds 63/87/89/90 with lotNo in MARKAS
  const folds = await prisma.foldProgram.findMany({
    where: { foldNo: { in: FOLD_NOS } },
    select: { id: true, foldNo: true },
  })
  const foldIds = folds.map(f => f.id)
  const foldNoById = new Map(folds.map(f => [f.id, f.foldNo]))

  const batches = await prisma.foldBatch.findMany({
    where: { foldProgramId: { in: foldIds } },
    select: { id: true, batchNo: true, foldProgramId: true, lots: { select: { id: true, lotNo: true, than: true } } },
    orderBy: [{ foldProgramId: 'asc' }, { batchNo: 'asc' } ],
  })

  // Flat list of foldBatchLot rows we need to remap
  const fbRows = []
  for (const b of batches) {
    const foldNo = foldNoById.get(b.foldProgramId)
    for (const l of b.lots) {
      if (MARKAS.some(m => eqMarka(m, l.lotNo))) {
        fbRows.push({
          id: l.id,
          foldNo,
          batchNo: b.batchNo,
          batchId: b.id,
          marka: MARKAS.find(m => eqMarka(m, l.lotNo)),
          than: l.than,
        })
      }
    }
  }
  // Order: foldNo asc, batchNo asc, id asc — same chronological order capacity should fill
  fbRows.sort((a, b) => a.foldNo - b.foldNo || a.batchNo - b.batchNo || a.id - b.id)

  console.log('\n=== TARGET foldBatchLot rows (marka-tagged) ===')
  console.log('total rows:', fbRows.length)
  const needByMarka = new Map()
  for (const r of fbRows) {
    needByMarka.set(r.marka, (needByMarka.get(r.marka) || 0) + r.than)
  }
  for (const [m, n] of needByMarka) {
    const cap = sourcesByMarka.get(m) ? [...sourcesByMarka.get(m).values()].reduce((a, b) => a + b, 0) : 0
    console.log(`  ${m}: need=${n} cap=${cap} ${n > cap ? '*** OVERFLOW ***' : (cap - n > 0 ? `(spare ${cap - n})` : '(exact)')}`)
  }

  // 3) FIFO allocator per marka — fill source RP lots in order they were entered
  // Build queue per marka: [{lotNo, remaining}]
  const queues = new Map()
  for (const m of MARKAS) {
    const lotMap = sourcesByMarka.get(m)
    if (!lotMap) { queues.set(m, []); continue }
    // Order RP lots by their first GreyEntry date
    const firstSeen = new Map()
    for (const g of greys) {
      if (!eqMarka(g.marka, m)) continue
      if (!firstSeen.has(g.lotNo)) firstSeen.set(g.lotNo, g.date)
    }
    const arr = [...lotMap.entries()]
      .map(([lot, total]) => ({ lotNo: lot, remaining: total, firstDate: firstSeen.get(lot) }))
      .sort((a, b) => (a.firstDate?.getTime() || 0) - (b.firstDate?.getTime() || 0))
    queues.set(m, arr)
  }

  // For each foldBatchLot row, assign source(s)
  // If a row's than fits entirely in current queue head — single mapping
  // If not — split into multiple foldBatchLot rows (1 update + N inserts), record as "SPLIT"
  console.log('\n=== ROW-BY-ROW PLAN (foldBatchLot) ===')
  const fbPlan = [] // each entry: { id, marka, originalThan, assignments: [{lotNo, than}] }
  for (const r of fbRows) {
    const q = queues.get(r.marka)
    let need = r.than
    const assignments = []
    while (need > 0 && q.length) {
      const head = q[0]
      if (head.remaining <= 0) { q.shift(); continue }
      const take = Math.min(need, head.remaining)
      assignments.push({ lotNo: head.lotNo, than: take })
      head.remaining -= take
      need -= take
      if (head.remaining <= 0) q.shift()
    }
    if (need > 0) {
      assignments.push({ lotNo: '*** UNALLOCATED ***', than: need })
    }
    fbPlan.push({ ...r, assignments })
    const tag = assignments.length === 1 ? '' : ' [SPLIT]'
    console.log(`fold ${r.foldNo} batch ${r.batchNo} · fbLotId=${r.id} · ${r.marka}/${r.than}${tag}`)
    for (const a of assignments) console.log(`    → ${a.lotNo} / ${a.than}`)
  }

  // 4) Now compute dyeingEntry parent + dyeingEntryLot child remaps
  // dyeingEntryLot has same shape (lotNo, than) keyed to dyeingEntryId
  // Each FoldBatch links to dyeingEntries via foldBatchId — find the slips for our batches
  const slipBatchIds = batches.map(b => b.id)
  const slips = await prisma.dyeingEntry.findMany({
    where: { foldBatchId: { in: slipBatchIds } },
    select: {
      id: true, slipNo: true, lotNo: true, than: true, date: true, foldBatchId: true,
      lots: { select: { id: true, lotNo: true, than: true } },
    },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
  })

  // Build a foldBatchId → batch info lookup so we can show fold/batch for each slip
  const batchInfoById = new Map(batches.map(b => [b.id, { foldNo: foldNoById.get(b.foldProgramId), batchNo: b.batchNo }]))

  // For dyeing children, the lot composition is supposed to mirror foldBatchLot composition.
  // We'll map them with the SAME plan we built for fbPlan — i.e., for each child, find the
  // matching fbPlan entry by (foldBatchId via slip → batch → fbRows in that batch + marka match).
  // Simpler: build a lookup keyed (batchId, marka) → list of assignments from fbPlan, consumed in order.
  const planByBatchMarka = new Map() // key=`${batchId}|${marka}` → array of assignments[] copies
  for (const p of fbPlan) {
    const key = `${p.batchId}|${p.marka}`
    if (!planByBatchMarka.has(key)) planByBatchMarka.set(key, [])
    planByBatchMarka.get(key).push({ originalThan: p.originalThan, assignments: [...p.assignments] })
  }

  console.log('\n=== ROW-BY-ROW PLAN (dyeingEntryLot) ===')
  const slipPlan = [] // { slipId, slipNo, lotNo (parent current), parentNew, children: [{id, marka, than, assignments[]}] }
  for (const s of slips) {
    // Skip slips with no marka children (already real RP lots)
    const markaChildren = s.lots.filter(l => MARKAS.some(m => eqMarka(m, l.lotNo)))
    if (!markaChildren.length) continue

    const bi = batchInfoById.get(s.foldBatchId)
    console.log(`slip ${s.slipNo} (id=${s.id}) · fold ${bi?.foldNo} batch ${bi?.batchNo} · parent.lotNo='${s.lotNo}'`)

    const childAssignments = []
    for (const c of markaChildren) {
      const m = MARKAS.find(x => eqMarka(x, c.lotNo))
      // For dye children, allocate within the same batch — but dye than may be < fold than
      // (e.g. fold batch had 50, slip processed 30 only). We need to match marka than within the batch.
      // Easiest: walk fbPlan assignments for this (batchId, marka) and consume than for the slip.
      const key = `${s.foldBatchId}|${m}`
      const bucket = planByBatchMarka.get(key) || []
      // Bucket is an ARRAY of fold-row plans (one per foldBatchLot row of this marka in this batch)
      // For each, consume its assignments list in FIFO order. We'll flatten.
      // But since dye children mirror fold children one-to-one in count, we can simply pop the next bucket entry.
      const fbEntry = bucket.shift()
      if (!fbEntry) {
        console.log(`   child fbLot=${c.id} ${m}/${c.than} → *** NO MATCHING FOLD ROW ***`)
        continue
      }
      // Within fbEntry.assignments, consume than equal to c.than (might be ≤ fbEntry.originalThan)
      let need = c.than
      const assigns = []
      while (need > 0 && fbEntry.assignments.length) {
        const head = fbEntry.assignments[0]
        const take = Math.min(need, head.than)
        assigns.push({ lotNo: head.lotNo, than: take })
        head.than -= take
        need -= take
        if (head.than <= 0) fbEntry.assignments.shift()
      }
      // Re-push remaining fbEntry if any leftover (shouldn't matter — slip consumes ≤ fold)
      if (fbEntry.assignments.length) bucket.unshift(fbEntry)

      const tag = assigns.length === 1 ? '' : ' [SPLIT]'
      console.log(`   child id=${c.id} · ${m}/${c.than}${tag}`)
      for (const a of assigns) console.log(`       → ${a.lotNo} / ${a.than}`)
      childAssignments.push({ id: c.id, marka: m, than: c.than, assignments: assigns })
    }

    // Parent lotNo: pick dominant child mapping (largest than)
    const totals = new Map()
    for (const ch of childAssignments) {
      for (const a of ch.assignments) {
        if (a.lotNo.startsWith('***')) continue
        totals.set(a.lotNo, (totals.get(a.lotNo) || 0) + a.than)
      }
    }
    let parentNew = s.lotNo
    let max = 0
    for (const [lot, t] of totals) if (t > max) { max = t; parentNew = lot }
    console.log(`   → parent.lotNo: '${s.lotNo}' → '${parentNew}'`)
    slipPlan.push({ slipId: s.id, slipNo: s.slipNo, parentOld: s.lotNo, parentNew, children: childAssignments })
  }

  console.log('\n=== SUMMARY ===')
  console.log(`foldBatchLot rows to remap: ${fbPlan.length}`)
  console.log(`  splits (need to break into multiple rows): ${fbPlan.filter(p => p.assignments.length > 1).length}`)
  console.log(`dyeingEntry slips to update parent.lotNo: ${slipPlan.length}`)
  console.log(`dyeingEntryLot child rows to remap: ${slipPlan.reduce((s, p) => s + p.children.length, 0)}`)
  console.log(`  child splits: ${slipPlan.reduce((s, p) => s + p.children.filter(c => c.assignments.length > 1).length, 0)}`)
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
