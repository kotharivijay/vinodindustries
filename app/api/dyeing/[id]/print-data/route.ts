export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const apiKey = _req.headers.get('x-api-key')
  if (!apiKey || apiKey !== process.env.PRINT_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const db = prisma as any

  // Find by slip number or entry ID
  const isSlipNo = !isNaN(parseInt(id))
  const entry = isSlipNo
    ? await db.dyeingEntry.findFirst({
        where: { slipNo: parseInt(id) },
        include: {
          chemicals: { include: { chemical: true } },
          lots: true,
          machine: true,
          operator: true,
          foldBatch: { include: { shade: { select: { description: true } } } },
        },
      })
    : null

  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Enrich with party + quality
  const lotNos = entry.lots?.length ? entry.lots.map((l: any) => l.lotNo) : [entry.lotNo]
  const { buildLotInfoMap } = await import('@/lib/lot-info')
  const lotInfoMap = await buildLotInfoMap(lotNos)
  const lotInfos = Array.from(lotInfoMap.values())
  const partyName = [...new Set(lotInfos.map(v => v.party).filter(Boolean))].join(', ') || ''
  const qualityName = [...new Set(lotInfos.map(v => v.quality).filter(Boolean))].join(', ') || ''

  const lots = entry.lots?.length ? entry.lots : [{ lotNo: entry.lotNo, than: entry.than }]
  const lotMarkaMap = new Map<string, string>()
  for (const [key, info] of lotInfoMap) {
    if (info.marka) lotMarkaMap.set(key, info.marka)
  }

  return NextResponse.json({
    slipNo: entry.slipNo,
    date: new Date(entry.date).toLocaleDateString('en-IN'),
    partyName,
    qualityName,
    shadeName: entry.shadeName || '',
    shadeDescription: entry.foldBatch?.shade?.description || '',
    machineName: entry.machine?.name || '',
    operatorName: entry.operator?.name || '',
    marka: entry.marka || lotInfos.find(li => li.marka)?.marka || '',
    totalThan: lots.reduce((s: number, l: any) => s + l.than, 0),
    lots: lots.map((l: any) => ({
      lotNo: l.lotNo,
      than: l.than,
      marka: lotMarkaMap.get(l.lotNo.toLowerCase().trim()) || '',
    })),
    chemicals: (entry.chemicals || []).map((c: any) => ({
      name: c.name,
      quantity: c.quantity,
      unit: c.unit,
      processTag: c.processTag || '',
    })),
  })
}
