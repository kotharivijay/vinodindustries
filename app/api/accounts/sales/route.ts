export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// GET /api/accounts/sales?fy=26-27
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const fy = req.nextUrl.searchParams.get('fy') || ''
  const db = prisma as any

  const where: any = {}
  if (fy) where.fy = fy

  const [invoices, fyTotals, categories] = await Promise.all([
    db.ksiSalesInvoice.findMany({
      where,
      include: {
        lines: { orderBy: { lineNo: 'asc' } },
        ledgers: true,
      },
      orderBy: [{ date: 'desc' }, { vchNumber: 'desc' }],
    }),
    db.ksiSalesInvoice.groupBy({
      by: ['fy'],
      _count: { _all: true },
      _sum: { totalAmount: true },
      orderBy: { fy: 'desc' },
    }),
    db.ksiSalesLedgerCategory.findMany(),
  ])

  // Build {ledgerName(lower) → category} map for quick lookup at the client.
  const catMap = new Map<string, string>()
  for (const c of categories) catMap.set(c.ledgerName.toLowerCase(), c.category)

  return NextResponse.json({
    invoices,
    fyTotals: fyTotals.map((g: any) => ({ fy: g.fy, count: g._count._all, total: g._sum.totalAmount ?? 0 })),
    categories,
    categoryMap: Object.fromEntries(catMap),
  })
}
