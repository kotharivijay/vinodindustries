export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any
const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Yearwise Invoice Payment Performance report.
 *
 * For every sales invoice in the chosen FY: invoice header, net taxable
 * (items + extras − discounts to match the per-invoice card), GST, total,
 * the receipts that settled it, the journals (TDS Receivable + Discount
 * (GST)) that ran alongside, and the payment performance days =
 * last_settle_date − invoice_date (only when fully cleared).
 *
 *   GET /api/reports/invoice-payment-performance?action=fys
 *     → { fys: ['26-27','25-26','24-25',…] }
 *
 *   GET /api/reports/invoice-payment-performance?fy=25-26
 *     → { fy, rows: [...], maxReceipts, maxJournals }
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const action = sp.get('action')

  if (action === 'fys') {
    const fys = await db.ksiSalesInvoice.groupBy({
      by: ['fy'],
      _count: { _all: true },
      orderBy: { fy: 'desc' },
    })
    return NextResponse.json({ fys: fys.map((g: any) => ({ fy: g.fy, count: g._count._all })) })
  }

  const fy = sp.get('fy')
  if (!fy) return NextResponse.json({ error: 'fy required' }, { status: 400 })

  const invoices = await db.ksiSalesInvoice.findMany({
    where: { fy, vchType: { not: 'Credit Note' } },
    include: {
      allocations: {
        include: { receipt: { select: { id: true, vchNumber: true, vchType: true, date: true } } },
      },
      ledgers: { select: { ledgerName: true, amount: true } },
    },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
  })

  // Party → parent ledger (KSI firm). Used for the Agent column.
  const partyNames = Array.from(new Set(invoices.map((i: any) => i.partyName)))
  const ledgers = partyNames.length === 0 ? [] : await db.tallyLedger.findMany({
    where: { firmCode: 'KSI', name: { in: partyNames } },
    select: { name: true, parent: true },
  })
  const parentByParty: Record<string, string> = {}
  for (const l of ledgers) parentByParty[l.name] = l.parent || ''

  // Ledger category map for voucher-level discount / extra detection.
  const cats = await db.ksiSalesLedgerCategory.findMany({ select: { ledgerName: true, category: true } })
  const categoryMap: Record<string, string> = {}
  for (const c of cats) categoryMap[c.ledgerName.toLowerCase()] = c.category
  function categorise(name: string, partyLower: string): string {
    const lname = name.toLowerCase()
    const explicit = categoryMap[lname]
    if (explicit) return explicit
    if (/cgst|sgst|utgst|igst/.test(lname)) return 'tax'
    if (/round\s*off|roundoff|rounding/.test(lname)) return 'roundoff'
    if (lname === partyLower) return 'party'
    return 'unmapped'
  }

  let maxReceipts = 0
  let maxJournals = 0
  const rows = invoices.map((inv: any) => {
    const partyLower = (inv.partyName || '').toLowerCase()
    let voucherDiscount = 0
    let voucherExtra = 0
    for (const led of inv.ledgers || []) {
      const cat = categorise(led.ledgerName, partyLower)
      const abs = Math.abs(led.amount || 0)
      if (cat === 'discount') voucherDiscount += abs
      else if (cat === 'extra-charge') voucherExtra += abs
    }
    const gst = round2((inv.cgstAmount || 0) + (inv.sgstAmount || 0) + (inv.igstAmount || 0))
    const taxableNet = round2((inv.taxableAmount || 0) - voucherDiscount + voucherExtra)

    // Walk allocations chronologically and split into "receipt" (cash)
    // and "journal" (TDS / Discount-GST) streams. Each line carries the
    // amount + the receipt date (journals don't have their own date in
    // our schema — they're booked with the receipt).
    const allocs = (inv.allocations || []).slice().sort((a: any, b: any) =>
      a.receipt.date.getTime() - b.receipt.date.getTime() || a.receipt.id - b.receipt.id,
    )
    const receipts: { date: string; vchNumber: string; vchType: string; amount: number }[] = []
    const journals: { date: string; ledger: string; amount: number }[] = []
    let consumed = 0
    let lastSettleDate: Date | null = null
    let lastSettleHit = false
    for (const a of allocs) {
      const isCN = a.receipt.vchType === 'Credit Note'
      const cash = a.allocatedAmount || 0
      const tds = a.tdsAmount || 0
      const disc = a.discountAmount || 0
      if (cash > 0) {
        receipts.push({
          date: a.receipt.date.toISOString(),
          vchNumber: a.receipt.vchNumber,
          vchType: a.receipt.vchType,
          amount: round2(cash),
        })
      }
      if (tds > 0) journals.push({ date: a.receipt.date.toISOString(), ledger: 'TDS Receivable', amount: round2(tds) })
      if (disc > 0) journals.push({ date: a.receipt.date.toISOString(), ledger: 'Discount (GST)', amount: round2(disc) })
      // CN allocations subtract from cash (party-credit knock-off) — for
      // settlement purposes we still treat them as consumed.
      const contrib = isCN ? -cash : cash
      consumed += contrib + tds + disc
      if (!lastSettleHit && consumed >= inv.totalAmount - 0.5) {
        lastSettleDate = a.receipt.date
        lastSettleHit = true
      }
    }
    if (receipts.length > maxReceipts) maxReceipts = receipts.length
    if (journals.length > maxJournals) maxJournals = journals.length

    const pending = round2(Math.max(0, inv.totalAmount - consumed))
    const isCleared = pending <= 0.5
    const performanceDays = (isCleared && lastSettleDate)
      ? Math.round((lastSettleDate.getTime() - inv.date.getTime()) / 86400000)
      : null
    const bucket = performanceDays == null ? 'open'
      : performanceDays <= 30 ? 'g30'
      : performanceDays <= 60 ? 'y60'
      : performanceDays <= 90 ? 'o90'
      : 'r90p'

    return {
      id: inv.id,
      date: inv.date.toISOString(),
      vchNumber: inv.vchNumber,
      vchType: inv.vchType,
      partyName: inv.partyName,
      agent: parentByParty[inv.partyName] || '',
      taxableNet,
      voucherDiscount: round2(voucherDiscount),
      voucherExtra: round2(voucherExtra),
      gst,
      totalAmount: round2(inv.totalAmount),
      receipts,
      journals,
      consumed: round2(consumed),
      pending,
      isCleared,
      lastSettleDate: lastSettleDate ? lastSettleDate.toISOString() : null,
      performanceDays,
      bucket,
    }
  })

  // Summary totals for the page header.
  const totals = {
    invoiceCount: rows.length,
    clearedCount: rows.filter((r: any) => r.isCleared).length,
    totalAmount: round2(rows.reduce((s: number, r: any) => s + r.totalAmount, 0)),
    pendingAmount: round2(rows.reduce((s: number, r: any) => s + r.pending, 0)),
    avgPerformanceDays: (() => {
      const cleared = rows.filter((r: any) => r.performanceDays != null)
      if (cleared.length === 0) return null
      return Math.round(cleared.reduce((s: number, r: any) => s + r.performanceDays, 0) / cleared.length)
    })(),
    bucketCounts: {
      g30: rows.filter((r: any) => r.bucket === 'g30').length,
      y60: rows.filter((r: any) => r.bucket === 'y60').length,
      o90: rows.filter((r: any) => r.bucket === 'o90').length,
      r90p: rows.filter((r: any) => r.bucket === 'r90p').length,
      open: rows.filter((r: any) => r.bucket === 'open').length,
    },
  }

  return NextResponse.json({ fy, rows, maxReceipts, maxJournals, totals })
}
