import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export interface ExtractedDyeingSlip {
  slipNo: string | null
  date: string | null
  lotNo: string | null
  than: number | null
  chemicals: { name: string; quantity: number | null; unit: string }[]
  notes: string | null
  confidence: 'high' | 'medium' | 'low'
}

const SYSTEM_PROMPT = `You are extracting data from a textile dyeing process slip.
Carefully read the handwritten or printed slip in the image and extract all information.

Return ONLY a valid JSON object with these exact fields:
{
  "slipNo": "slip number or null",
  "date": "date in DD/MM/YYYY format or null",
  "lotNo": "lot number (e.g. LOT-123, 45A) or null",
  "than": numeric than/piece count or null,
  "chemicals": [
    { "name": "chemical name", "quantity": numeric amount or null, "unit": "kg/liter/gram/ml or best guess" }
  ],
  "notes": "any other visible text or instructions or null",
  "confidence": "high if clearly readable, medium if partially readable, low if mostly unclear"
}

Rules:
- chemicals array must include ALL chemicals listed on the slip
- If a field is not visible or unclear, use null
- For lot numbers, preserve the exact format shown
- For date, convert to DD/MM/YYYY format
- Return ONLY the JSON object, no explanation`

function parseJSON(text: string): ExtractedDyeingSlip {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('No JSON found in response')
  return JSON.parse(match[0])
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
    model: 'gpt-4o',
    max_tokens: 1024,
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
    return NextResponse.json({ ...extracted, provider: useOpenAI ? 'openai' : 'claude' })
  } catch (err: any) {
    const msg = err?.message ?? 'Extraction failed'
    if (msg.includes('API key')) return NextResponse.json({ error: 'Invalid API key' }, { status: 500 })
    if (msg.includes('rate')) return NextResponse.json({ error: 'Rate limit — try again shortly' }, { status: 429 })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
