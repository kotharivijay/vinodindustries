export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import OpenAI from 'openai'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { image, mediaType } = await req.json()
  if (!image) return NextResponse.json({ error: 'Image required' }, { status: 400 })

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        {
          role: 'system',
          content: `You extract fold program / dyeing batch data from images of handwritten or printed sheets.

Extract ALL batches with their shade name, lot numbers, and than (quantity) values.

The image shows a fold program sheet with columns like:
- Sn / Batch No (serial number)
- Shade Name (color/shade)
- Multiple Lot Number columns with than values underneath
- Total column

Return ONLY valid JSON in this exact format (no markdown, no explanation):
{
  "batches": [
    {
      "batchNo": 1,
      "shade": "Navy Blue",
      "lots": [
        { "lotNo": "PS-1325", "than": 10 },
        { "lotNo": "AJ-325", "than": 5 }
      ]
    }
  ]
}

Rules:
- CRITICAL: Each Sn/serial number row MUST be its own separate batch entry — even if two rows have the same shade name, they are DIFFERENT batches with different batch numbers
- Do NOT merge or group rows with the same shade into one batch — every row in the sheet = one batch object
- Lot numbers are in format PREFIX-NUMBER (e.g. PS-1325, AJ-325, KT-42)
- Than values are integers (quantity of fabric pieces)
- Skip lots with 0 or empty than
- Shade names should be exact as written
- If a shade cell appears merged/blank for a row, use the same shade name as the row above it
- If you can't read a value clearly, make your best guess
- Return empty batches array if no data found`
        },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:${mediaType};base64,${image}` },
            },
            {
              type: 'text',
              text: 'Extract all batch/shade/lot/than data from this fold program image. Return JSON only.',
            },
          ],
        },
      ],
      max_tokens: 4000,
    })

    const content = response.choices[0]?.message?.content || ''

    // Parse JSON from response (handle markdown code blocks)
    let jsonStr = content.trim()
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    }

    const data = JSON.parse(jsonStr)
    return NextResponse.json(data)
  } catch (e: any) {
    console.error('AI extraction error:', e.message)
    return NextResponse.json({ error: e.message || 'Extraction failed', batches: [] }, { status: 500 })
  }
}
