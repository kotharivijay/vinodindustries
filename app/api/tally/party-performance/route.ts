export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { viPrisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const name = req.nextUrl.searchParams.get('name') || ''
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const db = viPrisma as any

  try {
    // 1. Sales metrics
    const salesAgg = await db.tallySales.aggregate({
      where: { partyName: { equals: name, mode: 'insensitive' } },
      _sum: { amount: true },
      _count: true,
    })
    const salesTotalAmount = salesAgg._sum.amount || 0
    const salesCount = salesAgg._count || 0
    const avgBillValue = salesCount > 0 ? salesTotalAmount / salesCount : 0

    // 2. Outstanding metrics
    const outstandingBills = await db.tallyOutstanding.findMany({
      where: { partyName: { equals: name, mode: 'insensitive' } },
      select: { type: true, closingBalance: true, overdueDays: true, billDate: true, dueDate: true },
    })

    let outstandingTotal = 0
    let overdueAmount = 0
    const aging = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 }

    for (const b of outstandingBills) {
      outstandingTotal += b.closingBalance
      if (b.overdueDays > 0) overdueAmount += b.closingBalance
      if (b.overdueDays <= 30) aging['0-30'] += b.closingBalance
      else if (b.overdueDays <= 60) aging['31-60'] += b.closingBalance
      else if (b.overdueDays <= 90) aging['61-90'] += b.closingBalance
      else aging['90+'] += b.closingBalance
    }

    // 3. Monthly sales breakdown
    const allSales = await db.tallySales.findMany({
      where: { partyName: { equals: name, mode: 'insensitive' } },
      select: { date: true, amount: true },
    })
    const monthMap = new Map<string, number>()
    for (const s of allSales) {
      if (!s.date) continue
      const d = new Date(s.date)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      monthMap.set(key, (monthMap.get(key) || 0) + (s.amount || 0))
    }
    const monthlySales = Array.from(monthMap.entries())
      .map(([month, amount]) => ({ month, amount }))
      .sort((a, b) => a.month.localeCompare(b.month))

    // 4. Top items
    const itemsRaw = await db.tallySales.groupBy({
      by: ['itemName'],
      where: { partyName: { equals: name, mode: 'insensitive' }, itemName: { not: null } },
      _sum: { amount: true },
      _count: true,
      orderBy: { _sum: { amount: 'desc' } },
      take: 10,
    })
    const topItems = itemsRaw.map((i: any) => ({
      name: i.itemName,
      totalAmount: i._sum.amount || 0,
      count: i._count || 0,
    }))

    // 5. Receipt history (if TallyReceipt exists)
    let receipts: any[] = []
    try {
      receipts = await db.tallyReceipt.findMany({
        where: { partyName: { equals: name, mode: 'insensitive' } },
        orderBy: { date: 'desc' },
        take: 50,
        select: { date: true, vchNumber: true, amount: true, vchType: true, narration: true, firmCode: true },
      })
    } catch {
      // Table may not exist yet
    }

    // 6. Score calculation (0-100)
    // Factors: payment speed (30%), overdue % (30%), sales volume (20%), consistency (20%)
    const overduePercent = outstandingTotal > 0 ? overdueAmount / outstandingTotal : 0
    const overdueScore = Math.max(0, 30 - (overduePercent * 30))

    // Payment speed: receipt count vs sales count
    const receiptCount = receipts.length
    const paymentSpeedRatio = salesCount > 0 ? Math.min(receiptCount / salesCount, 1) : 0.5
    const paymentScore = paymentSpeedRatio * 30

    // Sales volume: relative scoring (up to 20 points based on total)
    const volumeScore = Math.min(20, (salesTotalAmount / 100000) * 2)

    // Consistency: how many months have sales (out of last 12)
    const monthsWithSales = monthlySales.length
    const consistencyScore = Math.min(20, (monthsWithSales / 12) * 20)

    const score = Math.round(overdueScore + paymentScore + volumeScore + consistencyScore)

    return NextResponse.json({
      salesTotalAmount,
      salesCount,
      avgBillValue,
      outstandingTotal,
      overdueAmount,
      aging,
      monthlySales,
      topItems,
      receipts,
      score,
      scoreBreakdown: {
        overdueScore: Math.round(overdueScore),
        paymentScore: Math.round(paymentScore),
        volumeScore: Math.round(volumeScore),
        consistencyScore: Math.round(consistencyScore),
      },
    })
  } catch (e: any) {
    console.error('Party performance error:', e.message)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
