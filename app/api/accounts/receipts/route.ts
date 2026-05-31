export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// GET /api/accounts/receipts?fy=26-27&direction=in
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Accepts a comma-separated list of FY codes (e.g. "25-26,26-27") so
  // the user can view multiple FYs at once.
  const fyParam = req.nextUrl.searchParams.get('fy') || ''
  const fys = fyParam.split(',').map(s => s.trim()).filter(Boolean)
  const direction = req.nextUrl.searchParams.get('direction') || 'in'
  const showHidden = req.nextUrl.searchParams.get('showHidden') === '1'
  const db = prisma as any

  const where: any = { direction }
  if (fys.length === 1) where.fy = fys[0]
  else if (fys.length > 1) where.fy = { in: fys }
  if (!showHidden) where.hidden = false

  const rows = await db.ksiHdfcReceipt.findMany({
    where,
    orderBy: [{ date: 'desc' }, { vchNumber: 'desc' }],
  })

  // Allocation summary per receipt — drives the Linked / Unlinked filter
  // and the diff badge on each card. linkedCash (Σ allocatedAmount) is
  // the only one that reduces receipt remaining; tds + discount are
  // shown alongside but don't affect diff vs receipt amount.
  const receiptIds = rows.map((r: any) => r.id)
  const allocs = receiptIds.length > 0
    ? await db.ksiReceiptAllocation.findMany({
        where: { receiptId: { in: receiptIds } },
        include: { invoice: { select: { id: true, vchNumber: true, vchType: true, date: true } } },
      })
    : []

  // For each invoice referenced by these allocations, compute its
  // current pending = totalAmount − Σ(cash + tds + disc) across
  // *every* allocation (not just the ones tied to this receipt batch).
  // Used to show "pending ₹X" next to the linked invoice line.
  const invoiceIds = Array.from(new Set(allocs.map((a: any) => a.invoiceId)))
  const pendingByInvoice: Record<number, number> = {}
  // Per-invoice rollups used by the linked-invoice rows on each receipt
  // card. `netAmount` is the user-defined "what we actually netted from
  // this invoice" =
  //   items − voucher discount + extra charges + GST
  //     − settlement TDS − settlement discount
  // which simplifies to: invoice.totalAmount − Σ tds − Σ settlement disc
  // across every allocation on the invoice.
  const invoiceMeta: Record<number, { totalAmount: number; netAmount: number }> = {}
  // For "subsequent receipt" detection — every allocation on the invoice
  // keyed by invoice id, with the receipt date so the linked-invoice
  // builder can compute priorPending = totalAmount − Σ(prior receipts on
  // this invoice).
  const allocsByInvoice: Record<number, { receiptId: number; receiptDate: Date; allocated: number; tds: number; disc: number }[]> = {}
  if (invoiceIds.length > 0) {
    const invs = await db.ksiSalesInvoice.findMany({
      where: { id: { in: invoiceIds } },
      select: {
        id: true, totalAmount: true,
        allocations: {
          select: {
            allocatedAmount: true, tdsAmount: true, discountAmount: true,
            receiptId: true, receipt: { select: { date: true } },
          },
        },
      },
    })
    for (const inv of invs) {
      const consumed = (inv.allocations || []).reduce(
        (s: number, a: any) => s + (a.allocatedAmount || 0) + (a.tdsAmount || 0) + (a.discountAmount || 0),
        0,
      )
      pendingByInvoice[inv.id] = Math.max(0, inv.totalAmount - consumed)
      const totalTds = (inv.allocations || []).reduce((s: number, a: any) => s + (a.tdsAmount || 0), 0)
      const totalDisc = (inv.allocations || []).reduce((s: number, a: any) => s + (a.discountAmount || 0), 0)
      invoiceMeta[inv.id] = {
        totalAmount: inv.totalAmount,
        netAmount: Math.round((inv.totalAmount - totalTds - totalDisc) * 100) / 100,
      }
      allocsByInvoice[inv.id] = (inv.allocations || []).map((a: any) => ({
        receiptId: a.receiptId,
        receiptDate: a.receipt?.date ?? new Date(0),
        allocated: a.allocatedAmount || 0,
        tds: a.tdsAmount || 0,
        disc: a.discountAmount || 0,
      }))
    }
  }

  // Credit Notes are opposite-nature to sales invoices: their allocated
  // cash REDUCES the receipt's settled total instead of adding to it
  // (the party's credit cancels out cash they'd otherwise owe). TDS and
  // Discount are always 0 on CN rows.
  const byReceipt: Record<number, {
    linkedCount: number; linkedCash: number; linkedTds: number; linkedDiscount: number;
    linkedInvoices: { vchType: string; vchNumber: string; date: string | null; allocatedAmount: number; tdsAmount: number; discountAmount: number; pending: number; invoiceTotalAmount: number; invoiceNetAmount: number; priorPending: number; isFirstAllocation: boolean }[]
  }> = {}
  // Precompute a fast (receiptId → date) lookup so the prior-pending
  // calc can decide ordering when two allocations on the same invoice
  // share a date — fall back to receiptId for a stable tiebreak.
  const receiptDateById: Record<number, Date> = {}
  for (const r of rows) receiptDateById[r.id] = r.date
  for (const a of allocs) {
    const acc = byReceipt[a.receiptId] ??= { linkedCount: 0, linkedCash: 0, linkedTds: 0, linkedDiscount: 0, linkedInvoices: [] }
    // Purchase booked against a Sundry Debtor behaves like a CN —
    // party credit, no TDS/discount, allocated cash reduces the
    // receipt's settled total instead of adding to it.
    const isCN = a.invoice.vchType === 'Credit Note' || a.invoice.vchType === 'Purchase'
    acc.linkedCount += 1
    acc.linkedCash += isCN ? -a.allocatedAmount : a.allocatedAmount
    acc.linkedTds += a.tdsAmount
    acc.linkedDiscount += a.discountAmount

    // priorPending: bill total minus consumption by every allocation that
    // strictly precedes this one (earlier date, or same date with a lower
    // receipt id as a stable tiebreak). For the first allocation on a
    // bill this equals the bill total.
    const myDate = receiptDateById[a.receiptId] ?? new Date(0)
    const sameInv = allocsByInvoice[a.invoiceId] || []
    let priorConsumed = 0
    let isFirst = true
    for (const x of sameInv) {
      if (x.receiptId === a.receiptId) continue
      const earlier = x.receiptDate.getTime() < myDate.getTime()
        || (x.receiptDate.getTime() === myDate.getTime() && x.receiptId < a.receiptId)
      if (earlier) {
        priorConsumed += x.allocated + x.tds + x.disc
        isFirst = false
      }
    }
    const billTotal = invoiceMeta[a.invoiceId]?.totalAmount ?? 0
    const priorPending = Math.max(0, billTotal - priorConsumed)

    acc.linkedInvoices.push({
      vchType: a.invoice.vchType, vchNumber: a.invoice.vchNumber,
      date: a.invoice.date ? a.invoice.date.toISOString() : null,
      allocatedAmount: isCN ? -a.allocatedAmount : a.allocatedAmount,
      tdsAmount: a.tdsAmount, discountAmount: a.discountAmount,
      pending: pendingByInvoice[a.invoiceId] ?? 0,
      invoiceTotalAmount: billTotal,
      invoiceNetAmount: invoiceMeta[a.invoiceId]?.netAmount ?? 0,
      priorPending: Math.round(priorPending * 100) / 100,
      isFirstAllocation: isFirst,
    })
  }
  const enriched = rows.map((r: any) => ({
    ...r,
    carryOverPriorFy: r.carryOverPriorFy || 0,
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
    where: {
      direction, hidden: true,
      ...(fys.length === 1 ? { fy: fys[0] } : fys.length > 1 ? { fy: { in: fys } } : {}),
    },
  })

  return NextResponse.json({
    rows: enriched,
    fyTotals: fyTotals.map((g: any) => ({ fy: g.fy, count: g._count._all, total: g._sum.amount ?? 0 })),
    hiddenCount,
  })
}
