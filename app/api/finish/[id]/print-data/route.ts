export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { allocateFpToDyeingSlips } from '@/lib/finish-slip-allocator'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const apiKey = _req.headers.get('x-api-key')
  if (!apiKey || apiKey !== process.env.PRINT_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: slipNo } = await params
  const db = prisma as any

  const entry = await db.finishEntry.findFirst({
    where: { slipNo: parseInt(slipNo) },
    include: {
      chemicals: { include: { chemical: true } },
      lots: true,
    },
  })

  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Get lot info (party, quality, weight)
  const lotNos = entry.lots?.length ? entry.lots.map((l: any) => l.lotNo) : [entry.lotNo]
  const { buildLotInfoMap } = await import('@/lib/lot-info')
  const lotInfoMap = await buildLotInfoMap(lotNos)
  const lotInfos = Array.from(lotInfoMap.values())
  const partyName = [...new Set(lotInfos.map(v => v.party).filter(Boolean))].join(', ') || ''
  const qualityName = [...new Set(lotInfos.map(v => v.quality).filter(Boolean))].join(', ') || ''

  // FP's per-lot than allocation — source of truth for the hierarchy totals.
  const fpLots = entry.lots?.length ? entry.lots : (entry.lotNo ? [{ lotNo: entry.lotNo, than: entry.than }] : [])

  // Pull every dyeing entry that touched any of these lots; the allocator
  // figures out which subset (and what amount) actually contributed to THIS FP.
  const dyeingEntries = await db.dyeingEntry.findMany({
    where: {
      OR: [
        { lotNo: { in: lotNos } },
        { lots: { some: { lotNo: { in: lotNos } } } },
      ],
    },
    select: {
      slipNo: true,
      shadeName: true,
      lots: { select: { lotNo: true, than: true } },
      foldBatch: {
        select: {
          foldProgram: { select: { foldNo: true } },
          shade: { select: { name: true, description: true } },
        },
      },
    },
    orderBy: { slipNo: 'desc' },
  })

  const foldGroups = allocateFpToDyeingSlips(
    fpLots.map((l: any) => ({ lotNo: l.lotNo, than: Number(l.than) })),
    dyeingEntries.map((de: any) => ({
      slipNo: de.slipNo,
      shadeName: de.shadeName ?? null,
      lots: de.lots,
      foldBatch: de.foldBatch ?? null,
    })),
  )

  // Re-shape into the existing fold→quality→slip→lots structure the printer
  // expects. (Quality is the single FP-level quality name — we don't split.)
  type SlipInfo = { slipNo: number; shadeName: string; shadeDesc: string; lots: { lotNo: string; than: number }[] }
  type QualityInfo = { quality: string; slips: SlipInfo[] }
  type FoldInfo = { foldNo: string; qualities: QualityInfo[] }
  const foldMapShaped: FoldInfo[] = foldGroups.map(fg => ({
    foldNo: fg.foldNo,
    qualities: [{
      quality: qualityName || 'Unknown',
      slips: fg.slips.map(s => ({
        slipNo: s.slipNo,
        shadeName: s.shadeName ?? '',
        shadeDesc: s.shadeDesc ?? '',
        lots: s.lots,
      })),
    }],
  }))

  const hierarchy = foldMapShaped

  // Finish recipe
  const lots = entry.lots?.length ? entry.lots : [{ lotNo: entry.lotNo, than: entry.than }]
  const totalThan = lots.reduce((s: number, l: any) => s + l.than, 0)

  // Get finish recipe for this party+quality
  let recipe: any[] = []
  try {
    const parties = await prisma.party.findMany({ select: { id: true, name: true } })
    const qualities = await prisma.quality.findMany({ select: { id: true, name: true } })
    const norm = (s: string) => s.toLowerCase().trim()
    const party = parties.find(p => partyName && norm(p.name) === norm(partyName))
    const quality = qualities.find(q => qualityName && norm(q.name) === norm(qualityName))
    if (party && quality) {
      const recipeEntry = await db.finishRecipe.findFirst({
        where: { partyId: party.id, qualityId: quality.id },
        include: { items: { include: { chemical: { select: { name: true, currentPrice: true } } } } },
      })
      if (recipeEntry) {
        recipe = recipeEntry.items.map((item: any) => ({
          name: item.chemical?.name || item.name || '',
          quantity: item.quantity,
          unit: item.unit || 'kg',
          rate: item.chemical?.currentPrice || null,
        }))
      }
    }
  } catch {}

  return NextResponse.json({
    slipNo: entry.slipNo,
    date: new Date(entry.date).toLocaleDateString('en-IN'),
    partyName,
    qualityName,
    totalThan,
    lots: lots.map((l: any) => ({ lotNo: l.lotNo, than: l.than })),
    hierarchy,
    recipe,
    chemicals: (entry.chemicals || []).map((c: any) => ({
      name: c.name,
      quantity: c.quantity,
      unit: c.unit,
    })),
  })
}
