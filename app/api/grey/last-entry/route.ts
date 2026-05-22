export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

/**
 * Most recently created grey-inward entry. Used by /grey/new to
 * pre-fill the form with the previous row's values so the operator
 * only changes what differs (typical daily batch case: same date,
 * party, transport, etc., changing only challan no / than / lot).
 *
 * Returns the bare fields needed to seed the form. Synthetic
 * carry-forward / re-pro rows (id < 0) are excluded so the form
 * doesn't get seeded with placeholder values.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const last = await prisma.greyEntry.findFirst({
    where: { id: { gt: 0 } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, date: true, challanNo: true,
      partyId: true, qualityId: true, weight: true, than: true, grayMtr: true,
      transportId: true, transportLrNo: true,
      bale: true, baleNo: true, echBaleThan: true,
      weaverId: true, viverNameBill: true,
      lrNo: true, lotNo: true, marka: true,
    },
  })
  return NextResponse.json({ last })
}
