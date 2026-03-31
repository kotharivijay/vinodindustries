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

    // Calculate weight per than for a lot
    function calcWeightPerThan(lotNo: string): number {
      const entries = greyMap.get(lotNo)
      if (!entries || entries.length === 0) return 0
      // Use the first entry with a valid weight
      for (const e of entries) {
        const kgPerMtr = parseWeightKgPerMtr(e.weight)
        if (kgPerMtr > 0 && e.grayMtr > 0 && e.than > 0) {
          return kgPerMtr * e.grayMtr / e.than
        }
      }
      return 0
    }

    // Build response — exclude batches already linked to a DyeingEntry
    const result = []
    for (const prog of programs) {
      for (const batch of prog.batches) {
        if (usedBatchIds.has(batch.id)) continue
        const lots = batch.lots.map(lot => {
          const wpt = calcWeightPerThan(lot.lotNo)
          return {
            lotNo: lot.lotNo,
            than: lot.than,
            weightPerThan: Math.round(wpt * 100) / 100,
            quality: qualityMap.get(lot.lotNo) ?? '',
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
            calculatedQty: Math.round(calcQty * 100) / 100,
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
          shadeId: batch.shadeId,
          lots,
          totalThan,
          totalWeight: Math.round(totalWeight * 100) / 100,
          recipe,
        })
      }
    }

    return NextResponse.json(result)
  } catch (err: any) {
    console.error('GET /api/dyeing/batches error:', err)
    return NextResponse.json({ error: err.message ?? 'Server error' }, { status: 500 })
  }
}
