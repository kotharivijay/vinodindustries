export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { chemicals } = body // [{ name: string, quantity: number }]

  if (!chemicals?.length) {
    return NextResponse.json({ error: 'At least one chemical required' }, { status: 400 })
  }

  const db = prisma as any

  // Find all confirmed entries with CMYK data
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

  // Input chemical names (normalized)
  const inputNames = chemicals.map((c: any) => c.name.toLowerCase().trim())

  // Score each entry by how similar its chemicals are to the input
  const scored = entries.map((entry: any) => {
    const entryChems = entry.chemicals
      .filter((c: any) => c.processTag === 'shade')
      .map((c: any) => ({
        name: c.name.toLowerCase().trim(),
        quantity: c.quantity || 0,
      }))

    const entryNames = entryChems.map((c: any) => c.name)

    // Count how many input chemicals match
    let matchCount = 0
    let quantitySimilarity = 0

    for (const input of chemicals) {
      const inputName = input.name.toLowerCase().trim()
      const match = entryChems.find((ec: any) => ec.name === inputName)
      if (match) {
        matchCount++
        // Quantity similarity: 1 - |diff|/max(q1,q2)
        const maxQ = Math.max(input.quantity || 0, match.quantity || 0)
        if (maxQ > 0) {
          quantitySimilarity += 1 - Math.abs((input.quantity || 0) - (match.quantity || 0)) / maxQ
        } else {
          quantitySimilarity += 1
        }
      }
    }

    // Penalize entries that have many extra chemicals the input doesn't have
    const extraChems = entryNames.filter((n: string) => !inputNames.includes(n)).length

    // Overall score: match ratio + quantity similarity - extra penalty
    const matchRatio = inputNames.length > 0 ? matchCount / inputNames.length : 0
    const qtyScore = matchCount > 0 ? quantitySimilarity / matchCount : 0
    const extraPenalty = extraChems * 0.1

    const score = matchRatio * 0.6 + qtyScore * 0.4 - extraPenalty * 0.1

    return {
      entry,
      score,
      matchCount,
    }
  })

  // Filter entries with at least 1 matching chemical and positive score
  const relevant = scored
    .filter((s: any) => s.matchCount > 0 && s.score > 0)
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, 20)

  if (relevant.length === 0) {
    return NextResponse.json({
      prediction: null,
      confidence: 0,
      message: 'No similar recipes found. Add more confirmed dyeing slips to improve predictions.',
      matchCount: 0,
    })
  }

  // Weight by score and average the CMYK values
  const totalWeight = relevant.reduce((s: number, r: any) => s + r.score, 0)

  const predictedC = relevant.reduce((s: number, r: any) => s + r.entry.colorC * r.score, 0) / totalWeight
  const predictedM = relevant.reduce((s: number, r: any) => s + r.entry.colorM * r.score, 0) / totalWeight
  const predictedY = relevant.reduce((s: number, r: any) => s + r.entry.colorY * r.score, 0) / totalWeight
  const predictedK = relevant.reduce((s: number, r: any) => s + r.entry.colorK * r.score, 0) / totalWeight

  // Convert predicted CMYK to hex
  const c = predictedC / 100
  const m = predictedM / 100
  const y = predictedY / 100
  const k = predictedK / 100
  const r = Math.round(255 * (1 - c) * (1 - k))
  const g = Math.round(255 * (1 - m) * (1 - k))
  const b = Math.round(255 * (1 - y) * (1 - k))
  const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`

  // Confidence based on number of matches and average score
  const avgScore = totalWeight / relevant.length
  const confidence = Math.min(100, Math.round(
    (Math.min(relevant.length, 10) / 10) * 50 + avgScore * 50
  ))

  // Top matching shades for reference
  const topMatches = relevant.slice(0, 5).map((r: any) => ({
    shadeName: r.entry.shadeName || `Slip #${r.entry.slipNo}`,
    colorC: r.entry.colorC,
    colorM: r.entry.colorM,
    colorY: r.entry.colorY,
    colorK: r.entry.colorK,
    colorHex: r.entry.colorHex,
    score: +r.score.toFixed(2),
  }))

  return NextResponse.json({
    prediction: {
      colorC: +predictedC.toFixed(1),
      colorM: +predictedM.toFixed(1),
      colorY: +predictedY.toFixed(1),
      colorK: +predictedK.toFixed(1),
      colorHex: hex,
    },
    confidence,
    matchCount: relevant.length,
    topMatches,
  })
}
