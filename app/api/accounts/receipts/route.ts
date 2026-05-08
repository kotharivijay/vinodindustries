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

  // Allocation summary per receipt — drives the Linked / Unlinked filter
  // and the diff badge on each card. linkedCash (Σ allocatedAmount) is
  // the only one that reduces receipt remaining; tds + discount are
  // shown alongside but don't affect diff vs receipt amount.
  const receiptIds = rows.map((r: any) => r.id)
  const allocs = receiptIds.length > 0
    ? await db.ksiReceiptAllocation.findMany({
        where: { receiptId: { in: receiptIds } },
        include: { invoice: { select: { vchNumber: true, vchType: true } } },
      })
    : []
  const byReceipt: Record<number, {
    linkedCount: number; linkedCash: number; linkedTds: number; linkedDiscount: number;
    linkedInvoices: { vchType: string; vchNumber: string; allocatedAmount: number; tdsAmount: number; discountAmount: number }[]
  }> = {}
  for (const a of allocs) {
    const acc = byReceipt[a.receiptId] ??= { linkedCount: 0, linkedCash: 0, linkedTds: 0, linkedDiscount: 0, linkedInvoices: [] }
    acc.linkedCount += 1
    acc.linkedCash += a.allocatedAmount
    acc.linkedTds += a.tdsAmount
    acc.linkedDiscount += a.discountAmount
    acc.linkedInvoices.push({
      vchType: a.invoice.vchType, vchNumber: a.invoice.vchNumber,
      allocatedAmount: a.allocatedAmount, tdsAmount: a.tdsAmount, discountAmount: a.discountAmount,
    })
  }
  const enriched = rows.map((r: any) => ({
    ...r,
    ...(byReceipt[r.id] ?? { linkedCount: 0, linkedCash: 0, linkedTds: 0, linkedDiscount: 0, linkedInvoices: [] }),
  }))

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
    rows: enriched,
    fyTotals: fyTotals.map((g: any) => ({ fy: g.fy, count: g._count._all, total: g._sum.amount ?? 0 })),
    hiddenCount,
  })
}
