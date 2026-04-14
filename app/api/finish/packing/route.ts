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
  const lotInfoMap = await buildLotInfoMap(Array.from(allLotNos))

  // Get shade info from dyeing entries for these lots
  const dyeingEntries = await db.dyeingEntry.findMany({
    where: {
      dyeingDoneAt: { not: null },
      OR: [
        { lotNo: { in: Array.from(allLotNos) } },
        { lots: { some: { lotNo: { in: Array.from(allLotNos) } } } },
      ],
    },
    select: {
      lotNo: true,
      shadeName: true,
      lots: { select: { lotNo: true } },
      foldBatch: { select: { foldProgram: { select: { foldNo: true } }, shade: { select: { name: true, description: true } } } },
    },
  })

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
  const stock = packingEntries.map(pe => ({
    ...pe,
    lots: pe.lots.map((l: any) => {
      const li = lotInfoMap.get(l.lotNo.toLowerCase().trim())
      const dye = lotDyeMap.get(l.lotNo.toLowerCase().trim())
      return {
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
      }
    }),
  }))

  return NextResponse.json({
    stock,
    totalSlips: stock.length,
    totalThan: stock.reduce((s: number, d: any) => s + d.totalThan, 0),
  })
}
