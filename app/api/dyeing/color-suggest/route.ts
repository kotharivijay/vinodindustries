import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

function deltaE(c1: number[], c2: number[]): number {
  return Math.sqrt(
    (c1[0] - c2[0]) ** 2 +
    (c1[1] - c2[1]) ** 2 +
    (c1[2] - c2[2]) ** 2 +
    (c1[3] - c2[3]) ** 2
  )
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { colorC, colorM, colorY, colorK } = body

  if (colorC == null || colorM == null || colorY == null || colorK == null) {
    return NextResponse.json({ error: 'CMYK values required' }, { status: 400 })
  }

  const target = [colorC, colorM, colorY, colorK]
  const db = prisma as any

  // Fetch all confirmed entries with CMYK data
  const entries = await db.dyeingEntry.findMany({
    where: {
      dyeingDoneAt: { not: null },
      colorC: { not: null },
      colorM: { not: null },
      colorY: { not: null },
      colorK: { not: null },
    },
    include: {
      chemicals: true,
    },
  })

  // Filter within deltaE < 30
  const matches = entries
    .map((e: any) => ({
      ...e,
      deltaE: deltaE(target, [e.colorC, e.colorM, e.colorY, e.colorK]),
    }))
    .filter((e: any) => e.deltaE < 30)

  // Group by shade name
  const shadeGroups = new Map<string, any[]>()
  for (const m of matches) {
    const key = m.shadeName || `Slip #${m.slipNo}`
    if (!shadeGroups.has(key)) shadeGroups.set(key, [])
    shadeGroups.get(key)!.push(m)
  }

  // Calculate per-shade stats
  const suggestions = Array.from(shadeGroups.entries()).map(([shadeName, group]) => {
    const avgC = group.reduce((s: number, e: any) => s + e.colorC, 0) / group.length
    const avgM = group.reduce((s: number, e: any) => s + e.colorM, 0) / group.length
    const avgY = group.reduce((s: number, e: any) => s + e.colorY, 0) / group.length
    const avgK = group.reduce((s: number, e: any) => s + e.colorK, 0) / group.length
    const avgDeltaE = group.reduce((s: number, e: any) => s + e.deltaE, 0) / group.length

    // Average cost: sum all chemical costs / count
    const costs = group.map((e: any) =>
      e.chemicals.reduce((s: number, c: any) => s + (c.cost || 0), 0)
    )
    const avgCost = costs.reduce((a: number, b: number) => a + b, 0) / costs.length

    // Get the recipe from the entry with lowest deltaE (best match)
    const bestEntry = group.sort((a: any, b: any) => a.deltaE - b.deltaE)[0]
    const shadeChems = bestEntry.chemicals
      .filter((c: any) => c.processTag === 'shade')
      .map((c: any) => ({
        name: c.name,
        quantity: c.quantity,
        unit: c.unit,
        cost: c.cost,
      }))

    return {
      shadeName,
      avgCMYK: { C: +avgC.toFixed(1), M: +avgM.toFixed(1), Y: +avgY.toFixed(1), K: +avgK.toFixed(1) },
      avgDeltaE: +avgDeltaE.toFixed(1),
      avgCost: Math.round(avgCost),
      timesUsed: group.length,
      recipe: shadeChems,
      bestEntryId: bestEntry.id,
    }
  })

  // Sort by cost (cheapest first)
  suggestions.sort((a, b) => a.avgCost - b.avgCost)

  // Calculate savings vs most expensive
  const maxCost = suggestions.length > 0 ? Math.max(...suggestions.map(s => s.avgCost)) : 0
  const withSavings = suggestions.slice(0, 5).map(s => ({
    ...s,
    savings: maxCost - s.avgCost,
  }))

  const totalConfirmed = entries.length

  return NextResponse.json({
    suggestions: withSavings,
    totalConfirmed,
    lowData: totalConfirmed < 10,
  })
}
