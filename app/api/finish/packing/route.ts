import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = prisma as any

  // Fetch all finish entries with lots
  const finishEntries = await db.finishEntry.findMany({
    include: {
      lots: true,
      chemicals: { include: { chemical: true } },
    },
    orderBy: { date: 'desc' },
  })

  // Fetch all despatched lot numbers
  const despatchEntries = await db.despatchEntry.findMany({
    select: { lotNo: true },
  })
  const despatchedLots = new Set<string>(despatchEntries.map((d: any) => d.lotNo.toLowerCase().trim()))

  // Filter finish entries to only those with lots NOT yet despatched
  const packingEntries: any[] = []
  for (const fe of finishEntries) {
    const lots = fe.lots?.length ? fe.lots : [{ lotNo: fe.lotNo, than: fe.than, meter: fe.meter }]
    const undespatched = lots.filter((l: any) => !despatchedLots.has(l.lotNo.toLowerCase().trim()))
    if (undespatched.length > 0) {
      packingEntries.push({
        id: fe.id,
        slipNo: fe.slipNo,
        date: fe.date,
        meter: fe.meter,
        mandi: fe.mandi,
        notes: fe.notes,
        lots: undespatched,
        totalThan: undespatched.reduce((s: number, l: any) => s + (l.than || 0), 0),
      })
    }
  }

  // Enrich with party / quality / shade info
  const allLotNos = new Set<string>()
  for (const pe of packingEntries) {
    for (const l of pe.lots) allLotNos.add(l.lotNo)
  }

  const greyEntries = await prisma.greyEntry.findMany({
    where: { lotNo: { in: Array.from(allLotNos) } },
    select: { lotNo: true, weight: true, party: { select: { name: true } }, quality: { select: { name: true } } },
    distinct: ['lotNo'],
  })
  const lotInfoMap = new Map(greyEntries.map(g => [g.lotNo.toLowerCase().trim(), { party: g.party.name, quality: g.quality.name, weight: g.weight }]))

  // Get shade info from dyeing entries for these lots
  const dyeingEntries = await db.dyeingEntry.findMany({
    where: {
      dyeingDoneAt: { not: null },
      OR: [
        { lotNo: { in: Array.from(allLotNos) } },
        { lots: { some: { lotNo: { in: Array.from(allLotNos) } } } },
      ],
    },
    select: {
      lotNo: true,
      shadeName: true,
      lots: { select: { lotNo: true } },
      foldBatch: { select: { shade: { select: { name: true, description: true } } } },
    },
  })

  const lotShadeMap = new Map<string, { shadeName: string | null; shadeDescription: string | null }>()
  for (const de of dyeingEntries) {
    const shade = de.shadeName || de.foldBatch?.shade?.name || null
    const desc = de.foldBatch?.shade?.description || null
    const lotsInEntry = de.lots?.length ? de.lots.map((l: any) => l.lotNo) : [de.lotNo]
    for (const ln of lotsInEntry) {
      if (!lotShadeMap.has(ln.toLowerCase().trim())) {
        lotShadeMap.set(ln.toLowerCase().trim(), { shadeName: shade, shadeDescription: desc })
      }
    }
  }

  // Build enriched response
  const stock = packingEntries.map(pe => ({
    ...pe,
    lots: pe.lots.map((l: any) => {
      const li = lotInfoMap.get(l.lotNo.toLowerCase().trim())
      const shade = lotShadeMap.get(l.lotNo.toLowerCase().trim())
      return {
        lotNo: l.lotNo,
        than: l.than,
        meter: l.meter,
        party: li?.party || null,
        quality: li?.quality || null,
        weight: li?.weight || null,
        shadeName: shade?.shadeName || null,
        shadeDescription: shade?.shadeDescription || null,
      }
    }),
  }))

  return NextResponse.json({
    stock,
    totalSlips: stock.length,
    totalThan: stock.reduce((s: number, d: any) => s + d.totalThan, 0),
  })
}
