export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { partyId: rawPartyId, tallyLedger, challanNo, date } = await req.json()
  if ((!rawPartyId && !tallyLedger) || !challanNo) return NextResponse.json({ duplicate: false })

  // If only the ledger name is given, look up InvParty without creating one —
  // a missing party can't have duplicates.
  let partyId: number | null = null
  if (rawPartyId) partyId = Number(rawPartyId)
  else if (tallyLedger) {
    const existing = await db.invParty.findUnique({ where: { tallyLedger: String(tallyLedger).trim() } })
    partyId = existing?.id ?? null
  }
  if (partyId == null) return NextResponse.json({ duplicate: false })

  const d = date ? new Date(date) : new Date()
  const lo = new Date(d); lo.setDate(lo.getDate() - 3)
  const hi = new Date(d); hi.setDate(hi.getDate() + 3)
  const dup = await db.invChallan.findFirst({
    where: {
      partyId,
      challanNo: String(challanNo).trim(),
      challanDate: { gte: lo, lte: hi },
    },
    select: { id: true, challanDate: true, internalSeriesNo: true, seriesFy: true, status: true },
  })
  return NextResponse.json({ duplicate: !!dup, dup })
}
