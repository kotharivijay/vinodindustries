// Apply marka → RP-XX remap inside a single transaction.
// Same allocation logic as remap-marka-to-lot-dryrun.mjs.
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const MARKAS = ['Kishan', 'Pista', 'Sita', 'Vishal', 'Ram']
const FOLD_NOS = ['63', '87', '89', '90']

const norm = s => (s || '').trim().toLowerCase()
const eqMarka = (a, b) => norm(a) === norm(b)

async function main() {
  const greyParty = await prisma.party.findFirst({ where: { name: { contains: 'Rohan Process', mode: 'insensitive' } } })
  if (!greyParty) throw new Error('Rohan Process party not found')

  const greys = await prisma.greyEntry.findMany({
    where: { partyId: greyParty.id, marka: { in: MARKAS, mode: 'insensitive' } },
    select: { id: true, lotNo: true, marka: true, than: true, date: true },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
  })

  const sourcesByMarka = new Map()
  for (const g of greys) {
    const m = MARKAS.find(x => eqMarka(x, g.marka))
    if (!m) continue
    if (!sourcesByMarka.has(m)) sourcesByMarka.set(m, new Map())
    const lotMap = sourcesByMarka.get(m)
    lotMap.set(g.lotNo, (lotMap.get(g.lotNo) || 0) + g.than)
  }

  const folds = await prisma.foldProgram.findMany({
    where: { foldNo: { in: FOLD_NOS } },
    select: { id: true, foldNo: true },
  })
  const foldIds = folds.map(f => f.id)
  const foldNoById = new Map(folds.map(f => [f.id, f.foldNo]))

  const batches = await prisma.foldBatch.findMany({
    where: { foldProgramId: { in: foldIds } },
    select: { id: true, batchNo: true, foldProgramId: true, lots: { select: { id: true, lotNo: true, than: true } } },
    orderBy: [{ foldProgramId: 'asc' }, { batchNo: 'asc' }],
  })

  const fbRows = []
  for (const b of batches) {
    const foldNo = foldNoById.get(b.foldProgramId)
    for (const l of b.lots) {
      if (MARKAS.some(m => eqMarka(m, l.lotNo))) {
        fbRows.push({
          id: l.id, foldNo, batchNo: b.batchNo, batchId: b.id,
          marka: MARKAS.find(m => eqMarka(m, l.lotNo)),
          than: l.than,
        })
      }
    }
  }
  fbRows.sort((a, b) => Number(a.foldNo) - Number(b.foldNo) || a.batchNo - b.batchNo || a.id - b.id)

  const queues = new Map()
  for (const m of MARKAS) {
    const lotMap = sourcesByMarka.get(m)
    if (!lotMap) { queues.set(m, []); continue }
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

  const fbPlan = []
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
    if (need > 0 || assignments.length !== 1) {
      throw new Error(`Unexpected split/unallocated for fbLotId=${r.id} marka=${r.marka}/${r.than}`)
    }
    fbPlan.push({ ...r, newLotNo: assignments[0].lotNo })
  }

  // Sanity
  if (fbPlan.length !== 178) throw new Error(`Expected 178 fold rows, got ${fbPlan.length}`)

  // Build a (batchId, marka) → newLotNo lookup. Within one batch, marka rows
  // map to the same RP-XX (we verified no splits in dry-run) — but fold 90 batch 3 has
  // two Kishan rows mapping to RP-80 and RP-100 respectively. We key by foldBatchLot.id
  // ordering for that case via a per-batch consume queue.
  const queueByBatchMarka = new Map()
  for (const p of fbPlan) {
    const k = `${p.batchId}|${p.marka}`
    if (!queueByBatchMarka.has(k)) queueByBatchMarka.set(k, [])
    queueByBatchMarka.get(k).push({ originalThan: p.than, newLotNo: p.newLotNo })
  }

  // Dyeing slips
  const slipBatchIds = batches.map(b => b.id)
  const slips = await prisma.dyeingEntry.findMany({
    where: { foldBatchId: { in: slipBatchIds } },
    select: {
      id: true, slipNo: true, lotNo: true, than: true, foldBatchId: true,
      lots: { select: { id: true, lotNo: true, than: true } },
    },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
  })

  const dyeChildPlan = [] // { id, newLotNo }
  const dyeParentPlan = [] // { id, newLotNo }
  for (const s of slips) {
    const markaChildren = s.lots.filter(l => MARKAS.some(m => eqMarka(m, l.lotNo)))
    if (!markaChildren.length) continue

    const totals = new Map()
    for (const c of markaChildren) {
      const m = MARKAS.find(x => eqMarka(x, c.lotNo))
      const k = `${s.foldBatchId}|${m}`
      const bucket = queueByBatchMarka.get(k)
      if (!bucket || !bucket.length) throw new Error(`No fold-row plan for slip ${s.slipNo} child ${m}/${c.than}`)
      // Consume than from bucket
      let need = c.than
      let chosenLotNo = null
      while (need > 0 && bucket.length) {
        const head = bucket[0]
        const take = Math.min(need, head.originalThan)
        if (chosenLotNo == null) chosenLotNo = head.newLotNo
        else if (chosenLotNo !== head.newLotNo) {
          throw new Error(`Dye child ${c.id} would split across RP lots — not expected`)
        }
        head.originalThan -= take
        need -= take
        if (head.originalThan <= 0) bucket.shift()
      }
      dyeChildPlan.push({ id: c.id, newLotNo: chosenLotNo })
      totals.set(chosenLotNo, (totals.get(chosenLotNo) || 0) + c.than)
    }

    let parentNew = s.lotNo
    let max = 0
    for (const [lot, t] of totals) if (t > max) { max = t; parentNew = lot }
    dyeParentPlan.push({ id: s.id, newLotNo: parentNew })
  }

  if (dyeChildPlan.length !== 120) throw new Error(`Expected 120 dye children, got ${dyeChildPlan.length}`)
  if (dyeParentPlan.length !== 30) throw new Error(`Expected 30 dye parents, got ${dyeParentPlan.length}`)

  console.log('=== About to apply ===')
  console.log(`foldBatchLot: ${fbPlan.length} rows`)
  console.log(`dyeingEntry: ${dyeParentPlan.length} parents`)
  console.log(`dyeingEntryLot: ${dyeChildPlan.length} children`)

  // Apply in single transaction. Use chunked updates to avoid long single statements.
  const startedAt = Date.now()
  await prisma.$transaction(async tx => {
    // Group fold updates by newLotNo for fewer queries (1 update per RP-XX bucket per source)
    const fbByNew = new Map()
    for (const p of fbPlan) {
      if (!fbByNew.has(p.newLotNo)) fbByNew.set(p.newLotNo, [])
      fbByNew.get(p.newLotNo).push(p.id)
    }
    for (const [newLotNo, ids] of fbByNew) {
      await tx.foldBatchLot.updateMany({ where: { id: { in: ids } }, data: { lotNo: newLotNo } })
    }

    const dyeChildByNew = new Map()
    for (const p of dyeChildPlan) {
      if (!dyeChildByNew.has(p.newLotNo)) dyeChildByNew.set(p.newLotNo, [])
      dyeChildByNew.get(p.newLotNo).push(p.id)
    }
    for (const [newLotNo, ids] of dyeChildByNew) {
      await tx.dyeingEntryLot.updateMany({ where: { id: { in: ids } }, data: { lotNo: newLotNo } })
    }

    const dyeParentByNew = new Map()
    for (const p of dyeParentPlan) {
      if (!dyeParentByNew.has(p.newLotNo)) dyeParentByNew.set(p.newLotNo, [])
      dyeParentByNew.get(p.newLotNo).push(p.id)
    }
    for (const [newLotNo, ids] of dyeParentByNew) {
      await tx.dyeingEntry.updateMany({ where: { id: { in: ids } }, data: { lotNo: newLotNo } })
    }
  }, { timeout: 60000 })

  console.log(`\nApplied in ${Date.now() - startedAt}ms.`)

  // Verify: no marka rows remain in any of the three tables (within scope)
  const leftFb = await prisma.foldBatchLot.count({
    where: { lotNo: { in: MARKAS, mode: 'insensitive' }, foldBatch: { foldProgram: { foldNo: { in: FOLD_NOS } } } },
  })
  const leftDyeChild = await prisma.dyeingEntryLot.count({ where: { lotNo: { in: MARKAS, mode: 'insensitive' } } })
  const leftDyeParent = await prisma.dyeingEntry.count({ where: { lotNo: { in: MARKAS, mode: 'insensitive' } } })
  console.log('Post-check (should all be 0):')
  console.log(`  foldBatchLot still tagged with marka: ${leftFb}`)
  console.log(`  dyeingEntryLot still tagged with marka: ${leftDyeChild}`)
  console.log(`  dyeingEntry still tagged with marka: ${leftDyeParent}`)
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
