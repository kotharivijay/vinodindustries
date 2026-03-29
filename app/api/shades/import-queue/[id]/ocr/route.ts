import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import Anthropic from '@anthropic-ai/sdk'

export const maxDuration = 60

const db = prisma as any

// Simple Levenshtein distance for fuzzy matching
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
  return dp[m][n]
}

function findBestChemical(ocrName: string, chemicals: { id: number; name: string }[]): { id: number; name: string } | null {
  if (!ocrName || chemicals.length === 0) return null
  const lower = ocrName.toLowerCase().trim()

  const exact = chemicals.find(c => c.name.toLowerCase() === lower)
  if (exact) return exact

  const contains = chemicals.find(c => c.name.toLowerCase().includes(lower) || lower.includes(c.name.toLowerCase()))
  if (contains) return contains

  let bestDist = Infinity, best: typeof chemicals[0] | null = null
  for (const c of chemicals) {
    const dist = levenshtein(lower, c.name.toLowerCase())
    const maxLen = Math.max(lower.length, c.name.length)
    if (dist < bestDist && dist <= maxLen * 0.4) {
      bestDist = dist
      best = c
    }
  }
  return best
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const itemId = parseInt(id)
  if (!itemId) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

  const userId = session.user?.email ?? ''

  const item = await db.shadeImportQueue.findFirst({
    where: { id: itemId, userId },
  })
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await db.shadeImportQueue.update({
    where: { id: itemId },
    data: { status: 'processing' },
  })

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set')

    const allChemicals = await db.chemical.findMany({
      where: { category: 'color' },
      select: { id: true, name: true },
    })
    const aliases = await db.chemicalAlias.findMany({
      select: { ocrName: true, chemicalId: true },
    })

    const chemicalNames = allChemicals.map((c: any) => c.name)

    const ocrPrompt = `This is a page from a physical shade/dyeing recipe register. Extract ALL shade recipes visible on this page. For each shade recipe return a JSON array with this structure:
{ "shadeNo": string, "description": string, "chemicals": [{ "name": string, "percent": number }] }
Rules:
- shadeNo: the shade code/number written (e.g. APC-1, NB-12, RD-05)
- description: color name or description (e.g. Pista, Navy, Red)
- chemicals: the COLOR chemicals/dyes used in the recipe
- percent: the percentage value (just the number)
- Handwriting may be unclear. Match chemical names to the nearest from this KNOWN list: ${chemicalNames.join(', ')}
- Common OCR misreads: "disp" → "Disp", "msp" → could be "Disp". Always prefer the closest match from the known list above.
Return ONLY a valid JSON array, no explanation.`

    const anthropic = new Anthropic({ apiKey })

    const mediaType = item.mediaType === 'image/png' ? 'image/png'
      : item.mediaType === 'image/webp' ? 'image/webp'
      : item.mediaType === 'image/gif' ? 'image/gif'
      : 'image/jpeg'

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: item.imageBase64 },
            },
            { type: 'text', text: ocrPrompt },
          ],
        },
      ],
    })

    const ocrRaw = response.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('')

    let recipes: any[] = []
    try {
      const cleaned = ocrRaw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
      recipes = JSON.parse(cleaned)
      if (!Array.isArray(recipes)) recipes = [recipes]
    } catch (_) {
      const match = ocrRaw.match(/\[[\s\S]*\]/)
      if (match) {
        try { recipes = JSON.parse(match[0]) } catch (_) { recipes = [] }
      }
    }

    // Post-process: fuzzy match each chemical name to master
    for (const recipe of recipes) {
      if (!recipe.chemicals) continue
      for (const chem of recipe.chemicals) {
        const aliasLower = (chem.name || '').toLowerCase().trim()
        const alias = aliases.find((a: any) => a.ocrName.toLowerCase() === aliasLower)
        if (alias) {
          const matched = allChemicals.find((c: any) => c.id === alias.chemicalId)
          if (matched) { chem.matchedId = matched.id; chem.matchedName = matched.name; continue }
        }
        const best = findBestChemical(chem.name, allChemicals)
        if (best) { chem.matchedId = best.id; chem.matchedName = best.name }
      }
    }

    const updated = await db.shadeImportQueue.update({
      where: { id: itemId },
      data: {
        status: 'reviewing',
        ocrRaw,
        recipes,
      },
    })

    return NextResponse.json(updated)
  } catch (e: any) {
    await db.shadeImportQueue.update({
      where: { id: itemId },
      data: { status: 'pending' },
    })
    return NextResponse.json({ error: e.message ?? 'OCR failed' }, { status: 500 })
  }
}
