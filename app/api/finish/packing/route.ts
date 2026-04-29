export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = prisma as any

  // Fetch all finish entries with lots
  const finishEntries = await db.finishEntry.findMany({
    include: {
      lots: { include: { foldingReceipts: { orderBy: { date: 'asc' as const } } } },
      chemicals: { include: { chemical: true } },
    },
    orderBy: { date: 'desc' },
  })

  // Packing stock = only lots marked done or partial in finish
  const packingEntries: any[] = []
  for (const fe of finishEntries) {
    const rawLots = fe.lots?.length ? fe.lots : [{ lotNo: fe.lotNo, than: fe.than, meter: fe.meter, doneThan: 0, status: 'pending' }]
    // Only include lots that are done or partial
    const doneLots = rawLots
      .filter((l: any) => l.status === 'done' || l.status === 'partial')
      .map((l: any) => {
        const receipts = l.foldingReceipts || []
        const receivedThan = receipts.reduce((s: number, r: any) => s + r.than, 0)
        const packThan = l.status === 'done' ? l.than : l.doneThan
        return {
          ...l,
          than: packThan,
          foldingReceipts: receipts,
          receivedThan,
          foldingComplete: receivedThan >= packThan,
        }
      })
    if (doneLots.length === 0) continue
    packingEntries.push({
      id: fe.id,
      slipNo: fe.slipNo,
      date: fe.date,
      meter: fe.meter,
      mandi: fe.mandi,
      notes: fe.notes,
      finishDespSlipNo: fe.finishDespSlipNo || null,
      allFoldingComplete: doneLots.length > 0 && doneLots.every((l: any) => l.foldingComplete),
      lots: doneLots,
      totalThan: doneLots.reduce((s: number, l: any) => s + (l.than || 0), 0),
    })
  }

  // Enrich with party / quality / shade info
  const allLotNos = new Set<string>()
  for (const pe of packingEntries) {
    for (const l of pe.lots) allLotNos.add(l.lotNo)
  }

  const { buildLotInfoMap } = await import('@/lib/lot-info')
  const lotNosArr = Array.from(allLotNos)

  // Despatched per lot — combine legacy single-lot DespatchEntry rows (no
  // children) with DespatchEntryLot rows so multi-lot challans don't get
  // attributed entirely to the parent's first lot.
  const [despParent, despChild] = await Promise.all([
    prisma.despatchEntry.groupBy({
      where: { lotNo: { in: lotNosArr }, despatchLots: { none: {} } },
      by: ['lotNo'], _sum: { than: true },
    }),
    prisma.despatchEntryLot.groupBy({
      where: { lotNo: { in: lotNosArr } },
      by: ['lotNo'], _sum: { than: true },
    }),
  ])
  const despMap = new Map<string, number>()
  for (const d of despParent) despMap.set(d.lotNo.toLowerCase().trim(), (despMap.get(d.lotNo.toLowerCase().trim()) || 0) + (d._sum.than || 0))
  for (const d of despChild)  despMap.set(d.lotNo.toLowerCase().trim(), (despMap.get(d.lotNo.toLowerCase().trim()) || 0) + (d._sum.than || 0))

  // Run lot info + dyeing queries in parallel
  const [lotInfoMap, dyeingEntries] = await Promise.all([
    buildLotInfoMap(lotNosArr),
    db.dyeingEntry.findMany({
      where: {
        dyeingDoneAt: { not: null },
        OR: [
          { lotNo: { in: lotNosArr } },
          { lots: { some: { lotNo: { in: lotNosArr } } } },
        ],
      },
      select: {
        lotNo: true,
        shadeName: true,
        lots: { select: { lotNo: true } },
        foldBatch: { select: { foldProgram: { select: { foldNo: true } }, shade: { select: { name: true, description: true } } } },
      },
    }),
  ])

  const lotDyeMap = new Map<string, { shadeName: string | null; shadeDescription: string | null; foldNo: string | null }>()
  for (const de of dyeingEntries) {
    const shade = de.shadeName || de.foldBatch?.shade?.name || null
    const desc = de.foldBatch?.shade?.description || null
    const foldNo = de.foldBatch?.foldProgram?.foldNo || null
    const lotsInEntry = de.lots?.length ? de.lots.map((l: any) => l.lotNo) : [de.lotNo]
    for (const ln of lotsInEntry) {
      if (!lotDyeMap.has(ln.toLowerCase().trim())) {
        lotDyeMap.set(ln.toLowerCase().trim(), { shadeName: shade, shadeDescription: desc, foldNo })
      }
    }
  }

  // Build enriched response
  const stock: any[] = packingEntries.map(pe => ({
    ...pe,
    lots: pe.lots.map((l: any) => {
      const li = lotInfoMap.get(l.lotNo.toLowerCase().trim())
      const dye = lotDyeMap.get(l.lotNo.toLowerCase().trim())
      return {
        id: l.id,
        lotNo: l.lotNo,
        than: l.than,
        meter: l.meter,
        party: li?.party || null,
        quality: li?.quality || null,
        weight: li?.weight || null,
        foldNo: dye?.foldNo || null,
        shadeName: dye?.shadeName || null,
        shadeDescription: dye?.shadeDescription || null,
        foldingReceipts: l.foldingReceipts || [],
        receivedThan: l.receivedThan || 0,
        foldingComplete: l.foldingComplete || false,
        despatchedThan: despMap.get(l.lotNo.toLowerCase().trim()) || 0,
      }
    }),
  }))

  // Inject OB allocations tagged as 'finished' (available for packing)
  // Skip if a real slipNo=0 entry already exists (OB converted to real entry via FR)
  try {
    const obEntryLotNos = new Set<string>()
    for (const pe of packingEntries) {
      if (pe.slipNo === 0) {
        for (const l of pe.lots) obEntryLotNos.add(l.lotNo.toLowerCase().trim())
      }
    }

    const obFinished = await db.lotOpeningBalanceAllocation.findMany({
      where: { stage: 'finished' },
      include: { balance: true },
    })
    for (const alloc of obFinished) {
      const b = alloc.balance
      if (obEntryLotNos.has(b.lotNo.toLowerCase().trim())) continue
      const mtrPerThan = b.grayMtr && b.greyThan ? b.grayMtr / b.greyThan : null
      stock.push({
        id: -alloc.id,
        slipNo: 0,
        date: b.greyDate || b.createdAt,
        meter: mtrPerThan ? mtrPerThan * alloc.than : null,
        mandi: null,
        notes: alloc.notes || null,
        finishDespSlipNo: null,
        allFoldingComplete: false,
        totalThan: alloc.than,
        isFromOB: true,
        obStage: 'finished',
        lots: [{
          id: -alloc.id,
          lotNo: b.lotNo,
          than: alloc.than,
          meter: mtrPerThan ? mtrPerThan * alloc.than : null,
          party: b.party,
          quality: b.quality,
          weight: b.weight,
          foldNo: null,
          shadeName: null,
          shadeDescription: null,
          foldingReceipts: [],
          receivedThan: 0,
          foldingComplete: false,
          despatchedThan: 0,
        }],
      })
    }
  } catch {}

  // Inject current-year lots tagged with startStage='finish' as virtual finish stock.
  // These arrived already-processed and skip the upstream pipeline; they should
  // appear in the Folding Stock view immediately so folding slips can be cut
  // against them. Despatched-than is subtracted client-side via the UI's
  // existing balance math.
  try {
    const realFinishLotNos = new Set<string>()
    for (const pe of packingEntries) {
      for (const l of pe.lots) realFinishLotNos.add(l.lotNo.toLowerCase().trim())
    }
    const startStageRows = await prisma.greyEntry.findMany({
      where: { startStage: 'finish' },
      select: {
        id: true, lotNo: true, than: true, date: true, grayMtr: true, weight: true,
        party: { select: { name: true } },
        quality: { select: { name: true } },
      },
    })
    // Aggregate by lotNo so multi-challan lots show as one virtual finish entry
    const grouped = new Map<string, any>()
    for (const r of startStageRows) {
      const k = r.lotNo.toLowerCase().trim()
      const existing = grouped.get(k)
      if (existing) {
        existing.totalThan += r.than
        if (r.grayMtr) existing.meter = (existing.meter || 0) + r.grayMtr
      } else {
        grouped.set(k, {
          firstId: r.id,
          lotNo: r.lotNo,
          totalThan: r.than,
          meter: r.grayMtr,
          date: r.date,
          party: r.party?.name || null,
          quality: r.quality?.name || null,
          weight: r.weight,
        })
      }
    }
    for (const [k, info] of grouped) {
      if (realFinishLotNos.has(k)) continue // already covered by a real FinishEntry
      stock.push({
        id: -info.firstId * 1000,
        slipNo: 0,
        date: info.date,
        meter: info.meter,
        mandi: null,
        notes: null,
        finishDespSlipNo: null,
        allFoldingComplete: false,
        totalThan: info.totalThan,
        isFromStartStage: true,
        startStage: 'finish',
        lots: [{
          id: -info.firstId * 1000,
          lotNo: info.lotNo,
          than: info.totalThan,
          meter: info.meter,
          party: info.party,
          quality: info.quality,
          weight: info.weight,
          foldNo: null,
          shadeName: null,
          shadeDescription: null,
          foldingReceipts: [],
          receivedThan: 0,
          foldingComplete: false,
          despatchedThan: despMap.get(k) || 0,
        }],
      })
    }
  } catch {}

  return NextResponse.json({
    stock,
    totalSlips: stock.length,
    totalThan: stock.reduce((s: number, d: any) => s + d.totalThan, 0),
  })
}
