import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export const maxDuration = 60

const OCR_PROMPT = `You are reading a photo of a dyeing fold register page. Extract ALL fold programs visible.

IMPORTANT STRUCTURE:
- Each fold block starts with "Dyeing Fold" header with Date and "Fold No Party [number]"
- Next line: Party name and Quality
- Header row shows lot numbers with total capacity: e.g. "12810/22  12820/40" means lot PS-12810 (22 total), PS-12820 (40 total)
- The lot prefix comes from the party lot pattern (PS-, AJ-, etc.)
- Data rows have: Sn, Date, Slip No (IGNORE), Shade No, Shade Name, then INDIVIDUAL than values under each lot column
- CRITICAL: Read the than value under EACH lot column separately for each batch row. Do NOT use the total.

Return ONLY valid structured text in this EXACT format (one fold per block, separated by blank lines):

Fold [number] | [Party Name] | [Quality] | [Shade No] | [Shade Name]
[DD/MM/YYYY] | [Lot1]=[than1], [Lot2]=[than2]
[DD/MM/YYYY] | [Lot1]=[than1], [Lot2]=[than2]

Rules:
- Fold number: extract from "Fold No Party [X]" → use X
- SN column = batch count — use to identify each batch row
- IGNORE the Slip No column — do NOT include it
- Date format: DD/MM/YYYY
- Lot numbers: read from header row. Format like "12810/22" means lot number includes prefix from party rows (e.g., PS-12810). The "/22" is total than for that lot across all batches.
- CRITICAL: For each batch row, read the INDIVIDUAL than value under each lot's column. Only include lots that have a non-zero value in that row.
- Example: if row has 6 under PS-12810 and 10 under PS-12820, output: PS-12810=6, PS-12820=10
- Skip lots with 0 or empty value in that row
- Skip total/summary rows (colored rows without SN)
- Skip rows without SN or date
- Shade No and Shade Name: from the batch data rows
- The batch total than = sum of all lot values in that row (do NOT output this, it's auto-calculated)
- Return ONLY the structured text, no explanation

Example for multi-lot fold:
Fold 10 | Prakash Shirting | Magic 38" | | super white
04/04/2026 | PS-12810=16
04/04/2026 | PS-12810=6, PS-12820=10
04/05/2026 | PS-12820=16
06/04/2026 | PS-12820=14, PS-12840=2
| PS-12840=16
| PS-12820=0

Example for single-lot fold:
Fold 8 | Rathi textile mills | PC Butta 48" | AJ/PC/10 | Gold
04/04/2026 | AJ-13400=16
04/04/2026 | AJ-13400=16
04/04/2026 | AJ-13400=16`

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { imageBase64 } = await req.json()
  if (!imageBase64) return NextResponse.json({ error: 'No image provided' }, { status: 400 })

  // Try Gemini first (free), fallback to OpenAI
  const geminiKey = process.env.GEMINI_API_KEY
  const openaiKey = process.env.OPENAI_API_KEY

  let extractedText = ''

  if (geminiKey) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              role: 'user',
              parts: [
                { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } },
                { text: OCR_PROMPT },
              ],
            }],
          }),
        }
      )
      if (res.ok) {
        const data = await res.json()
        extractedText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
      }
    } catch {}
  }

  if (!extractedText && openaiKey) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          max_tokens: 4096,
          messages: [{
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: 'high' } },
              { type: 'text', text: OCR_PROMPT },
            ],
          }],
        }),
      })
      if (res.ok) {
        const data = await res.json()
        extractedText = data.choices?.[0]?.message?.content ?? ''
      }
    } catch {}
  }

  if (!extractedText) {
    return NextResponse.json({ error: 'OCR failed — no API key or both APIs failed' }, { status: 500 })
  }

  // Clean up: remove markdown code fences if present
  extractedText = extractedText.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim()

  return NextResponse.json({ text: extractedText })
}
