import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export interface MarkaEntry {
  lotNo: string
  than: number | null
}

export interface ExtractedDyeingSlip {
  slipNo: string | null
  date: string | null
  lotNo: string | null
  than: number | null
  marka: MarkaEntry[]
  chemicals: { name: string; quantity: number | null; unit: string }[]
  notes: string | null
  confidence: 'high' | 'medium' | 'low'
}

const SYSTEM_PROMPT = `You are extracting data from a textile dyeing process slip (Indian textile industry).
Carefully read the handwritten or printed slip in the image and extract all information.

Return ONLY a valid JSON object with these exact fields:
{
  "slipNo": "slip number or null",
  "date": "date in DD/MM/YYYY format or null",
  "marka": [
    { "lotNo": "lot number like PS-1325 or AJ-325", "than": numeric than/piece count or null }
  ],
  "chemicals": [
    { "name": "chemical name", "quantity": numeric amount or null, "unit": "kg or gram" }
  ],
  "notes": "any other visible text, colour name, width, or instructions or null",
  "confidence": "high if clearly readable, medium if partially readable, low if mostly unclear"
}

Rules:
- The "marka" field on the slip lists lot numbers with their than (piece) quantities. Extract ALL lot entries from the marka section. Lot numbers follow the pattern: alphabetic prefix + hyphen + number (e.g. PS-1325, AJ-325, BK-42). If there's only one lot, still return it as a single-item array.
- chemicals array must include ALL chemicals listed on the slip
- For chemical quantity: extract the raw numeric value exactly as written on the slip. If the value is greater than 10, the unit is "gram". If 10 or less, the unit is "kg". If the unit is clearly written on the slip, use that instead.
- If a field is not visible or unclear, use null
- For lot numbers, preserve the exact format shown. If no hyphen, insert one between letters and digits (e.g. PS1325 → PS-1325)
- For date, convert to DD/MM/YYYY format
- Return ONLY the JSON object, no explanation`

function parseJSON(text: string): ExtractedDyeingSlip {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('No JSON found in response')
  const raw = JSON.parse(match[0])

  // Normalize marka: if old format (single lotNo/than), convert to marka array
  if (!raw.marka && raw.lotNo) {
    raw.marka = [{ lotNo: raw.lotNo, than: raw.than ?? null }]
  }
  raw.marka = (raw.marka || []).map((m: any) => ({
    lotNo: formatLot(m.lotNo || ''),
    than: m.than ?? null,
  }))

  // Set top-level lotNo/than from first marka entry for backward compat
  if (raw.marka.length > 0) {
    raw.lotNo = raw.marka[0].lotNo
    raw.than = raw.marka[0].than
  }

  // Post-process chemicals: convert everything to kg
  // Rule: qty ≤ 10 = already in kg, qty > 10 = in grams → convert to kg
  if (raw.chemicals) {
    raw.chemicals = raw.chemicals.map((c: any) => {
      let qty = c.quantity
      let unit = c.unit || 'kg'
      const unitLower = unit.toLowerCase()

      if (qty != null && qty > 10) {
        // Large value = grams → convert to kg
        qty = parseFloat((qty / 1000).toFixed(4))
        unit = 'kg'
      } else if (unitLower === 'gram' || unitLower === 'g') {
        // AI said gram but qty ≤ 10 → it's actually kg (e.g. 1, 1.5, 2, 3)
        unit = 'kg'
      }

      // If unit is ml, convert to liter
      if (unitLower === 'ml') {
        if (qty != null && qty > 10) qty = parseFloat((qty / 1000).toFixed(4))
        unit = 'liter'
      }
      return { ...c, quantity: qty, unit }
    })
  }

  return raw
}

function formatLot(raw: string): string {
  let val = raw.toUpperCase().replace(/\s/g, '')
  val = val.replace(/^([A-Z]+)(\d+)$/, '$1-$2')
  return val
}

async function extractWithOpenAI(imageBase64: string, mediaType: string, voiceNote: string | null) {
  const { default: OpenAI } = await import('openai')
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  const userContent: any[] = [
    {
      type: 'image_url',
      image_url: { url: `data:${mediaType};base64,${imageBase64}`, detail: 'high' },
    },
    {
      type: 'text',
      text: voiceNote
        ? `Extract all data from this dyeing slip.\n\nUser voice note for context: "${voiceNote}"`
        : 'Extract all data from this dyeing slip.',
    },
  ]

  const response = await client.chat.completions.create({
    model: 'gpt-4.1-mini',
    max_tokens: 1024,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
  })

  return response.choices[0]?.message?.content ?? ''
}

async function extractWithClaude(imageBase64: string, mediaType: string, voiceNote: string | null) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const prompt = voiceNote
    ? `Extract all data from this dyeing slip.\n\nUser voice note for context: "${voiceNote}"\n\n${SYSTEM_PROMPT}`
    : SYSTEM_PROMPT

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
              data: imageBase64,
            },
          },
          { type: 'text', text: prompt },
        ],
      },
    ],
  })

  return response.content.find(b => b.type === 'text')?.text ?? ''
}

// POST — extract dyeing slip data from image
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { imageBase64, mediaType, voiceNote } = await req.json()
  if (!imageBase64) return NextResponse.json({ error: 'Image required' }, { status: 400 })

  const type = mediaType || 'image/jpeg'

  // Auto-select provider: prefer OpenAI if key is set, else Anthropic
  const useOpenAI = !!process.env.OPENAI_API_KEY
  const useClaude = !!process.env.ANTHROPIC_API_KEY

  if (!useOpenAI && !useClaude) {
    return NextResponse.json(
      { error: 'No AI API key configured. Add OPENAI_API_KEY or ANTHROPIC_API_KEY in environment variables.' },
      { status: 500 }
    )
  }

  try {
    const text = useOpenAI
      ? await extractWithOpenAI(imageBase64, type, voiceNote)
      : await extractWithClaude(imageBase64, type, voiceNote)

    const extracted = parseJSON(text)

    // ── Apply learned aliases: replace OCR names with known master chemicals ──
    // Save original OCR names before alias replacement (for learning on save)
    const ocrNames = extracted.chemicals?.map(c => c.name) ?? []

    if (extracted.chemicals?.length) {
      const normNames = extracted.chemicals.map(c => c.name.toLowerCase().trim().replace(/\s+/g, ' ')).filter(Boolean)
      if (normNames.length) {
        try {
          const db = prisma as any
          const aliases: any[] = await db.chemicalAlias.findMany({
            where: { ocrName: { in: normNames } },
            include: { chemical: true },
          })
          const aliasMap = new Map<string, any>(aliases.map((a: any) => [a.ocrName, a.chemical]))

          extracted.chemicals = extracted.chemicals.map(c => {
            const norm = c.name.toLowerCase().trim().replace(/\s+/g, ' ')
            const master = aliasMap.get(norm)
            if (master) {
              return { ...c, name: master.name, _matchedId: master.id, _matchedRate: master.currentPrice }
            }
            return c
          }) as any
        } catch {
          // ChemicalAlias table may not exist yet — skip alias lookup
        }
      }
    }

    return NextResponse.json({ ...extracted, ocrNames, provider: useOpenAI ? 'openai' : 'claude' })
  } catch (err: any) {
    const msg = err?.message ?? 'Extraction failed'
    if (msg.includes('API key')) return NextResponse.json({ error: 'Invalid API key' }, { status: 500 })
    if (msg.includes('rate')) return NextResponse.json({ error: 'Rate limit — try again shortly' }, { status: 429 })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
