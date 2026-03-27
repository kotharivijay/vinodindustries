import { NextRequest, NextResponse } from 'next/server'
import { viPrisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const FIRM = 'KSI'

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
      where: { firmCode: FIRM },
      _sum: { closingBalance: true },
    })
    let totalReceivable = 0
    let totalPayable = 0
    for (const t of outstandingTotals) {
      if (t.type === 'receivable') totalReceivable = t._sum.closingBalance || 0
      if (t.type === 'payable') totalPayable = t._sum.closingBalance || 0
    }

    // 2. Cash & Bank balance (sum closing balances of Bank/Cash ledgers)
    const cashBankLedgers = await db.tallyLedger.findMany({
      where: {
        firmCode: FIRM,
        OR: [
          { parent: { contains: 'Bank', mode: 'insensitive' } },
          { parent: { contains: 'Cash', mode: 'insensitive' } },
        ],
      },
      select: { name: true, parent: true, closingBalance: true },
      orderBy: { closingBalance: 'desc' },
    })
    const cashBankBalance = cashBankLedgers.reduce(
      (sum: number, l: any) => sum + (l.closingBalance || 0),
      0
    )

    // 3. Transaction totals grouped by vchType (for date range)
    const salesWhere: any = { firmCode: FIRM }
    if (dateFrom || dateTo) {
      salesWhere.date = {}
      if (dateFrom) salesWhere.date.gte = new Date(dateFrom)
      if (dateTo) salesWhere.date.lte = new Date(dateTo + 'T23:59:59.999Z')
    }

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

    // 4. Recent 10 transactions
    const recentTx = await db.tallySales.findMany({
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
      },
    })

    // 5. Outstanding count per party (top 5 overdue)
    const topOverdue = await db.tallyOutstanding.findMany({
      where: { firmCode: FIRM, type: 'receivable', overdueDays: { gt: 0 } },
      orderBy: { overdueDays: 'desc' },
      take: 5,
      select: { partyName: true, closingBalance: true, overdueDays: true },
    })

    const response = NextResponse.json({
      totalReceivable,
      totalPayable,
      cashBankBalance,
      cashBankLedgers,
      txSummary,
      recentTx,
      topOverdue,
    })
    // Cache for 2 min, serve stale for 10 min while revalidating in background
    response.headers.set('Cache-Control', 's-maxage=120, stale-while-revalidate=600')
    return response
  } catch (e: any) {
    console.error('KSI dashboard error:', e.message)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
