export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

/**
 * Tier A picker source:
 *   GET /api/inv/items/by-party?partyId=&days=90
 *
 * Returns items received from this party in the last `days` days
 * (default 90), ordered by most-recent challan date desc.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const partyId = Number(req.nextUrl.searchParams.get('partyId'))
  const days = Math.max(1, Math.min(365, Number(req.nextUrl.searchParams.get('days') || 90)))
  if (!partyId) return NextResponse.json({ error: 'partyId required' }, { status: 400 })

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  // Most-recent challan line per item for this party
  const lines = await db.invChallanLine.findMany({
    where: {
      challan: { partyId, challanDate: { gte: cutoff } },
    },
    select: {
      itemId: true,
      rate: true,
      challan: { select: { challanDate: true } },
      item: { include: { alias: true } },
    },
    orderBy: { challan: { challanDate: 'desc' } },
    take: 500,
  })

  const seen = new Map<number, any>()
  for (const l of lines) {
    if (seen.has(l.itemId)) continue
    seen.set(l.itemId, {
      ...l.item,
      lastRate: l.rate ? Number(l.rate) : null,
      lastChallanDate: l.challan.challanDate,
    })
  }
  return NextResponse.json(Array.from(seen.values()))
}
