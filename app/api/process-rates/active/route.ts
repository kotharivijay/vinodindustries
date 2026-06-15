export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { lineInclude } from '@/lib/processRates'

// GET /api/process-rates/active?partyId=N
// The active contract (with rate lines) for a party, or { contract: null }
// when the party has no rate card yet — drives the Grey-Inward pill.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const partyId = parseInt(req.nextUrl.searchParams.get('partyId') ?? '')
  if (!partyId) return NextResponse.json({ error: 'partyId required' }, { status: 400 })

  const contract = await (prisma as any).processRateContract.findFirst({
    where: { partyId, status: 'active' },
    include: lineInclude,
  })
  return NextResponse.json({ contract: contract ?? null })
}
