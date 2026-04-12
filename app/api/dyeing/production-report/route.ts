import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const dateFrom = req.nextUrl.searchParams.get('from')
  const dateTo = req.nextUrl.searchParams.get('to')

  if (!dateFrom || !dateTo) return NextResponse.json({ error: 'from and to required' }, { status: 400 })

  const from = new Date(dateFrom)
  const to = new Date(dateTo)
  to.setHours(23, 59, 59, 999)

  const db = prisma as any

  const entries = await db.dyeingEntry.findMany({
    where: { date: { gte: from, lte: to } },
    include: {
      chemicals: true,
      lots: true,
      machine: true,
      operator: true,
      foldBatch: {
        select: {
          batchNo: true,
          foldProgram: { select: { foldNo: true } },
          shade: { select: { name: true, description: true } },
          shadeName: true,
          shadeDescription: true,
        },
      },
      additions: {
        include: { chemicals: { include: { chemical: true } }, machine: true, operator: true },
        orderBy: { roundNo: 'asc' },
      },
    },
    orderBy: { date: 'desc' },
  })

  // Get lot info for party/quality
  const { buildLotInfoMap } = await import('@/lib/lot-info')
  const allLotNos: string[] = entries.flatMap((e: any) => (e.lots?.length ? e.lots : [{ lotNo: e.lotNo }]).map((l: any) => l.lotNo))
  const lotInfoMap = await buildLotInfoMap([...new Set(allLotNos)])

  // Build enriched entries
  const enriched = entries.map((e: any) => {
    const lots = e.lots?.length ? e.lots : [{ lotNo: e.lotNo, than: e.than }]
    const entryThan = lots.reduce((s: number, l: any) => s + l.than, 0)
    const entryCost = (e.chemicals || []).reduce((s: number, c: any) => s + (c.cost ?? 0), 0)
    const additionsCost = (e.additions || []).reduce((s: number, a: any) =>
      s + (a.chemicals?.reduce((s2: number, c: any) => s2 + (c.cost ?? 0), 0) ?? 0), 0)

    const lotInfos = lots.map((l: any) => {
      const info = lotInfoMap.get(l.lotNo.toLowerCase().trim())
      return { lotNo: l.lotNo, than: l.than, party: info?.party || null, quality: info?.quality || null, marka: info?.marka || null }
    })
    const partyNames = [...new Set(lotInfos.map((l: any) => l.party).filter(Boolean))]
    const qualityNames = [...new Set(lotInfos.map((l: any) => l.quality).filter(Boolean))]

    const shade = e.shadeName || e.foldBatch?.shade?.name || e.foldBatch?.shadeName || null
    const shadeDesc = e.foldBatch?.shade?.description || e.foldBatch?.shadeDescription || null

    return {
      id: e.id,
      date: e.date,
      slipNo: e.slipNo,
      than: entryThan,
      cost: Math.round(entryCost),
      additionsCost: Math.round(additionsCost),
      totalCost: Math.round(entryCost + additionsCost),
      shade: shade ? shade + (shadeDesc ? ` — ${shadeDesc}` : '') : null,
      foldNo: e.foldBatch?.foldProgram?.foldNo || null,
      batchNo: e.foldBatch?.batchNo || null,
      machine: e.machine?.name || null,
      operator: e.operator?.name || null,
      notes: e.notes || null,
      status: e.status,
      totalRounds: e.totalRounds || 1,
      isPcJob: e.isPcJob,
      lots: lotInfos,
      party: partyNames.join(', ') || null,
      quality: qualityNames.join(', ') || null,
      isReDyed: (e.additions?.length ?? 0) > 0,
      additions: (e.additions || []).map((a: any) => ({
        roundNo: a.roundNo,
        type: a.type,
        defectType: a.defectType,
        reason: a.reason,
        machine: a.machine?.name || null,
        operator: a.operator?.name || null,
        chemCount: a.chemicals?.length || 0,
        cost: (a.chemicals || []).reduce((s: number, c: any) => s + (c.cost ?? 0), 0),
      })),
    }
  })

  // Aggregations
  const totalBatches = enriched.length
  const totalThan = enriched.reduce((s: number, e: any) => s + e.than, 0)
  const totalCost = enriched.reduce((s: number, e: any) => s + e.totalCost, 0)
  const doneCount = enriched.filter((e: any) => e.status === 'done').length
  const patchyCount = enriched.filter((e: any) => e.status === 'patchy').length
  const reDyeCount = enriched.filter((e: any) => e.isReDyed).length

  // By Machine
  const byMachine: Record<string, { batches: number; than: number; cost: number }> = {}
  for (const e of enriched) {
    const m = e.machine || 'Unknown'
    if (!byMachine[m]) byMachine[m] = { batches: 0, than: 0, cost: 0 }
    byMachine[m].batches++
    byMachine[m].than += e.than
    byMachine[m].cost += e.totalCost
  }

  // By Operator
  const byOperator: Record<string, { batches: number; than: number; cost: number }> = {}
  for (const e of enriched) {
    const o = e.operator || 'Unknown'
    if (!byOperator[o]) byOperator[o] = { batches: 0, than: 0, cost: 0 }
    byOperator[o].batches++
    byOperator[o].than += e.than
    byOperator[o].cost += e.totalCost
  }

  // By Quality
  const byQuality: Record<string, { batches: number; than: number; cost: number }> = {}
  for (const e of enriched) {
    const q = e.quality || 'Unknown'
    if (!byQuality[q]) byQuality[q] = { batches: 0, than: 0, cost: 0 }
    byQuality[q].batches++
    byQuality[q].than += e.than
    byQuality[q].cost += e.totalCost
  }

  // By Date
  const byDate: Record<string, { batches: number; than: number; cost: number }> = {}
  for (const e of enriched) {
    const d = new Date(e.date).toISOString().split('T')[0]
    if (!byDate[d]) byDate[d] = { batches: 0, than: 0, cost: 0 }
    byDate[d].batches++
    byDate[d].than += e.than
    byDate[d].cost += e.totalCost
  }

  return NextResponse.json({
    summary: { totalBatches, totalThan, totalCost, doneCount, patchyCount, reDyeCount },
    byMachine: Object.entries(byMachine).map(([name, d]) => ({ name, ...d })).sort((a, b) => b.batches - a.batches),
    byOperator: Object.entries(byOperator).map(([name, d]) => ({ name, ...d })).sort((a, b) => b.batches - a.batches),
    byQuality: Object.entries(byQuality).map(([name, d]) => ({ name, ...d })).sort((a, b) => b.than - a.than),
    byDate: Object.entries(byDate).map(([date, d]) => ({ date, ...d })).sort((a, b) => a.date.localeCompare(b.date)),
    entries: enriched,
  })
}
