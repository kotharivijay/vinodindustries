export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

/**
 * Last-N challan lines for an item.
 *   GET /api/inv/items/:id/recent-rates?n=5             — across all parties
 *   GET /api/inv/items/:id/recent-rates?partyId=&n=3    — restricted to one party
 *
 * Always returns the party name in the row so the UI can render it without an
 * extra fetch.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const partyIdRaw = req.nextUrl.searchParams.get('partyId')
  const partyId = partyIdRaw ? Number(partyIdRaw) : null
  const n = Math.max(1, Math.min(20, Number(req.nextUrl.searchParams.get('n') || 5)))

  const where: any = {
    itemId: Number(params.id),
    rate: { not: null },
  }
  if (partyId) where.challan = { partyId }

  const lines = await db.invChallanLine.findMany({
    where,
    select: {
      rate: true,
      qty: true,
      unit: true,
      challan: {
        select: {
          challanDate: true,
          challanNo: true,
          party: { select: { id: true, displayName: true } },
        },
      },
    },
    orderBy: { challan: { challanDate: 'desc' } },
    take: n,
  })
  return NextResponse.json(lines.map((l: any) => ({
    rate: Number(l.rate),
    qty: Number(l.qty),
    unit: l.unit,
    challanDate: l.challan.challanDate,
    challanNo: l.challan.challanNo,
    partyId: l.challan.party.id,
    partyName: l.challan.party.displayName,
  })))
}
