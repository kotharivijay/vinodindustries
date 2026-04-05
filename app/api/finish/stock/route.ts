import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Get all dyeing entries where dyeingDoneAt is set (status = done)
  const doneSlips = await prisma.dyeingEntry.findMany({
    where: { dyeingDoneAt: { not: null } },
    include: {
      lots: true,
      chemicals: { include: { chemical: true } },
      foldBatch: { include: { shade: true } },
    },
    orderBy: { dyeingDoneAt: 'desc' },
  })

  // Get all finish entries to exclude already-finished lots
  const finishEntries = await prisma.finishEntry.findMany({
    include: { lots: true },
  })

  // Build set of finished lot+slipNo combos
  const finishedSet = new Set<string>()
  for (const f of finishEntries) {
    const lots = f.lots?.length ? f.lots : [{ lotNo: f.lotNo }]
    for (const l of lots) {
      finishedSet.add(`${f.slipNo}|${l.lotNo.toLowerCase().trim()}`)
    }
  }

  // Enrich with party name from grey entries
  const greyEntries = await prisma.greyEntry.findMany({
    select: { lotNo: true, party: { select: { name: true } }, quality: { select: { name: true } } },
    distinct: ['lotNo'],
  })
  const lotInfoMap = new Map(greyEntries.map(g => [g.lotNo.toLowerCase().trim(), { party: g.party.name, quality: g.quality.name }]))

  // Filter: done dyeing NOT yet finished
  const stock = []
  for (const d of doneSlips) {
    const lots = d.lots?.length ? d.lots : [{ lotNo: d.lotNo, than: d.than, id: 0, entryId: d.id }]

    // Check if ALL lots of this slip are finished
    const unfinishedLots = lots.filter(l => !finishedSet.has(`${d.slipNo}|${l.lotNo.toLowerCase().trim()}`))
    if (unfinishedLots.length === 0) continue // all lots finished

    const lotInfo = lotInfoMap.get((lots[0]?.lotNo || d.lotNo).toLowerCase().trim())

    stock.push({
      id: d.id,
      slipNo: d.slipNo,
      date: d.date,
      dyeingDoneAt: d.dyeingDoneAt,
      notes: d.notes,
      status: (d as any).status || 'done',
      lotNo: d.lotNo,
      than: d.than,
      lots: unfinishedLots.map(l => ({
        lotNo: l.lotNo,
        than: l.than,
      })),
      totalThan: unfinishedLots.reduce((s, l) => s + (l.than || 0), 0),
      chemicals: d.chemicals.map(c => ({
        name: c.name,
        quantity: c.quantity,
        unit: c.unit,
        rate: c.rate,
        cost: c.cost,
      })),
      party: lotInfo?.party || null,
      quality: lotInfo?.quality || null,
      shade: (d as any).foldBatch?.shade?.description || (d as any).foldBatch?.shadeDescription || (d as any).shadeName || null,
    })
  }

  return NextResponse.json({
    stock,
    totalSlips: stock.length,
    totalThan: stock.reduce((s, d) => s + d.totalThan, 0),
  })
}
