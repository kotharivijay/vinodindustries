import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import OpenAI from 'openai'

const db = prisma as any

const OCR_PROMPT = `This is a page from a physical shade/dyeing recipe register. Extract ALL shade recipes visible on this page. For each shade recipe return a JSON array with this structure:
{ "shadeNo": string, "description": string, "chemicals": [{ "name": string, "percent": number }] }
Rules:
- shadeNo: the shade code/number written (e.g. APC-1, NB-12, RD-05)
- description: color name or description
- chemicals: only the COLOR chemicals (dyes), not auxiliaries like salt, acid
- percent: the percentage value (just the number)
Return ONLY a valid JSON array, no explanation.`

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

  // Set status to processing
  await db.shadeImportQueue.update({
    where: { id: itemId },
    data: { status: 'processing' },
  })

  try {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error('OPENAI_API_KEY not set')

    const openai = new OpenAI({ apiKey })

    const dataUrl = `data:${item.mediaType};base64,${item.imageBase64}`

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: dataUrl, detail: 'high' },
            },
            {
              type: 'text',
              text: OCR_PROMPT,
            },
          ],
        },
      ],
    })

    const ocrRaw = response.choices[0]?.message?.content ?? ''

    // Parse JSON from the response
    let recipes: any[] = []
    try {
      // Strip markdown code fences if present
      const cleaned = ocrRaw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
      recipes = JSON.parse(cleaned)
      if (!Array.isArray(recipes)) recipes = [recipes]
    } catch (_) {
      // Try extracting JSON array from text
      const match = ocrRaw.match(/\[[\s\S]*\]/)
      if (match) {
        try { recipes = JSON.parse(match[0]) } catch (_) { recipes = [] }
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
    // Reset to pending on failure
    await db.shadeImportQueue.update({
      where: { id: itemId },
      data: { status: 'pending' },
    })
    return NextResponse.json({ error: e.message ?? 'OCR failed' }, { status: 500 })
  }
}
