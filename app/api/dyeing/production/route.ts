import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  const db = prisma as any

  const where: any = {}
  if (from || to) {
    where.date = {}
    if (from) where.date.gte = new Date(from)
    if (to) {
      const toDate = new Date(to)
      toDate.setHours(23, 59, 59, 999)
      where.date.lte = toDate
    }
  }

  const entries = await db.dyeingEntry.findMany({
    where,
    include: {
      chemicals: { include: { chemical: true } },
      lots: true,
      machine: true,
      operator: true,
      additions: {
        include: {
          chemicals: { include: { chemical: true } },
          machine: true,
          operator: true,
        },
        orderBy: { roundNo: 'asc' },
      },
    },
    orderBy: { date: 'desc' },
  })

  // Enrich with party names
  const allLotNos = new Set<string>()
  for (const e of entries) {
    if (e.lots?.length) e.lots.forEach((l: any) => allLotNos.add(l.lotNo))
    else allLotNos.add(e.lotNo)
  }

  const greyWithParty = await prisma.greyEntry.findMany({
    where: { lotNo: { in: Array.from(allLotNos) } },
    select: { lotNo: true, party: { select: { name: true } } },
    distinct: ['lotNo'],
  })
  const lotPartyMap = new Map(greyWithParty.map(g => [g.lotNo, g.party.name]))

  const enrichedEntries = entries.map((e: any) => {
    const lots = e.lots?.length ? e.lots : [{ lotNo: e.lotNo, than: e.than }]
    const partyNames = [...new Set(lots.map((l: any) => lotPartyMap.get(l.lotNo)).filter(Boolean))]
    return { ...e, partyName: partyNames.join(', ') || null }
  })

  // Calculate totals
  let totalSlips = enrichedEntries.length
  let totalThan = 0
  let doneCount = 0
  let patchyCount = 0
  let pendingCount = 0
  let reDyeingCount = 0
  let totalCost = 0
  let reDyeCost = 0

  const byMachineMap = new Map<number, any>()
  const byOperatorMap = new Map<number, any>()

  for (const e of enrichedEntries) {
    const eThan = e.lots?.length
      ? e.lots.reduce((s: number, l: any) => s + l.than, 0)
      : e.than
    totalThan += eThan

    const chemCost = e.chemicals?.reduce((s: number, c: any) => s + (c.cost ?? 0), 0) ?? 0
    const addCost = e.additions?.reduce((s: number, a: any) =>
      s + (a.chemicals?.reduce((s2: number, c: any) => s2 + (c.cost ?? 0), 0) ?? 0), 0) ?? 0
    const entryCost = chemCost + addCost
    totalCost += entryCost

    if (e.additions?.length > 0) {
      reDyeCost += addCost
    }

    const status = e.status || (e.dyeingDoneAt ? 'done' : 'pending')
    if (status === 'done' || e.dyeingDoneAt) doneCount++
    else if (status === 'patchy') patchyCount++
    else if (status === 're-dyeing') reDyeingCount++
    else pendingCount++

    // By machine
    if (e.machineId && e.machine) {
      if (!byMachineMap.has(e.machineId)) {
        byMachineMap.set(e.machineId, {
          machineId: e.machineId,
          name: e.machine.name,
          slips: 0, than: 0, done: 0, patchy: 0, cost: 0, entries: [],
        })
      }
      const m = byMachineMap.get(e.machineId)!
      m.slips++
      m.than += eThan
      m.cost += entryCost
      if (status === 'done' || e.dyeingDoneAt) m.done++
      if (status === 'patchy') m.patchy++
      m.entries.push({ id: e.id, slipNo: e.slipNo, lotNo: e.lotNo, than: eThan, status, shadeName: e.shadeName })
    }

    // By operator
    if (e.operatorId && e.operator) {
      if (!byOperatorMap.has(e.operatorId)) {
        byOperatorMap.set(e.operatorId, {
          operatorId: e.operatorId,
          name: e.operator.name,
          slips: 0, than: 0, done: 0, patchy: 0, cost: 0, entries: [],
        })
      }
      const o = byOperatorMap.get(e.operatorId)!
      o.slips++
      o.than += eThan
      o.cost += entryCost
      if (status === 'done' || e.dyeingDoneAt) o.done++
      if (status === 'patchy') o.patchy++
      o.entries.push({ id: e.id, slipNo: e.slipNo, lotNo: e.lotNo, than: eThan, status, shadeName: e.shadeName })
    }
  }

  return NextResponse.json({
    totals: {
      slips: totalSlips,
      than: totalThan,
      done: doneCount,
      patchy: patchyCount,
      pending: pendingCount,
      reDyeing: reDyeingCount,
      totalCost,
      reDyeCost,
    },
    byMachine: Array.from(byMachineMap.values()),
    byOperator: Array.from(byOperatorMap.values()),
    entries: enrichedEntries,
  })
}
