export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { viPrisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// GET /api/accounts/outstanding/tally-match
//
// Returns the KSI per-party closing balance computed by summing
// TallyOutstanding bills: receivable adds, payable subtracts. The
// webapp Outstanding page compares its own party net (totalPending −
// onAccount) against this value and rings the matching cards green.
export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = viPrisma as any
  const bills = await db.tallyOutstanding.findMany({
    where: { firmCode: 'KSI' },
    select: { partyName: true, type: true, closingBalance: true, lastSynced: true },
  })

  const byParty: Record<string, number> = {}
  let lastSynced: Date | null = null
  for (const b of bills) {
    const sign = b.type === 'payable' ? -1 : 1
    byParty[b.partyName] = (byParty[b.partyName] || 0) + sign * (b.closingBalance || 0)
    if (b.lastSynced && (!lastSynced || b.lastSynced > lastSynced)) lastSynced = b.lastSynced
  }

  // Round to 2 dp so equality checks on the client are deterministic.
  for (const k of Object.keys(byParty)) byParty[k] = Math.round(byParty[k] * 100) / 100

  return NextResponse.json({
    byParty,
    parties: Object.keys(byParty).length,
    bills: bills.length,
    lastSynced,
  })
}
