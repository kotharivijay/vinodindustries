import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export interface ExtractedDyeingSlip {
  slipNo: string | null
  date: string | null
  lotNo: string | null
  than: number | null
  chemicals: { name: string; quantity: number | null; unit: string }[]
  notes: string | null
  confidence: 'high' | 'medium' | 'low'
}

// POST — extract dyeing slip data from image using Claude vision
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  }

  const { imageBase64, mediaType, voiceNote } = await req.json()
  if (!imageBase64) return NextResponse.json({ error: 'Image required' }, { status: 400 })

  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  const type = mediaType || 'image/jpeg'
  if (!allowedTypes.includes(type)) {
    return NextResponse.json({ error: 'Unsupported image type' }, { status: 400 })
  }

  const voiceContext = voiceNote
    ? `\n\nThe user also provided this voice note to help clarify the slip:\n"${voiceNote}"`
    : ''

  const prompt = `You are extracting data from a textile dyeing process slip.
Carefully read the handwritten or printed slip in this image and extract all information.${voiceContext}

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

  try {
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
                media_type: type as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
                data: imageBase64,
              },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
    })

    const text = response.content.find(b => b.type === 'text')?.text ?? ''

    // Parse JSON from Claude's response
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Could not parse response from Claude', raw: text }, { status: 422 })
    }

    const extracted: ExtractedDyeingSlip = JSON.parse(jsonMatch[0])
    return NextResponse.json(extracted)
  } catch (err: any) {
    if (err instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: 'Invalid Anthropic API key' }, { status: 500 })
    }
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: 'Rate limit — please try again shortly' }, { status: 429 })
    }
    return NextResponse.json({ error: err.message ?? 'Extraction failed' }, { status: 500 })
  }
}
