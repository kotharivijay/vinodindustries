export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

/**
 * Returns the next grey-inward SN: max(GreyEntry.sn) + 1.
 * Negative SNs (carry-forward / opening stock rows) are ignored — only
 * current-year positive serials feed the next-number suggestion.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const row = await prisma.greyEntry.aggregate({
    where: { sn: { gt: 0 } },
    _max: { sn: true },
  })
  const maxSn = row._max.sn ?? 0
  return NextResponse.json({ next: maxSn + 1, lastUsed: maxSn })
}
