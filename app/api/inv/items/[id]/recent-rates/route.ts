export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

/**
 * Last-N rates per item per party (for the picker's recent-rates chip).
 *   GET /api/inv/items/:id/recent-rates?partyId=&n=3
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const partyId = Number(req.nextUrl.searchParams.get('partyId'))
  const n = Math.max(1, Math.min(20, Number(req.nextUrl.searchParams.get('n') || 3)))
  if (!partyId) return NextResponse.json({ error: 'partyId required' }, { status: 400 })

  const lines = await db.invChallanLine.findMany({
    where: {
      itemId: Number(params.id),
      rate: { not: null },
      challan: { partyId },
    },
    select: {
      rate: true,
      qty: true,
      challan: { select: { challanDate: true, challanNo: true } },
    },
    orderBy: { challan: { challanDate: 'desc' } },
    take: n,
  })
  return NextResponse.json(lines.map((l: any) => ({
    rate: Number(l.rate),
    qty: Number(l.qty),
    challanDate: l.challan.challanDate,
    challanNo: l.challan.challanNo,
  })))
}
