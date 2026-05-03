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

  const partyIdParam = req.nextUrl.searchParams.get('partyId')
  const tallyLedger = req.nextUrl.searchParams.get('tallyLedger')
  const days = Math.max(1, Math.min(365, Number(req.nextUrl.searchParams.get('days') || 90)))

  let partyId: number | null = partyIdParam ? Number(partyIdParam) : null
  if (!partyId && tallyLedger) {
    // Resolve via InvParty.tallyLedger; if no InvParty exists yet (party not
    // used on a challan before), there are no past lines to return.
    const ip = await db.invParty.findUnique({
      where: { tallyLedger: tallyLedger.trim() },
      select: { id: true },
    })
    if (!ip) return NextResponse.json([])
    partyId = ip.id
  }
  if (!partyId) return NextResponse.json({ error: 'partyId or tallyLedger required' }, { status: 400 })

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
