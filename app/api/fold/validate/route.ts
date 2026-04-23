export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const foldId = req.nextUrl.searchParams.get('foldId')
  const db = prisma as any

  // If foldId, validate single fold; otherwise validate all draft folds
  const folds = foldId
    ? [await db.foldProgram.findUnique({ where: { id: parseInt(foldId) }, include: { batches: { include: { lots: true, shade: true } } } })]
    : await db.foldProgram.findMany({ where: { status: 'draft' }, include: { batches: { include: { lots: true, shade: true } } }, orderBy: { foldNo: 'asc' } })

  if (foldId && !folds[0]) return NextResponse.json({ error: 'Fold not found' }, { status: 404 })

  // Collect all lot numbers and shade names
  const allLotNos = new Set<string>()
  const allShadeNames = new Set<string>()
  for (const f of folds) {
    if (!f) continue
    for (const b of f.batches) {
      for (const l of b.lots) allLotNos.add(l.lotNo)
      const sn = b.shade?.name || b.shadeName
      if (sn) allShadeNames.add(sn)
    }
  }

  // Stock check: grey + OB - despatch - other folds - standalone dyeing
  const greyStock = await prisma.greyEntry.groupBy({
    by: ['lotNo'],
    where: { lotNo: { in: Array.from(allLotNos) } },
    _sum: { than: true },
  })
  const greyMap = new Map(greyStock.map(g => [g.lotNo.toLowerCase().trim(), g._sum.than ?? 0]))

  const obStock = await db.lotOpeningBalance.findMany({
    where: { lotNo: { in: Array.from(allLotNos) } },
    select: { lotNo: true, openingThan: true },
  })
  const obMap = new Map<string, number>(obStock.map((o: any) => [o.lotNo.toLowerCase().trim(), o.openingThan ?? 0]))

  // Despatch totals — combine legacy single-lot DespatchEntry (no children)
  // with multi-lot DespatchEntryLot rows; otherwise multi-lot challans
  // attribute the entire challan to the parent's first lot.
  const despParent = await prisma.despatchEntry.groupBy({
    by: ['lotNo'],
    where: { lotNo: { in: Array.from(allLotNos) }, despatchLots: { none: {} } },
    _sum: { than: true },
  })
  const despChild = await prisma.despatchEntryLot.groupBy({
    by: ['lotNo'],
    where: { lotNo: { in: Array.from(allLotNos) } },
    _sum: { than: true },
  })
  const despMap = new Map<string, number>()
  for (const d of despParent) despMap.set(d.lotNo.toLowerCase().trim(), (despMap.get(d.lotNo.toLowerCase().trim()) || 0) + (d._sum.than ?? 0))
  for (const d of despChild) despMap.set(d.lotNo.toLowerCase().trim(), (despMap.get(d.lotNo.toLowerCase().trim()) || 0) + (d._sum.than ?? 0))

  // Active RE-PRO lots — treat their totalThan as available stock so
  // RE-PRO-N can be a fold input (matches /api/grey/lots model).
  const reproLots = await db.reProcessLot.findMany({
    where: {
      reproNo: { in: Array.from(allLotNos) },
      status: { in: ['pending', 'in-dyeing', 'finished'] },
    },
    select: { reproNo: true, totalThan: true },
  })
  const reproMap = new Map<string, number>()
  for (const r of reproLots) reproMap.set(r.reproNo.toLowerCase().trim(), r.totalThan)

  // Fold usage (all folds, not just current)
  const foldLots = await db.foldBatchLot.findMany({
    where: { lotNo: { in: Array.from(allLotNos) } },
    select: { lotNo: true, than: true, foldBatchId: true },
  })

  // Dyeing usage (standalone, without fold)
  const dyeLots = await db.dyeingEntryLot.findMany({
    where: { lotNo: { in: Array.from(allLotNos) } },
    select: { lotNo: true, than: true, entry: { select: { foldBatchId: true } } },
  })
  const dyeMap = new Map<string, number>()
  for (const d of dyeLots) {
    if (!d.entry?.foldBatchId) {
      const key = d.lotNo.toLowerCase().trim()
      dyeMap.set(key, (dyeMap.get(key) || 0) + d.than)
    }
  }

  // Shade master check
  const shades = await db.shade.findMany({
    where: { name: { in: Array.from(allShadeNames) } },
    select: { name: true },
  })
  const shadeSet = new Set(shades.map((s: any) => s.name.toLowerCase().trim()))

  // Validate each fold
  const results = []
  for (const f of folds) {
    if (!f) continue

    // Get batch IDs for this fold (to exclude from "other fold usage")
    const thisFoldBatchIds = new Set(f.batches.map((b: any) => b.id))

    // Lot stock per fold lot (excluding this fold's own usage)
    const otherFoldUsage = new Map<string, number>()
    for (const fl of foldLots) {
      if (!thisFoldBatchIds.has(fl.foldBatchId)) {
        const key = fl.lotNo.toLowerCase().trim()
        otherFoldUsage.set(key, (otherFoldUsage.get(key) || 0) + fl.than)
      }
    }

    const lotIssues: any[] = []
    const shadeIssues: any[] = []

    // Check lot stock
    const lotNeeded = new Map<string, number>()
    for (const b of f.batches) {
      for (const l of b.lots) {
        const key = l.lotNo.toLowerCase().trim()
        lotNeeded.set(key, (lotNeeded.get(key) || 0) + l.than)
      }
    }

    for (const [key, needed] of lotNeeded) {
      const lotNo = Array.from(allLotNos).find(l => l.toLowerCase().trim() === key) || key
      const grey = greyMap.get(key) ?? 0
      const ob = obMap.get(key) ?? 0
      const repro = reproMap.get(key) ?? 0
      const desp = despMap.get(key) ?? 0
      const otherFold = otherFoldUsage.get(key) ?? 0
      const dye = dyeMap.get(key) ?? 0
      const stock = grey + ob + repro - desp
      const available = Math.max(0, stock - otherFold - dye)

      if (stock <= 0 && grey === 0 && ob === 0 && repro === 0) {
        lotIssues.push({ lotNo, needed, available: 0, stock: 0, type: 'not_found' })
      } else if (available < needed) {
        lotIssues.push({ lotNo, needed, available, stock, type: 'low_stock' })
      }
    }

    // Check shades
    const seenShades = new Set<string>()
    for (const b of f.batches) {
      const sn = b.shade?.name || b.shadeName
      if (sn && !seenShades.has(sn.toLowerCase().trim())) {
        seenShades.add(sn.toLowerCase().trim())
        if (!shadeSet.has(sn.toLowerCase().trim())) {
          shadeIssues.push({ shadeName: sn, batchNo: b.batchNo })
        }
      }
    }

    const errorCount = lotIssues.filter(i => i.type === 'not_found').length + shadeIssues.length
    const warningCount = lotIssues.filter(i => i.type === 'low_stock').length
    const status = errorCount > 0 ? 'errors' : warningCount > 0 ? 'warnings' : 'valid'

    results.push({
      foldId: f.id,
      foldNo: f.foldNo,
      status,
      errorCount,
      warningCount,
      lotIssues,
      shadeIssues,
    })
  }

  return NextResponse.json(foldId ? results[0] : results)
}
