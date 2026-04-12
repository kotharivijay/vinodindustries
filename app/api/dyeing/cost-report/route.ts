import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const partyId = req.nextUrl.searchParams.get('partyId')
  if (!partyId) return NextResponse.json({ error: 'partyId required' }, { status: 400 })

  const db = prisma as any
  const party = await prisma.party.findUnique({ where: { id: parseInt(partyId) } })
  if (!party) return NextResponse.json({ error: 'Party not found' }, { status: 404 })

  // Get lot numbers for this party
  const greyLots = await prisma.greyEntry.findMany({
    where: { partyId: party.id },
    select: { lotNo: true },
    distinct: ['lotNo'],
  })
  const obLots = await db.lotOpeningBalance.findMany({
    where: { party: { equals: party.name, mode: 'insensitive' } },
    select: { lotNo: true },
  })
  const allLotNos = [...new Set([...greyLots.map((g: any) => g.lotNo), ...obLots.map((o: any) => o.lotNo)])]
  if (allLotNos.length === 0) return NextResponse.json({ party: party.name, totalSlips: 0, folds: [], shades: [] })

  // Get dyeing entries
  const entries = await db.dyeingEntry.findMany({
    where: {
      OR: [
        { lotNo: { in: allLotNos } },
        { lots: { some: { lotNo: { in: allLotNos } } } },
      ],
    },
    include: {
      chemicals: true,
      lots: true,
      foldBatch: {
        select: {
          batchNo: true,
          foldProgram: { select: { foldNo: true } },
          shade: { select: { name: true, description: true } },
          shadeName: true,
          shadeDescription: true,
        },
      },
    },
    orderBy: { date: 'desc' },
  })

  let totalThan = 0
  let totalCost = 0
  const foldMap = new Map<string, { slips: number; than: number; cost: number; batches: any[] }>()
  const shadeMap = new Map<string, { than: number; cost: number; count: number }>()

  for (const e of entries) {
    const lots = e.lots?.length ? e.lots : [{ lotNo: e.lotNo, than: e.than }]
    const entryThan = lots.reduce((s: number, l: any) => s + l.than, 0)
    const entryCost = (e.chemicals || []).reduce((s: number, c: any) => s + (c.cost ?? 0), 0)
    totalThan += entryThan
    totalCost += entryCost

    const foldNo = e.foldBatch?.foldProgram?.foldNo || 'No Fold'
    if (!foldMap.has(foldNo)) foldMap.set(foldNo, { slips: 0, than: 0, cost: 0, batches: [] })
    const fg = foldMap.get(foldNo)!
    fg.slips++
    fg.than += entryThan
    fg.cost += entryCost

    const shadeName = e.shadeName || e.foldBatch?.shade?.name || e.foldBatch?.shadeName || 'Unknown'
    const shadeDesc = e.foldBatch?.shade?.description || e.foldBatch?.shadeDescription || ''
    const shadeLabel = shadeName + (shadeDesc ? ` — ${shadeDesc}` : '')

    fg.batches.push({
      batchNo: e.foldBatch?.batchNo || null,
      slipNo: e.slipNo,
      date: e.date,
      shade: shadeLabel,
      than: entryThan,
      cost: Math.round(entryCost),
      costPerThan: entryThan > 0 ? Math.round(entryCost / entryThan * 100) / 100 : 0,
    })

    if (!shadeMap.has(shadeLabel)) shadeMap.set(shadeLabel, { than: 0, cost: 0, count: 0 })
    const sg = shadeMap.get(shadeLabel)!
    sg.than += entryThan
    sg.cost += entryCost
    sg.count++
  }

  const folds = Array.from(foldMap.entries()).map(([foldNo, d]) => ({
    foldNo,
    slips: d.slips,
    than: d.than,
    cost: Math.round(d.cost),
    avgPerThan: d.than > 0 ? Math.round(d.cost / d.than * 100) / 100 : 0,
    batches: d.batches.sort((a: any, b: any) => (a.batchNo || 0) - (b.batchNo || 0)),
  })).sort((a, b) => parseInt(a.foldNo) - parseInt(b.foldNo) || a.foldNo.localeCompare(b.foldNo))

  const shades = Array.from(shadeMap.entries()).map(([shade, d]) => ({
    shade,
    than: d.than,
    cost: Math.round(d.cost),
    avgPerThan: d.than > 0 ? Math.round(d.cost / d.than * 100) / 100 : 0,
    count: d.count,
  })).sort((a, b) => b.cost - a.cost)

  return NextResponse.json({
    party: party.name,
    totalSlips: entries.length,
    totalThan,
    totalCost: Math.round(totalCost),
    avgCostPerThan: totalThan > 0 ? Math.round(totalCost / totalThan * 100) / 100 : 0,
    folds,
    shades,
  })
}
