export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = prisma as any

  // Get current status
  const machines = await db.machineStatus.findMany({ orderBy: { channel: 'asc' } })

  // Get today's activity log
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const todayLogs = await db.machineActivityLog.findMany({
    where: { timestamp: { gte: today } },
    orderBy: { timestamp: 'asc' },
  })

  // Calculate today's summary per channel
  const summaries: Record<number, { running: number; stopped: number; events: number; logs: any[] }> = {}

  for (const log of todayLogs) {
    if (!summaries[log.channel]) summaries[log.channel] = { running: 0, stopped: 0, events: 0, logs: [] }
    const s = summaries[log.channel]
    s.events++
    s.logs.push({
      event: log.event,
      timestamp: log.timestamp,
      duration: log.duration,
      movement: log.movement,
    })
    if (log.event === 'stopped' && log.duration) s.running += log.duration
    if (log.event === 'started' && log.duration) s.stopped += log.duration
  }

  const result = machines.map((m: any) => {
    const summary = summaries[m.channel] || { running: 0, stopped: 0, events: 0, logs: [] }
    const totalTime = summary.running + summary.stopped
    return {
      channel: m.channel,
      name: m.name,
      status: m.status,
      movement: m.movement,
      updatedAt: m.updatedAt,
      today: {
        runningSeconds: summary.running,
        stoppedSeconds: summary.stopped,
        uptimePercent: totalTime > 0 ? Math.round((summary.running / totalTime) * 100) : 0,
        eventCount: summary.events,
        logs: summary.logs,
      },
    }
  })

  return NextResponse.json(result)
}
