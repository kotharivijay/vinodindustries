export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { partyId, challanNo, date } = await req.json()
  if (!partyId || !challanNo) return NextResponse.json({ duplicate: false })

  const d = date ? new Date(date) : new Date()
  const lo = new Date(d); lo.setDate(lo.getDate() - 3)
  const hi = new Date(d); hi.setDate(hi.getDate() + 3)
  const dup = await db.invChallan.findFirst({
    where: {
      partyId: Number(partyId),
      challanNo: String(challanNo).trim(),
      challanDate: { gte: lo, lte: hi },
    },
    select: { id: true, challanDate: true, internalSeriesNo: true, seriesFy: true, status: true },
  })
  return NextResponse.json({ duplicate: !!dup, dup })
}
