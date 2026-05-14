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
  // `lotNosArr` is collected from FinishEntryLot — its casing can differ
  // from the despatch / dyeing tables, so every `in` filter must be
  // case-insensitive or rows silently drop out.
  const lotNoIn = { in: lotNosArr, mode: 'insensitive' as const }

  // Despatched per lot — combine legacy single-lot DespatchEntry rows (no
  // children) with DespatchEntryLot rows so multi-lot challans don't get
  // attributed entirely to the parent's first lot.
  const [despParent, despChild] = await Promise.all([
    prisma.despatchEntry.groupBy({
      where: { lotNo: lotNoIn, despatchLots: { none: {} } },
      by: ['lotNo'], _sum: { than: true },
    }),
    prisma.despatchEntryLot.groupBy({
      where: { lotNo: lotNoIn },
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
          { lotNo: lotNoIn },
          { lots: { some: { lotNo: lotNoIn } } },
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


  return NextResponse.json({
    stock,
    totalSlips: stock.length,
    totalThan: stock.reduce((s: number, d: any) => s + d.totalThan, 0),
  })
}
