export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// Parse weight string like "98g", ".98g", "0.98g", "(RG)" → kg per meter
function parseWeightKgPerMtr(weightStr: string | null | undefined): number {
  if (!weightStr) return 0
  const num = parseFloat(weightStr.replace(/[^0-9.]/g, ''))
  if (isNaN(num)) return 0
  const grams = num < 1 ? num * 100 : num
  return grams / 1000
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    // Get fold batch IDs that already have a DyeingEntry linked
    const db = prisma as any
    const usedBatches = await db.dyeingEntry.findMany({
      where: { foldBatchId: { not: null } },
      select: { foldBatchId: true },
    })
    const usedBatchIds = new Set(usedBatches.map((e: any) => e.foldBatchId))

    // Fetch all fold programs with batches, lots, shade, recipe
    const programs = await prisma.foldProgram.findMany({
      include: {
        batches: {
          include: {
            lots: true,
            shade: {
              include: {
                recipeItems: {
                  include: { chemical: true },
                },
              },
            },
          },
        },
      },
      orderBy: { date: 'desc' },
    })

    // Collect all unique lot numbers to batch-query grey entries
    const allLotNos = new Set<string>()
    for (const prog of programs) {
      for (const batch of prog.batches) {
        for (const lot of batch.lots) {
          allLotNos.add(lot.lotNo)
        }
      }
    }

    // Fetch grey entries for weight + quality data
    const greyEntries = await prisma.greyEntry.findMany({
      where: { lotNo: { in: Array.from(allLotNos) } },
      select: { lotNo: true, weight: true, grayMtr: true, than: true, quality: { select: { name: true } } },
    })

    // Build quality map: lotNo → quality name
    const qualityMap = new Map<string, string>()
    for (const g of greyEntries) {
      if (g.quality?.name && !qualityMap.has(g.lotNo)) qualityMap.set(g.lotNo, g.quality.name)
    }

    // Build a map: lotNo → aggregated weight data (sum across all grey entries for same lot)
    const greyMap = new Map<string, { weight: string | null; grayMtr: number; than: number }[]>()
    for (const g of greyEntries) {
      if (!greyMap.has(g.lotNo)) greyMap.set(g.lotNo, [])
      greyMap.get(g.lotNo)!.push({ weight: g.weight, grayMtr: g.grayMtr ?? 0, than: g.than })
    }

    // Fetch opening balance weight data for carry-forward lots
    const obEntries = await db.lotOpeningBalance.findMany({
      where: { lotNo: { in: Array.from(allLotNos) } },
      select: { lotNo: true, weight: true, grayMtr: true, greyThan: true, quality: true, marka: true },
    })
    const obMap = new Map<string, { weight: string | null; grayMtr: number; than: number; quality: string | null }>()
    for (const o of obEntries) {
      obMap.set(o.lotNo, { weight: o.weight, grayMtr: o.grayMtr ?? 0, than: o.greyThan ?? 0, quality: o.quality })
      // Also fill qualityMap from OB if not already set
      if (o.quality && !qualityMap.has(o.lotNo)) qualityMap.set(o.lotNo, o.quality)
    }

    // Calculate weight per than for a lot
    function calcWeightPerThan(lotNo: string): number {
      // Try grey entries first
      const entries = greyMap.get(lotNo)
      if (entries && entries.length > 0) {
        for (const e of entries) {
          const kgPerMtr = parseWeightKgPerMtr(e.weight)
          if (kgPerMtr > 0 && e.grayMtr > 0 && e.than > 0) {
            return kgPerMtr * e.grayMtr / e.than
          }
        }
      }
      // Fallback: opening balance
      const ob = obMap.get(lotNo)
      if (ob) {
        const kgPerMtr = parseWeightKgPerMtr(ob.weight)
        if (kgPerMtr > 0 && ob.grayMtr > 0 && ob.than > 0) {
          return kgPerMtr * ob.grayMtr / ob.than
        }
      }
      return 0
    }

    // Build marka map from grey + OB
    const greyMarkaMap = new Map<string, string>()
    const greyWithMarka = await prisma.greyEntry.findMany({
      where: { lotNo: { in: Array.from(allLotNos) }, marka: { not: null } },
      select: { lotNo: true, marka: true },
    })
    for (const g of greyWithMarka) { if (g.marka) greyMarkaMap.set(g.lotNo, g.marka) }
    for (const o of obEntries) { if (o.marka && !greyMarkaMap.has(o.lotNo)) greyMarkaMap.set(o.lotNo, o.marka) }

    // Get Pali PC Job party IDs
    const paliParties = await prisma.party.findMany({ where: { tag: 'Pali PC Job' }, select: { id: true } })
    const paliIds = new Set(paliParties.map(p => p.id))

    // Build response — exclude batches already linked to a DyeingEntry
    const result = []
    for (const prog of programs) {
      for (const batch of prog.batches) {
        if (usedBatchIds.has(batch.id)) continue
        const isPali = batch.lots.some((l: any) => l.partyId && paliIds.has(l.partyId))
        const lots = batch.lots.map(lot => {
          const wpt = calcWeightPerThan(lot.lotNo)
          return {
            lotNo: lot.lotNo,
            than: lot.than,
            weightPerThan: Math.round(wpt * 100) / 100,
            quality: qualityMap.get(lot.lotNo) ?? '',
            marka: greyMarkaMap.get(lot.lotNo) ?? null,
          }
        })

        const totalThan = lots.reduce((s, l) => s + l.than, 0)
        const totalWeight = lots.reduce((s, l) => s + l.weightPerThan * l.than, 0)

        // Build recipe with calculated quantities
        const recipe = batch.shade?.recipeItems?.map(ri => {
          const calcQty = (ri.quantity / 100) * totalWeight
          return {
            chemicalId: ri.chemicalId,
            chemicalName: ri.chemical.name,
            unit: ri.chemical.unit,
            qtyPer100kg: ri.quantity,
            calculatedQty: Math.round(calcQty * 1000) / 1000,
            rate: ri.chemical.currentPrice,
          }
        }) ?? []

        const shadeName = batch.shade?.name ?? batch.shadeName ?? 'No Shade'

        result.push({
          foldNo: prog.foldNo,
          foldDate: prog.date,
          foldProgramId: prog.id,
          batchNo: batch.batchNo,
          batchId: batch.id,
          shadeName,
          shadeDescription: batch.shade?.description ?? null,
          shadeId: batch.shadeId,
          lots,
          totalThan,
          totalWeight: Math.round(totalWeight * 100) / 100,
          recipe,
          isPcJob: isPali,
        })
      }
    }

    return NextResponse.json(result)
  } catch (err: any) {
    console.error('GET /api/dyeing/batches error:', err)
    return NextResponse.json({ error: err.message ?? 'Server error' }, { status: 500 })
  }
}
