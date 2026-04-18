export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slipNo: string }> }) {
  const apiKey = _req.headers.get('x-api-key')
  if (!apiKey || apiKey !== process.env.PRINT_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { slipNo } = await params
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

  // Get dyeing info for each lot (fold, shade, dye slip)
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
  })

  // Build fold → quality → slip → lots hierarchy
  type SlipInfo = { slipNo: number; shadeName: string; shadeDesc: string; lots: { lotNo: string; than: number }[] }
  type QualityInfo = { quality: string; slips: Map<number, SlipInfo> }
  type FoldInfo = { foldNo: string; qualities: Map<string, QualityInfo> }

  const foldMap = new Map<string, FoldInfo>()

  for (const de of dyeingEntries) {
    const foldNo = de.foldBatch?.foldProgram?.foldNo || 'No Fold'
    const shadeName = de.shadeName || de.foldBatch?.shade?.name || ''
    const shadeDesc = de.foldBatch?.shade?.description || ''
    const deLots = de.lots?.length ? de.lots : []

    // Only include lots that are in this FP
    const fpLotSet = new Set(lotNos.map((l: string) => l.toLowerCase()))
    const matchingLots = deLots.filter((l: any) => fpLotSet.has(l.lotNo.toLowerCase()))
    if (matchingLots.length === 0) continue

    if (!foldMap.has(foldNo)) foldMap.set(foldNo, { foldNo, qualities: new Map() })
    const fold = foldMap.get(foldNo)!

    const q = qualityName || 'Unknown'
    if (!fold.qualities.has(q)) fold.qualities.set(q, { quality: q, slips: new Map() })
    const quality = fold.qualities.get(q)!

    if (!quality.slips.has(de.slipNo)) {
      quality.slips.set(de.slipNo, { slipNo: de.slipNo, shadeName, shadeDesc, lots: [] })
    }
    const slip = quality.slips.get(de.slipNo)!
    for (const ml of matchingLots) {
      slip.lots.push({ lotNo: ml.lotNo, than: ml.than })
    }
  }

  // Convert maps to arrays
  const hierarchy = Array.from(foldMap.values()).map(f => ({
    foldNo: f.foldNo,
    qualities: Array.from(f.qualities.values()).map(q => ({
      quality: q.quality,
      slips: Array.from(q.slips.values()).map(s => ({
        slipNo: s.slipNo,
        shadeName: s.shadeName,
        shadeDesc: s.shadeDesc,
        lots: s.lots,
      })),
    })),
  }))

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
