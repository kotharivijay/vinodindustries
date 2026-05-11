export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// POST /api/accounts/receipts/bulk-mark-pushed
// Body: { ids: number[], pushed: boolean }
//
// Stamps (or clears) tallyPushedAt on the given receipts. Use this to
// retro-mark receipts that were already pushed to Tally manually so
// the UI Push button stays guarded.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { ids, pushed } = await req.json().catch(() => ({}))
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'ids[] required' }, { status: 400 })
  }
  const db = prisma as any
  const result = await db.ksiHdfcReceipt.updateMany({
    where: { id: { in: ids.map((n: any) => Number(n)).filter(Number.isFinite) } },
    data: pushed ? { tallyPushedAt: new Date() } : { tallyPushedAt: null },
  })
  return NextResponse.json({ updated: result.count })
}
