export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export const maxDuration = 30

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const GROQ_KEY = process.env.GROQ_API_KEY
  if (!GROQ_KEY) return NextResponse.json({ error: 'GROQ_API_KEY not configured' }, { status: 500 })

  try {
    const formData = await req.formData()
    const audio = formData.get('audio') as File
    if (!audio) return NextResponse.json({ error: 'No audio file' }, { status: 400 })

    // Send to Groq Whisper API
    const groqForm = new FormData()
    groqForm.append('file', audio, 'audio.webm')
    groqForm.append('model', 'whisper-large-v3')
    groqForm.append('language', 'hi') // Hindi primary, auto-detects English too
    groqForm.append('response_format', 'json')

    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROQ_KEY}` },
      body: groqForm,
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('Groq Whisper error:', err)
      return NextResponse.json({ error: 'Whisper transcription failed' }, { status: 500 })
    }

    const data = await res.json()
    return NextResponse.json({ text: data.text || '' })
  } catch (err: any) {
    console.error('Whisper error:', err)
    return NextResponse.json({ error: err.message || 'Failed' }, { status: 500 })
  }
}
