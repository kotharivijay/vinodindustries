export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createHash } from 'crypto'

const NVR_BASE = 'https://nvr3.vinodindustries.co.in'
const NVR_USER = 'admin'
const NVR_PASS = 'admin1234'
// Camera noise level dropped after the recent firmware/lens cleanup, so we
// can use a much tighter threshold without false-positive flapping.
//   movement < 5%  → stopped
//   movement > 5%  → running
const MOVEMENT_THRESHOLD_RUNNING = 5

async function fetchSnapshot(channel: number): Promise<Buffer | null> {
  const url = `${NVR_BASE}/cgi-bin/snapshot.cgi?channel=${channel}`
  try {
    const initRes = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (initRes.status !== 401) return null

    const authHeader = initRes.headers.get('www-authenticate') || ''
    const realm = authHeader.match(/realm="([^"]+)"/)?.[1] || ''
    const nonce = authHeader.match(/nonce="([^"]+)"/)?.[1] || ''
    const qop = authHeader.match(/qop="([^"]+)"/)?.[1] || ''
    const opaque = authHeader.match(/opaque="([^"]+)"/)?.[1] || ''

    const md5 = (s: string) => createHash('md5').update(s).digest('hex')
    const ha1 = md5(`${NVR_USER}:${realm}:${NVR_PASS}`)
    const uri = `/cgi-bin/snapshot.cgi?channel=${channel}`
    const ha2 = md5(`GET:${uri}`)
    const nc = '00000001'
    const cnonce = md5(String(Date.now()))

    let response: string, authStr: string
    if (qop) {
      response = md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
      authStr = `Digest username="${NVR_USER}", realm="${realm}", nonce="${nonce}", uri="${uri}", qop=${qop}, nc=${nc}, cnonce="${cnonce}", response="${response}"`
    } else {
      response = md5(`${ha1}:${nonce}:${ha2}`)
      authStr = `Digest username="${NVR_USER}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}"`
    }
    if (opaque) authStr += `, opaque="${opaque}"`

    const authRes = await fetch(url, {
      headers: { 'Authorization': authStr },
      signal: AbortSignal.timeout(10000),
    })
    if (!authRes.ok) return null
    return Buffer.from(await authRes.arrayBuffer())
  } catch {
    return null
  }
}

function compareBuffers(buf1: Buffer, buf2: Buffer): number {
  const len = Math.min(buf1.length, buf2.length)
  let diffCount = 0
  const sampleStep = 10
  for (let i = 0; i < len; i += sampleStep) {
    if (Math.abs(buf1[i] - buf2[i]) > 10) diffCount++
  }
  return (diffCount / (len / sampleStep)) * 100
}

// POST /api/camera/check — called by cron or factory PC script
export async function POST(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key')
  if (apiKey && apiKey !== process.env.PRINT_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const channel = body.channel || 7
  const name = body.name || 'Farmatex Machine'

  const db = prisma as any

  // Take two snapshots 3 seconds apart
  const snap1 = await fetchSnapshot(channel)
  if (!snap1) return NextResponse.json({ error: 'Failed to fetch snapshot 1' }, { status: 502 })

  await new Promise(r => setTimeout(r, 3000))

  const snap2 = await fetchSnapshot(channel)
  if (!snap2) return NextResponse.json({ error: 'Failed to fetch snapshot 2' }, { status: 502 })

  // Compare
  const movement = Math.round(compareBuffers(snap1, snap2) * 10) / 10
  const newStatus = movement > MOVEMENT_THRESHOLD_RUNNING ? 'running' : 'stopped'

  // Get current status from DB
  let currentStatus = await db.machineStatus.findUnique({ where: { channel } })
  const oldStatus = currentStatus?.status || 'unknown'

  // Upsert machine status
  currentStatus = await db.machineStatus.upsert({
    where: { channel },
    create: { channel, name, status: newStatus, movement },
    update: { status: newStatus, movement, name },
  })

  // Log event if status changed (running <-> stopped)
  const wasRunning = oldStatus === 'running'
  const isRunning = newStatus === 'running'

  if (wasRunning !== isRunning && oldStatus !== 'unknown') {
    // Find last opposite event to calculate duration
    const lastEvent = await db.machineActivityLog.findFirst({
      where: { channel },
      orderBy: { timestamp: 'desc' },
    })
    const duration = lastEvent ? Math.round((Date.now() - new Date(lastEvent.timestamp).getTime()) / 1000) : null

    await db.machineActivityLog.create({
      data: {
        channel,
        event: isRunning ? 'started' : 'stopped',
        duration,
        movement,
      },
    })
  }

  return NextResponse.json({
    channel,
    status: newStatus,
    movement,
    previousStatus: oldStatus,
    changed: wasRunning !== isRunning && oldStatus !== 'unknown',
  })
}
