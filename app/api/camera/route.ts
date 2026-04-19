export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const NVR_BASE = 'https://nvr3.vinodindustries.co.in'
const NVR_USER = 'admin'
const NVR_PASS = 'admin1234'

// GET /api/camera?channel=7 — proxy snapshot from NVR
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return new Response('Unauthorized', { status: 401 })

  const channel = req.nextUrl.searchParams.get('channel') || '7'
  const url = `${NVR_BASE}/cgi-bin/snapshot.cgi?channel=${channel}`

  try {
    // Step 1: Initial request to get WWW-Authenticate header
    const initRes = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (initRes.status !== 401) {
      // If no auth needed, return directly
      const blob = await initRes.arrayBuffer()
      return new Response(blob, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-cache, no-store' } })
    }

    const authHeader = initRes.headers.get('www-authenticate') || ''
    if (!authHeader.toLowerCase().startsWith('digest')) {
      return NextResponse.json({ error: 'NVR auth not digest' }, { status: 502 })
    }

    // Step 2: Parse digest challenge
    const realm = authHeader.match(/realm="([^"]+)"/)?.[1] || ''
    const nonce = authHeader.match(/nonce="([^"]+)"/)?.[1] || ''
    const qop = authHeader.match(/qop="([^"]+)"/)?.[1] || ''
    const opaque = authHeader.match(/opaque="([^"]+)"/)?.[1] || ''

    // Step 3: Compute digest response
    const { createHash } = await import('crypto')
    const md5 = (s: string) => createHash('md5').update(s).digest('hex')

    const ha1 = md5(`${NVR_USER}:${realm}:${NVR_PASS}`)
    const uri = `/cgi-bin/snapshot.cgi?channel=${channel}`
    const ha2 = md5(`GET:${uri}`)
    const nc = '00000001'
    const cnonce = md5(String(Date.now()))

    let response: string
    let authStr: string

    if (qop) {
      response = md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
      authStr = `Digest username="${NVR_USER}", realm="${realm}", nonce="${nonce}", uri="${uri}", qop=${qop}, nc=${nc}, cnonce="${cnonce}", response="${response}"`
    } else {
      response = md5(`${ha1}:${nonce}:${ha2}`)
      authStr = `Digest username="${NVR_USER}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}"`
    }
    if (opaque) authStr += `, opaque="${opaque}"`

    // Step 4: Fetch with digest auth
    const authRes = await fetch(url, {
      headers: { 'Authorization': authStr },
      signal: AbortSignal.timeout(10000),
    })

    if (!authRes.ok) {
      return NextResponse.json({ error: `NVR returned ${authRes.status}` }, { status: 502 })
    }

    const imageData = await authRes.arrayBuffer()
    return new Response(imageData, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to fetch snapshot' }, { status: 502 })
  }
}
