export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// GET /api/accounts/receipts?fy=26-27&direction=in
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const fy = req.nextUrl.searchParams.get('fy') || ''
  const direction = req.nextUrl.searchParams.get('direction') || 'in'
  const showHidden = req.nextUrl.searchParams.get('showHidden') === '1'
  const db = prisma as any

  const where: any = { direction }
  if (fy) where.fy = fy
  if (!showHidden) where.hidden = false

  const rows = await db.ksiHdfcReceipt.findMany({
    where,
    orderBy: [{ date: 'desc' }, { vchNumber: 'desc' }],
    take: 1000,
  })

  // FY totals split by visibility so the tab summary stays meaningful.
  const fyTotals = await db.ksiHdfcReceipt.groupBy({
    by: ['fy'],
    where: { direction, hidden: false },
    _count: { _all: true },
    _sum: { amount: true },
    orderBy: { fy: 'desc' },
  })
  const hiddenCount = await db.ksiHdfcReceipt.count({
    where: { direction, hidden: true, ...(fy ? { fy } : {}) },
  })

  return NextResponse.json({
    rows,
    fyTotals: fyTotals.map((g: any) => ({ fy: g.fy, count: g._count._all, total: g._sum.amount ?? 0 })),
    hiddenCount,
  })
}
