export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

/**
 * Suggests the next CHK-#### slip number by finding the highest numeric
 * suffix on existing CheckingSlip.slipNo rows and incrementing by 1.
 * Non-numeric slip numbers (operator overrides) are ignored.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rows = await db.checkingSlip.findMany({ select: { slipNo: true } })
  let max = 0
  for (const r of rows) {
    const m = /(\d+)\s*$/.exec(String(r.slipNo ?? ''))
    if (m) {
      const n = parseInt(m[1], 10)
      if (Number.isFinite(n) && n > max) max = n
    }
  }
  const next = max + 1
  return NextResponse.json({ next: `CHK-${String(next).padStart(4, '0')}` })
}
