export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = prisma as any

  // Run dyeing entries + finish lots in parallel (independent queries)
  const { buildLotInfoMap } = await import('@/lib/lot-info')

  const [doneSlips, finishLots] = await Promise.all([
    db.dyeingEntry.findMany({
      where: { dyeingDoneAt: { not: null } },
      select: {
        id: true,
        slipNo: true,
        date: true,
        dyeingDoneAt: true,
        shadeName: true,
        lotNo: true,
        than: true,
        marka: true,
        isPcJob: true,
        machine: { select: { name: true } },
        operator: { select: { name: true } },
        lots: { select: { lotNo: true, than: true } },
        foldBatch: { select: { batchNo: true, foldProgram: { select: { foldNo: true } }, shade: { select: { name: true, description: true } } } },
      },
      orderBy: { dyeingDoneAt: 'desc' },
    }),
    db.finishEntryLot.findMany({
      select: { lotNo: true, than: true },
    }),
  ])

  // Collect all lot numbers
  const allLotNos = new Set<string>()
  for (const d of doneSlips) {
    const lots = d.lots?.length ? d.lots : [{ lotNo: d.lotNo }]
    for (const l of lots) allLotNos.add(l.lotNo)
  }

  const lotInfoMap = await buildLotInfoMap(Array.from(allLotNos))
  const finishedThanMap = new Map<string, number>()
  for (const fl of finishLots) {
    const key = fl.lotNo.toLowerCase().trim()
    finishedThanMap.set(key, (finishedThanMap.get(key) || 0) + fl.than)
  }

  // Build stock list, deducting finished than (FIFO across slips)
  const stock: any[] = []
  const deductedMap = new Map<string, number>()
  for (const d of doneSlips) {
    const lots = d.lots?.length ? d.lots : [{ lotNo: d.lotNo, than: d.than }]
    const lotInfo = lotInfoMap.get((lots[0]?.lotNo || d.lotNo).toLowerCase().trim())
    const shadeName = d.shadeName || d.foldBatch?.shade?.name || null
    const shadeDesc = d.foldBatch?.shade?.description || null

    // Deduct finished than per lot (FIFO: deduct from oldest slips first)
    const adjustedLots: any[] = []
    for (const l of lots) {
      const key = l.lotNo.toLowerCase().trim()
      const totalFinished = finishedThanMap.get(key) || 0
      // Track how much already deducted from previous slips
      if (!deductedMap.has(key)) deductedMap.set(key, 0)
      const alreadyDeducted = deductedMap.get(key)!
      const remainingToDeduct = Math.max(0, totalFinished - alreadyDeducted)
      const deductFromThis = Math.min(l.than, remainingToDeduct)
      deductedMap.set(key, alreadyDeducted + deductFromThis)
      const remaining = l.than - deductFromThis
      if (remaining > 0) {
        const li = lotInfoMap.get(key)
        adjustedLots.push({
          lotNo: l.lotNo,
          than: remaining,
          originalThan: l.than,
          finishedThan: deductFromThis,
          party: li?.party || lotInfo?.party || null,
          quality: li?.quality || lotInfo?.quality || null,
          weight: li?.weight || lotInfo?.weight || null,
          mtrPerThan: li?.mtrPerThan || lotInfo?.mtrPerThan || null,
        })
      }
    }

    // Skip entire slip if all lots are fully finished
    if (adjustedLots.length === 0) continue

    stock.push({
      id: d.id,
      slipNo: d.slipNo,
      date: d.date,
      dyeingDoneAt: d.dyeingDoneAt,
      shadeName,
      shadeDescription: shadeDesc,
      foldNo: d.foldBatch?.foldProgram?.foldNo || null,
      batchNo: d.foldBatch?.batchNo || null,
      lots: adjustedLots,
      totalThan: adjustedLots.reduce((s: number, l: any) => s + l.than, 0),
      party: lotInfo?.party || null,
      quality: lotInfo?.quality || null,
      weight: lotInfo?.weight || null,
      marka: d.marka || null,
      isPcJob: d.isPcJob || false,
      machineName: d.machine?.name || null,
      operatorName: d.operator?.name || null,
    })
  }

  // Inject OB allocations tagged as 'dyed' (available for finish)
  try {
    const obDyed = await db.lotOpeningBalanceAllocation.findMany({
      where: { stage: 'dyed' },
      include: { balance: true },
    })
    for (const alloc of obDyed) {
      const b = alloc.balance
      const key = b.lotNo.toLowerCase().trim()
      const totalFinished = finishedThanMap.get(key) || 0
      const alreadyDeducted = deductedMap.get(key) || 0
      const remainingToDeduct = Math.max(0, totalFinished - alreadyDeducted)
      const deductFromThis = Math.min(alloc.than, remainingToDeduct)
      deductedMap.set(key, alreadyDeducted + deductFromThis)
      const remaining = alloc.than - deductFromThis
      if (remaining <= 0) continue

      const mtrPerThan = b.grayMtr && b.greyThan ? b.grayMtr / b.greyThan : null
      stock.push({
        id: -alloc.id, // negative id to avoid collision with real DyeingEntry ids
        slipNo: 0,
        date: b.greyDate || b.createdAt,
        dyeingDoneAt: b.greyDate || b.createdAt,
        shadeName: null,
        shadeDescription: null,
        foldNo: null,
        batchNo: null,
        lots: [{
          lotNo: b.lotNo,
          than: remaining,
          originalThan: alloc.than,
          finishedThan: deductFromThis,
          party: b.party,
          quality: b.quality,
          weight: b.weight,
          mtrPerThan,
        }],
        totalThan: remaining,
        party: b.party,
        quality: b.quality,
        weight: b.weight,
        marka: b.marka,
        isPcJob: false,
        machineName: null,
        operatorName: null,
        isFromOB: true,
        obStage: 'dyed',
        obNotes: alloc.notes || null,
      })
    }
  } catch {}

  // Inject current-year lots tagged with startStage='finish'. These arrived
  // already-processed and skip Grey/Fold/Dye → they should appear as
  // ready-to-finish stock here. Same FIFO finish-deduction as dye slips.
  try {
    const startStageRows = await prisma.greyEntry.findMany({
      where: { startStage: 'finish' },
      select: {
        id: true, lotNo: true, than: true, date: true, grayMtr: true, weight: true, marka: true,
        party: { select: { name: true } },
        quality: { select: { name: true } },
      },
      orderBy: { date: 'asc' },
    })
    // Aggregate by lotNo so multi-challan lots show as one virtual entry
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
          meter: r.grayMtr || null,
          date: r.date,
          party: r.party?.name || null,
          quality: r.quality?.name || null,
          weight: r.weight,
          marka: r.marka,
        })
      }
    }
    for (const [key, info] of grouped) {
      const totalFinished = finishedThanMap.get(key) || 0
      const alreadyDeducted = deductedMap.get(key) || 0
      const remainingToDeduct = Math.max(0, totalFinished - alreadyDeducted)
      const deductFromThis = Math.min(info.totalThan, remainingToDeduct)
      deductedMap.set(key, alreadyDeducted + deductFromThis)
      const remaining = info.totalThan - deductFromThis
      if (remaining <= 0) continue

      const mtrPerThan = info.meter && info.totalThan ? info.meter / info.totalThan : null
      stock.push({
        id: -info.firstId * 1000, // synthetic, distinct from OB injections
        slipNo: 0,
        date: info.date,
        dyeingDoneAt: info.date,
        shadeName: null,
        shadeDescription: null,
        foldNo: null,
        batchNo: null,
        lots: [{
          lotNo: info.lotNo,
          than: remaining,
          originalThan: info.totalThan,
          finishedThan: deductFromThis,
          party: info.party,
          quality: info.quality,
          weight: info.weight,
          mtrPerThan,
        }],
        totalThan: remaining,
        party: info.party,
        quality: info.quality,
        weight: info.weight,
        marka: info.marka,
        isPcJob: false,
        machineName: null,
        operatorName: null,
        isFromStartStage: true,
        startStage: 'finish',
      })
    }
  } catch {}

  return NextResponse.json({
    stock,
    totalSlips: stock.length,
    totalThan: stock.reduce((s: number, d: any) => s + d.totalThan, 0),
  })
}
