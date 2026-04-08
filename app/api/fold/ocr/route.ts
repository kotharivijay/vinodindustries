import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export const maxDuration = 60

const OCR_PROMPT = `You are reading a photo of a dyeing fold register page. Extract ALL fold programs visible.

Each fold block has:
- "Dyeing Fold" header with Date and "Fold No Party [number]"
- Party name and Quality on the next line
- Lot numbers with their total than in the header row (e.g., "13400/48" means lot AJ-13400, 48 than total)
- Table rows: Sn (serial number = batch count), Date, Slip No (IGNORE this column), Shade No, Shade Name, then than values per lot

Return ONLY valid structured text in this EXACT format (one fold per block, separated by blank lines):

Fold [number] | [Party Name] | [Quality] | [Shade No from first row] | [Shade Name from first row]
[DD/MM/YYYY] | [Lot1]=[than1], [Lot2]=[than2]
[DD/MM/YYYY] | [Lot1]=[than1], [Lot2]=[than2]

Rules:
- Fold number: extract from "Fold No Party [X]" → use X
- SN column = batch count (1,2,3...) — use it to count batches
- IGNORE the Slip No column completely — do NOT include it
- Date format: DD/MM/YYYY
- Lot numbers: extract from header row (e.g., "AJ-13400" from column header)
- Than: the value in each row under that lot column. If empty/0, skip that lot for that row
- Each SN row = one batch
- Skip total/summary rows (no SN number)
- Skip empty rows (rows without SN/date)
- Shade No and Shade Name: from the batch rows. If same across all rows, use it once in header
- If multiple lots in one fold, each batch row should list all lots with their than values for that batch
- Return ONLY the structured text, no explanation

Example output:
Fold 8 | Rathi textile mills | PC Butta 48" | AJ/PC/10 | Gold
04/04/2026 | AJ-13400=16
04/04/2026 | AJ-13400=16
04/04/2026 | AJ-13400=16

Fold 9 | Prakash shirting | Raymond44" | | White
07/04/2026 | PS-12420=15
03/04/2026 | PS-12420=14
07/04/2026 | PS-12420=14`

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
