import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = prisma as any

  // Get done dyeing entries — only fields needed
  const doneSlips = await db.dyeingEntry.findMany({
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
      foldBatch: { select: { shade: { select: { name: true, description: true } } } },
    },
    orderBy: { dyeingDoneAt: 'desc' },
  })

  // Collect all lot numbers
  const allLotNos = new Set<string>()
  for (const d of doneSlips) {
    const lots = d.lots?.length ? d.lots : [{ lotNo: d.lotNo }]
    for (const l of lots) allLotNos.add(l.lotNo)
  }

  // Batch fetch party + quality for all lots
  const greyEntries = await prisma.greyEntry.findMany({
    where: { lotNo: { in: Array.from(allLotNos) } },
    select: { lotNo: true, weight: true, party: { select: { name: true } }, quality: { select: { name: true } } },
    distinct: ['lotNo'],
  })
  const lotInfoMap = new Map(greyEntries.map(g => [g.lotNo.toLowerCase().trim(), { party: g.party.name, quality: g.quality.name, weight: g.weight }]))

  // Build stock list
  const stock = doneSlips.map((d: any) => {
    const lots = d.lots?.length ? d.lots : [{ lotNo: d.lotNo, than: d.than }]
    const lotInfo = lotInfoMap.get((lots[0]?.lotNo || d.lotNo).toLowerCase().trim())
    const shadeName = d.shadeName || d.foldBatch?.shade?.name || null
    const shadeDesc = d.foldBatch?.shade?.description || null

    return {
      id: d.id,
      slipNo: d.slipNo,
      date: d.date,
      dyeingDoneAt: d.dyeingDoneAt,
      shadeName,
      shadeDescription: shadeDesc,
      lots: lots.map((l: any) => {
        const li = lotInfoMap.get(l.lotNo.toLowerCase().trim())
        return { lotNo: l.lotNo, than: l.than, party: li?.party || lotInfo?.party || null, quality: li?.quality || lotInfo?.quality || null, weight: li?.weight || lotInfo?.weight || null }
      }),
      totalThan: lots.reduce((s: number, l: any) => s + (l.than || 0), 0),
      party: lotInfo?.party || null,
      quality: lotInfo?.quality || null,
      weight: lotInfo?.weight || null,
      marka: d.marka || null,
      isPcJob: d.isPcJob || false,
      machineName: d.machine?.name || null,
      operatorName: d.operator?.name || null,
    }
  })

  return NextResponse.json({
    stock,
    totalSlips: stock.length,
    totalThan: stock.reduce((s: number, d: any) => s + d.totalThan, 0),
  })
}
