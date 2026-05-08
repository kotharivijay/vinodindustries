export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// POST /api/accounts/receipts/bulk-hide
// Body: { ids: number[], hidden: boolean, reason?: string }
//
// Marks the rows as not-related-to-sales (hidden=true) or restores them
// (hidden=false). Survives re-syncs because the sync route only touches
// the sync-derived fields on upsert.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { ids, hidden, reason } = await req.json().catch(() => ({}))
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'ids[] required' }, { status: 400 })
  }
  const db = prisma as any
  const result = await db.ksiHdfcReceipt.updateMany({
    where: { id: { in: ids.map((n: any) => Number(n)).filter(Number.isFinite) } },
    data: hidden
      ? { hidden: true, hiddenReason: reason ?? null, hiddenAt: new Date() }
      : { hidden: false, hiddenReason: null, hiddenAt: null },
  })
  return NextResponse.json({ updated: result.count })
}
