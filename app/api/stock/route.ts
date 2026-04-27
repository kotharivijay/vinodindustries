export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Fetch fold programmed than per lot
  const foldBatchLots = await (prisma as any).foldBatchLot.findMany({
    select: { lotNo: true, than: true },
  })
  const foldMap = new Map<string, number>()
  for (const fl of foldBatchLots) {
    const key = fl.lotNo.toLowerCase()
    foldMap.set(key, (foldMap.get(key) ?? 0) + fl.than)
  }

  // Fetch dyeing entry lots WITHOUT fold program (direct dyeing slips)
  const dyeingLots = await (prisma as any).dyeingEntryLot.findMany({
    select: { lotNo: true, than: true, entry: { select: { foldBatchId: true } } },
  })
  const dyeingUsedMap = new Map<string, number>()
  for (const dl of dyeingLots) {
    if (dl.entry?.foldBatchId) continue // already counted via foldMap
    const key = dl.lotNo.toLowerCase()
    dyeingUsedMap.set(key, (dyeingUsedMap.get(key) ?? 0) + dl.than)
  }

  // Fetch manual reservations
  const reservations = await (prisma as any).lotManualReservation.findMany({
    select: { lotNo: true, usedThan: true, note: true },
  })
  const reservationMap = new Map<string, { usedThan: number; note: string | null }>()
  for (const r of reservations) {
    reservationMap.set(r.lotNo.toLowerCase(), { usedThan: r.usedThan, note: r.note })
  }

  // ── Stage breakdown queries (for the share-image chip row) ──
  // Pipeline: Grey → Dye → Finish → Fold → Pack → Despatch
  // Re-Pro is parallel: ReProcessSource rows where parent.status != 'merged'.
  const [dyedAllByLot, finishedByLot, packedByLot, reproSources] = await Promise.all([
    (prisma as any).dyeingEntryLot.groupBy({ by: ['lotNo'], _sum: { than: true } }),
    (prisma as any).finishEntryLot.groupBy({ by: ['lotNo'], _sum: { than: true } }),
    (prisma as any).packingLot.groupBy({ by: ['lotNo'], _sum: { than: true } }),
    (prisma as any).reProcessSource.findMany({
      where: { reprocess: { status: { not: 'merged' } } },
      select: { originalLotNo: true, than: true },
    }),
  ])
  const stageDyed = new Map<string, number>()
  for (const r of dyedAllByLot) stageDyed.set(r.lotNo.toLowerCase(), (stageDyed.get(r.lotNo.toLowerCase()) || 0) + (r._sum.than || 0))
  const stageFinished = new Map<string, number>()
  for (const r of finishedByLot) stageFinished.set(r.lotNo.toLowerCase(), (stageFinished.get(r.lotNo.toLowerCase()) || 0) + (r._sum.than || 0))
  const stagePacked = new Map<string, number>()
  for (const r of packedByLot) stagePacked.set(r.lotNo.toLowerCase(), (stagePacked.get(r.lotNo.toLowerCase()) || 0) + (r._sum.than || 0))
  const stageRePro = new Map<string, number>()
  for (const r of reproSources) {
    const k = r.originalLotNo.toLowerCase()
    stageRePro.set(k, (stageRePro.get(k) || 0) + (r.than || 0))
  }

  // Fetch grey entries grouped by lot
  const greyByLot = await prisma.greyEntry.groupBy({ by: ['lotNo'], _sum: { than: true } })

  // Fetch despatch totals per lot — combine legacy single-lot DespatchEntry
  // (no children) with multi-lot DespatchEntryLot rows, otherwise multi-lot
  // challans get attributed entirely to the parent's first lot.
  const despParentByLot = await prisma.despatchEntry.groupBy({
    where: { despatchLots: { none: {} } },
    by: ['lotNo'], _sum: { than: true },
  })
  const despLotByLot = await prisma.despatchEntryLot.groupBy({ by: ['lotNo'], _sum: { than: true } })
  const despatchMap = new Map<string, number>()
  for (const d of despParentByLot) despatchMap.set(d.lotNo, (despatchMap.get(d.lotNo) || 0) + (d._sum.than ?? 0))
  for (const d of despLotByLot) despatchMap.set(d.lotNo, (despatchMap.get(d.lotNo) || 0) + (d._sum.than ?? 0))

  // Lower-cased despatch map for the stage-breakdown calculator (other lookups
  // in this file still use the original mixed-case `despatchMap`).
  const despatchMapLower = new Map<string, number>()
  for (const [k, v] of despatchMap) despatchMapLower.set(k.toLowerCase(), (despatchMapLower.get(k.toLowerCase()) || 0) + v)

  /** How much of `stock` sits at each pipeline stage. */
  function stagesFor(key: string, stock: number) {
    const dyed = stageDyed.get(key) || 0
    const finished = stageFinished.get(key) || 0
    const folded = foldMap.get(key) || 0
    const packed = stagePacked.get(key) || 0
    const despatched = despatchMapLower.get(key) || 0
    const repro = stageRePro.get(key) || 0
    const inPack = Math.max(0, packed - despatched)
    const inFold = Math.max(0, folded - packed)
    const inFinish = Math.max(0, finished - folded - repro)
    const inDye = Math.max(0, dyed - finished)
    const consumed = inPack + inFold + inFinish + inDye + repro
    const inGrey = Math.max(0, stock - consumed)
    return { grey: inGrey, dye: inDye, finish: inFinish, fold: inFold, pack: inPack, repro }
  }

  // Fetch opening balances
  let obList: any[] = []
  try {
    const db = prisma as any
    obList = await db.lotOpeningBalance.findMany()
  } catch {}
  const obMap = new Map(obList.map((o: any) => [o.lotNo.toLowerCase(), o]))

  // Fetch party + quality per lot from grey entries
  const greyDetails = await prisma.greyEntry.findMany({
    select: { lotNo: true, party: { select: { name: true, tag: true } }, quality: { select: { name: true } } },
    distinct: ['lotNo'],
  })
  const lotDetailMap = new Map(greyDetails.map(g => [g.lotNo.toLowerCase(), { party: g.party.name, quality: g.quality.name, partyTag: g.party.tag }]))

  // LR numbers + markas + inward dates per lot
  const greyMeta = await prisma.greyEntry.findMany({
    select: { lotNo: true, transportLrNo: true, marka: true, date: true },
  })
  const lrMap = new Map<string, Set<string>>()
  const markaMap = new Map<string, Set<string>>()
  const dateMap = new Map<string, Set<string>>()
  for (const g of greyMeta) {
    const k = g.lotNo.toLowerCase()
    if (g.transportLrNo) {
      if (!lrMap.has(k)) lrMap.set(k, new Set())
      lrMap.get(k)!.add(g.transportLrNo)
    }
    if (g.marka) {
      if (!markaMap.has(k)) markaMap.set(k, new Set())
      markaMap.get(k)!.add(g.marka)
    }
    if (g.date) {
      if (!dateMap.has(k)) dateMap.set(k, new Set())
      dateMap.get(k)!.add(g.date.toISOString().slice(0, 10)) // YYYY-MM-DD
    }
  }

  // Build per-lot stock data
  interface LotStock {
    lotNo: string
    party: string
    partyTag: string | null
    quality: string
    stock: number
    openingBalance: number
    greyThan: number
    totalThan: number      // ob + grey (i.e. total received before despatch)
    despatchThan: number
    foldProgrammed: number
    manuallyUsed: number
    manuallyUsedNote: string | null
    foldAvailable: number
    lrNos: string          // comma-separated LR numbers
    markas: string         // comma-separated marka values (mainly for Pali PC Job parties)
    inwardDates: string    // comma-separated YYYY-MM-DD dates from grey entries
    stages: { grey: number; dye: number; finish: number; fold: number; pack: number; repro: number }
  }

  const lotStocks: LotStock[] = []
  const processedLots = new Set<string>()

  // Lots with current year grey entries
  for (const g of greyByLot) {
    const key = g.lotNo.toLowerCase()
    processedLots.add(key)
    const ob = obMap.get(key)
    const obThan = ob?.openingThan ?? 0
    const greyThan = g._sum.than ?? 0
    const despThan = despatchMap.get(g.lotNo) ?? 0
    const stock = obThan + greyThan - despThan
    if (stock <= 0) continue

    const detail = lotDetailMap.get(key)
    const foldProgrammed = foldMap.get(key) ?? 0
    const dyeingUsed = dyeingUsedMap.get(key) ?? 0
    const reservation = reservationMap.get(key)
    const manuallyUsed = reservation?.usedThan ?? 0
    lotStocks.push({
      lotNo: g.lotNo,
      party: detail?.party ?? ob?.party ?? 'Unknown',
      partyTag: detail?.partyTag ?? null,
      quality: detail?.quality ?? ob?.quality ?? '-',
      stock,
      openingBalance: obThan,
      greyThan,
      totalThan: obThan + greyThan,
      despatchThan: despThan,
      foldProgrammed,
      manuallyUsed,
      manuallyUsedNote: reservation?.note ?? null,
      foldAvailable: Math.max(0, stock - foldProgrammed - manuallyUsed - dyeingUsed),
      lrNos: Array.from(lrMap.get(key) || []).join(', '),
      markas: Array.from(markaMap.get(key) || []).join(', '),
      inwardDates: Array.from(dateMap.get(key) || []).sort().join(', '),
      stages: stagesFor(key, stock),
    })
  }

  // Lots with only opening balance
  for (const ob of obList) {
    const key = ob.lotNo.toLowerCase()
    if (processedLots.has(key)) continue
    // Find despatch (case-insensitive)
    let despThan = 0
    for (const [lotNo, than] of despatchMap) {
      if (lotNo.toLowerCase() === key) { despThan = than; break }
    }
    const stock = ob.openingThan - despThan
    if (stock <= 0) continue

    const foldProgrammed = foldMap.get(key) ?? 0
    const dyeingUsed = dyeingUsedMap.get(key) ?? 0
    const reservation = reservationMap.get(key)
    const manuallyUsed = reservation?.usedThan ?? 0
    // For OB lots, the LR/date come from the OB row itself (carry-forward from
    // last year's grey entry). Fall back to any matching GreyEntry aggregation
    // if the OB row's fields are blank.
    const obLr = ob.lrNo || Array.from(lrMap.get(key) || []).join(', ')
    const obDateSet = new Set<string>(Array.from(dateMap.get(key) || []))
    if (ob.greyDate) obDateSet.add(ob.greyDate.toISOString().slice(0, 10))

    lotStocks.push({
      lotNo: ob.lotNo,
      party: ob.party || 'Unknown',
      partyTag: null,
      quality: ob.quality || '-',
      stock,
      openingBalance: ob.openingThan,
      greyThan: 0,
      totalThan: ob.openingThan,
      despatchThan: despThan,
      foldProgrammed,
      manuallyUsed,
      manuallyUsedNote: reservation?.note ?? null,
      foldAvailable: Math.max(0, stock - foldProgrammed - manuallyUsed - dyeingUsed),
      lrNos: obLr,
      markas: Array.from(markaMap.get(key) || []).join(', '),
      inwardDates: Array.from(obDateSet).sort().join(', '),
      stages: stagesFor(key, stock),
    })
  }

  // Active RE-PRO lots — surface as "Re-Process" party so they appear in
  // fold creation and stock pickers like any other lot. Drops out
  // automatically once status flips to 'merged'.
  try {
    const db = prisma as any
    const repros = await db.reProcessLot.findMany({
      where: { status: { in: ['pending', 'in-dyeing', 'finished'] } },
    })
    for (const r of repros) {
      const key = r.reproNo.toLowerCase()
      const despThan = despatchMap.get(r.reproNo) ?? 0
      const stock = r.totalThan - despThan
      if (stock <= 0) continue
      const foldProgrammed = foldMap.get(key) ?? 0
      const dyeingUsed = dyeingUsedMap.get(key) ?? 0
      const reservation = reservationMap.get(key)
      const manuallyUsed = reservation?.usedThan ?? 0
      lotStocks.push({
        lotNo: r.reproNo,
        party: 'Re-Process',
        partyTag: null,
        quality: r.quality || '-',
        stock,
        openingBalance: 0,
        greyThan: r.totalThan,
        totalThan: r.totalThan,
        despatchThan: despThan,
        foldProgrammed,
        manuallyUsed,
        manuallyUsedNote: reservation?.note ?? null,
        foldAvailable: Math.max(0, stock - foldProgrammed - manuallyUsed - dyeingUsed),
        lrNos: '',
        markas: '',
        inwardDates: '',
        stages: stagesFor(key, stock),
      })
    }
  } catch {}

  // Group by party
  const partyMap = new Map<string, { party: string; partyTag: string | null; totalStock: number; lotCount: number; lots: LotStock[] }>()
  for (const lot of lotStocks) {
    const existing = partyMap.get(lot.party)
    if (existing) {
      existing.totalStock += lot.stock
      existing.lotCount++
      existing.lots.push(lot)
      if (!existing.partyTag && lot.partyTag) existing.partyTag = lot.partyTag
    } else {
      partyMap.set(lot.party, { party: lot.party, partyTag: lot.partyTag, totalStock: lot.stock, lotCount: 1, lots: [lot] })
    }
  }

  // Sort lots within each party by lotNo
  for (const p of partyMap.values()) {
    p.lots.sort((a, b) => a.lotNo.localeCompare(b.lotNo))
  }

  const result = Array.from(partyMap.values())
  const totalStock = result.reduce((s, p) => s + p.totalStock, 0)
  const totalLots = result.reduce((s, p) => s + p.lotCount, 0)

  return NextResponse.json({ parties: result, totalStock, totalLots })
}
