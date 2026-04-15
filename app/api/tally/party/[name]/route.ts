export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { viPrisma } from '@/lib/prisma'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name } = await params
  const partyName = decodeURIComponent(name)
  const db = viPrisma as any

  // 1. Ledger info from DB
  let ledgerInfo: any[] = []
  try {
    ledgerInfo = await db.tallyLedger.findMany({
      where: { name: { equals: partyName, mode: 'insensitive' } },
      select: {
        id: true, firmCode: true, name: true, parent: true,
        address: true, gstNo: true, panNo: true, mobileNos: true, state: true,
      },
    })
  } catch {}

  // 2. Outstanding from DB (TallyOutstanding)
  let outstandingBills: any[] = []
  let totalReceivable = 0, totalPayable = 0
  try {
    outstandingBills = await db.tallyOutstanding.findMany({
      where: { partyName: { equals: partyName, mode: 'insensitive' } },
      orderBy: { overdueDays: 'desc' },
    })
    for (const b of outstandingBills) {
      if (b.type === 'receivable') totalReceivable += b.closingBalance
      else totalPayable += b.closingBalance
    }
  } catch {}

  // 3. Sales from DB (TallySales)
  let recentSales: any[] = []
  let salesSummary: any = { totalAmount: 0, totalVouchers: 0, items: [], monthly: [] }
  try {
    // Recent 100 sales
    recentSales = await db.tallySales.findMany({
      where: { partyName: { equals: partyName, mode: 'insensitive' } },
      orderBy: { date: 'desc' },
      take: 100,
    })

    // Total amount + count
    const agg = await db.tallySales.aggregate({
      where: { partyName: { equals: partyName, mode: 'insensitive' } },
      _sum: { amount: true },
      _count: true,
    })
    salesSummary.totalAmount = agg._sum.amount || 0
    salesSummary.totalVouchers = agg._count || 0

    // Unique items
    const items = await db.tallySales.findMany({
      where: { partyName: { equals: partyName, mode: 'insensitive' }, itemName: { not: null } },
      select: { itemName: true },
      distinct: ['itemName'],
    })
    salesSummary.items = items.map((i: any) => i.itemName).filter(Boolean)

    // Monthly summary
    const allSales = await db.tallySales.findMany({
      where: { partyName: { equals: partyName, mode: 'insensitive' } },
      select: { date: true, amount: true },
    })
    const monthMap = new Map<string, number>()
    for (const s of allSales) {
      if (!s.date) continue
      const d = new Date(s.date)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      monthMap.set(key, (monthMap.get(key) || 0) + (s.amount || 0))
    }
    salesSummary.monthly = Array.from(monthMap.entries())
      .map(([month, amount]) => ({ month, amount }))
      .sort((a, b) => a.month.localeCompare(b.month))
  } catch {}

  // 4. Firm-wise outstanding summary
  const outstandingByFirm: { firmCode: string; receivable: number; payable: number; billCount: number }[] = []
  const firmMap = new Map<string, { receivable: number; payable: number; billCount: number }>()
  for (const b of outstandingBills) {
    let f = firmMap.get(b.firmCode)
    if (!f) { f = { receivable: 0, payable: 0, billCount: 0 }; firmMap.set(b.firmCode, f) }
    if (b.type === 'receivable') f.receivable += b.closingBalance
    else f.payable += b.closingBalance
    f.billCount++
  }
  for (const [firmCode, data] of firmMap) {
    outstandingByFirm.push({ firmCode, ...data })
  }

  return NextResponse.json({
    partyName,
    ledgerInfo,
    outstanding: {
      bills: outstandingBills,
      totalReceivable,
      totalPayable,
      byFirm: outstandingByFirm,
    },
    sales: {
      recent: recentSales,
      summary: salesSummary,
    },
  })
}
