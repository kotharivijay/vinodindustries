export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key')
  if (!apiKey || apiKey !== process.env.PRINT_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  let entries: any[]
  try {
    const db = prisma as any
    entries = await db.dyeingEntry.findMany({
      include: {
        chemicals: { select: { name: true, quantity: true, unit: true, processTag: true } },
        lots: { select: { lotNo: true, than: true } },
        machine: { select: { name: true } },
        operator: { select: { name: true } },
        foldBatch: {
          include: {
            foldProgram: { select: { foldNo: true } },
            shade: { select: { name: true } },
          },
        },
      },
      orderBy: { date: 'desc' },
    })
  } catch {
    entries = []
  }

  // Enrich with party names
  const allLotNos = new Set<string>()
  for (const e of entries) {
    if (e.lots?.length) e.lots.forEach((l: any) => allLotNos.add(l.lotNo))
    else allLotNos.add(e.lotNo)
  }

  const { buildLotInfoMap } = await import('@/lib/lot-info')
  const lotInfoMap = await buildLotInfoMap(Array.from(allLotNos))

  const enriched = entries.map((e: any) => {
    const lots = e.lots?.length ? e.lots : [{ lotNo: e.lotNo, than: e.than }]
    const lotInfos = lots.map((l: any) => lotInfoMap.get(l.lotNo.toLowerCase().trim())).filter(Boolean)
    const partyNames = [...new Set(lotInfos.map((li: any) => li.party).filter(Boolean))]
    const lotMarka = lotInfos.find((li: any) => li.marka)?.marka || null
    return { ...e, partyName: partyNames.join(', ') || null, marka: e.marka || lotMarka }
  })

  return NextResponse.json(enriched)
}
