export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export const maxDuration = 60

const OCR_PROMPT = `You are reading a photo/image of a dyeing fold register. Extract ALL fold programs visible.

HOW TO READ THE REGISTER:
1. Each fold block starts with colored header "Dyeing Fold  Date:-[date]" and "Fold No Party [number]"
2. Next line: [Party name] and [Quality name]
3. Below that: lot numbers shown horizontally like "12810/22  12820/40" — these mean lot PS-12810 (total 22 than), PS-12820 (total 40 than)
4. Next row shows full lot numbers: PS-12810  PS-12820  PS-12840  Total
5. Column headers: Sn | Date | Slip No | Shade No | Shade Name | [lot1 col] | [lot2 col] | ... | Total
6. Data rows: each SN (1,2,3,4,5...) = one batch. Read the than value under EACH lot column for that row.
7. Some batches may have no date or slip no (empty) — still include them if they have lot values.
8. Colored total row at bottom = SKIP (summary, not a batch)

LOT NUMBER RULES:
- The lot prefix comes from existing lots in that row header. E.g., if header says "PS-12810 PS-12820", prefix is "PS-"
- If header shows "13050/16  13060/16" and party is "Rathi textile mills" with lots starting "AJ-", then lots are AJ-13050, AJ-13060
- The number after "/" is the total than for that lot column (NOT per batch)

OUTPUT FORMAT (one fold per block, blank line between folds):

Fold [number] | [Party Name] | [Quality] | [Shade No or empty] | [Shade Name]
[DD/MM/YYYY or empty] | [Lot1]=[than1], [Lot2]=[than2]
[DD/MM/YYYY or empty] | [Lot1]=[than1]

CRITICAL RULES:
- SN = batch number. Include ALL SN rows (even if date/slip is empty)
- IGNORE "Slip No" column completely — do NOT output it
- Read INDIVIDUAL than value under each lot column for each batch row
- Only include lots with non-zero/non-empty value in that row
- Date: DD/MM/YYYY format. If empty, leave empty before the |
- Shade Name: read from the "Shade Name" column for each row. If same for all rows, use from first row.
- Skip colored total/summary rows
- The "Total" column at the right = IGNORE (it's auto-calculated)
- Return ONLY the structured text, NO explanation, NO markdown

EXAMPLE OUTPUT:
Fold 8 | Rathi textile mills | PC Butta 48" | AJ/PC/10 | Gold
04/04/2026 | AJ-13400=16
04/04/2026 | AJ-13400=16
04/04/2026 | AJ-13400=16

Fold 10 | Prakash Shirting | Magic 38" | | super white
04/04/2026 | PS-12810=16
04/04/2026 | PS-12810=6, PS-12820=10
04/05/2026 | PS-12820=16
06/04/2026 | PS-12820=14, PS-12840=2
 | PS-12840=16

Fold 11 | Rathi textile mills | Poly Jacquard 46" | | Gold
04/04/2026 | AJ-13050=16
05/04/2026 | AJ-13060=16
05/04/2026 | AJ-13070=16
05/04/2026 | AJ-13080=16
05/04/2026 | AJ-13050=16`

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body — image may be too large' }, { status: 400 })
  }
  const { imageBase64 } = body
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
