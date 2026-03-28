import { NextRequest, NextResponse } from 'next/server'
import { viPrisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const VI_FIRMS = ['VI', 'VCF', 'VF']

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const dateFrom = req.nextUrl.searchParams.get('dateFrom') || ''
  const dateTo = req.nextUrl.searchParams.get('dateTo') || ''
  const db = viPrisma as any

  try {
    // 1. Outstanding receivable / payable totals
    const outstandingTotals = await db.tallyOutstanding.groupBy({
      by: ['type'],
      where: { firmCode: { in: VI_FIRMS } },
      _sum: { closingBalance: true },
    })
    let totalReceivable = 0
    let totalPayable = 0
    for (const t of outstandingTotals) {
      if (t.type === 'receivable') totalReceivable = t._sum.closingBalance || 0
      if (t.type === 'payable') totalPayable = t._sum.closingBalance || 0
    }

    // 2. Total sales amount this FY (with date filter)
    const salesWhere: any = { firmCode: { in: VI_FIRMS } }
    if (dateFrom || dateTo) {
      salesWhere.date = {}
      if (dateFrom) salesWhere.date.gte = new Date(dateFrom)
      if (dateTo) salesWhere.date.lte = new Date(dateTo + 'T23:59:59.999Z')
    }

    const salesAgg = await db.tallySales.aggregate({
      where: salesWhere,
      _sum: { amount: true },
      _count: true,
    })
    const totalSalesAmount = salesAgg._sum.amount || 0
    const totalSalesCount = salesAgg._count || 0

    // 3. Total ledgers synced
    const ledgerCount = await db.tallyLedger.count({
      where: { firmCode: { in: VI_FIRMS } },
    })

    // 4. Transaction totals grouped by vchType
    const vchTotals = await db.tallySales.groupBy({
      by: ['vchType'],
      where: salesWhere,
      _sum: { amount: true },
      _count: { id: true },
    })
    const txSummary: Record<string, { amount: number; count: number }> = {}
    for (const v of vchTotals) {
      txSummary[v.vchType || 'Unknown'] = {
        amount: v._sum.amount || 0,
        count: v._count.id || 0,
      }
    }

    // 5. Top 5 overdue receivables
    const topOverdue = await db.tallyOutstanding.findMany({
      where: { firmCode: { in: VI_FIRMS }, type: 'receivable', overdueDays: { gt: 0 } },
      orderBy: { overdueDays: 'desc' },
      take: 5,
      select: { partyName: true, closingBalance: true, overdueDays: true, firmCode: true },
    })

    // 6. Recent 10 sales
    const recentSales = await db.tallySales.findMany({
      where: salesWhere,
      orderBy: { date: 'desc' },
      take: 10,
      select: {
        date: true,
        vchNumber: true,
        partyName: true,
        amount: true,
        vchType: true,
        narration: true,
        firmCode: true,
      },
    })

    // 7. Outstanding by firm
    const outstandingByFirm = await db.tallyOutstanding.groupBy({
      by: ['firmCode', 'type'],
      where: { firmCode: { in: VI_FIRMS } },
      _sum: { closingBalance: true },
      _count: { id: true },
    })
    const firmBreakdown: Record<string, { receivable: number; payable: number; billCount: number }> = {}
    for (const row of outstandingByFirm) {
      if (!firmBreakdown[row.firmCode]) firmBreakdown[row.firmCode] = { receivable: 0, payable: 0, billCount: 0 }
      if (row.type === 'receivable') firmBreakdown[row.firmCode].receivable = row._sum.closingBalance || 0
      else firmBreakdown[row.firmCode].payable = row._sum.closingBalance || 0
      firmBreakdown[row.firmCode].billCount += row._count.id || 0
    }

    const response = NextResponse.json({
      totalReceivable,
      totalPayable,
      totalSalesAmount,
      totalSalesCount,
      ledgerCount,
      txSummary,
      topOverdue,
      recentSales,
      firmBreakdown,
    })
    response.headers.set('Cache-Control', 's-maxage=120, stale-while-revalidate=600')
    return response
  } catch (e: any) {
    console.error('VI dashboard error:', e.message)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
