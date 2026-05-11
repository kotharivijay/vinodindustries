export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// GET /api/accounts/outstanding
//
// One DB roundtrip view for the new Outstanding page. Computes
// per-invoice pending and per-receipt unallocated cash from our own
// tables (no Tally roundtrip). Three tabs feed off the same response:
//   • Party-wise   → use `parties[]`
//   • Invoice-wise → flatten parties[].invoices
//   • On-account   → use `receipts[]`
export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = prisma as any
  const todayMs = Date.now()
  const round2 = (n: number) => Math.round(n * 100) / 100
  const dueDays = (d: Date | string) => {
    const t = typeof d === 'string' ? new Date(d).getTime() : d.getTime()
    return Math.max(0, Math.floor((todayMs - t) / 86400_000))
  }

  // ── Invoices: pending = totalAmount − Σ(cash + tds + disc)
  const invoiceRows = await db.ksiSalesInvoice.findMany({
    select: {
      id: true, vchNumber: true, vchType: true, date: true,
      partyName: true, totalAmount: true,
      skipAutoLink: true, skipAutoLinkReason: true,
      allocations: { select: { allocatedAmount: true, tdsAmount: true, discountAmount: true } },
    },
  })
  // Credit Notes are opposite-nature: pending CN balance is a party CREDIT
  // (we owe them), not a debit. We compute per-row pending normally so the
  // row still shows up in the invoice list, then subtract CN pending at
  // party-totals time below.
  const pendingInvoices = invoiceRows
    .map((inv: any) => {
      const isCN = inv.vchType === 'Credit Note'
      const consumed = (inv.allocations || []).reduce(
        (s: number, a: any) => s + (a.allocatedAmount || 0) + (a.tdsAmount || 0) + (a.discountAmount || 0),
        0,
      )
      const pending = round2(Math.max(0, inv.totalAmount - consumed))
      return { ...inv, isCN, pending }
    })
    .filter((inv: any) => inv.pending > 0.5)

  // ── Receipts: unallocated = amount − Σ(signed linkedCash) − carryOverPriorFy.
  // CN allocations subtract from linkedCash (they don't consume receipt cash).
  const receiptRows = await db.ksiHdfcReceipt.findMany({
    where: { direction: 'in', hidden: false },
    select: {
      id: true, vchNumber: true, vchType: true, date: true,
      partyName: true, amount: true, carryOverPriorFy: true,
      bankRef: true, instrumentNo: true, narration: true,
      allocations: {
        select: {
          allocatedAmount: true, tdsAmount: true, discountAmount: true,
          invoice: { select: { vchType: true } },
        },
      },
    },
  })
  const onAccountReceipts = receiptRows
    .map((r: any) => {
      const linkedCash = (r.allocations || []).reduce((s: number, a: any) => {
        const isCN = a.invoice?.vchType === 'Credit Note'
        return s + (isCN ? -a.allocatedAmount : a.allocatedAmount)
      }, 0)
      const linkedTds = (r.allocations || []).reduce((s: number, a: any) => s + (a.tdsAmount || 0), 0)
      const linkedDiscount = (r.allocations || []).reduce((s: number, a: any) => s + (a.discountAmount || 0), 0)
      const carryOver = r.carryOverPriorFy || 0
      const unallocated = round2(Math.max(0, r.amount - linkedCash - carryOver))
      return { ...r, linkedCash: round2(linkedCash), linkedTds: round2(linkedTds), linkedDiscount: round2(linkedDiscount), carryOver, unallocated }
    })
    .filter((r: any) => r.unallocated > 0.5)

  // ── Group invoices and on-account receipts by party
  const onAccByParty = new Map<string, number>()
  for (const r of onAccountReceipts) {
    const key = r.partyName
    onAccByParty.set(key, round2((onAccByParty.get(key) || 0) + r.unallocated))
  }

  // Party total = Σ invoice pending − Σ CN pending. CN is a credit
  // sitting on the party's ledger that offsets future invoices.
  const byParty = new Map<string, { invoices: any[]; totalPending: number }>()
  for (const inv of pendingInvoices) {
    const key = inv.partyName
    if (!byParty.has(key)) byParty.set(key, { invoices: [], totalPending: 0 })
    const e = byParty.get(key)!
    e.invoices.push(inv)
    e.totalPending = round2(e.totalPending + (inv.isCN ? -inv.pending : inv.pending))
  }

  // Parties response — sorted by totalPending desc; each party's
  // invoices sorted by due days desc (most overdue first).
  const parties = [...byParty.entries()].map(([name, data]) => {
    const invs = data.invoices
      .map((inv: any) => ({
        id: inv.id, vchNumber: inv.vchNumber, vchType: inv.vchType,
        date: inv.date, totalAmount: inv.totalAmount, pending: inv.pending,
        isCN: !!inv.isCN,
        dueDays: dueDays(inv.date),
        skipAutoLink: !!inv.skipAutoLink,
        skipAutoLinkReason: inv.skipAutoLinkReason ?? null,
      }))
      .sort((a: any, b: any) => b.dueDays - a.dueDays || b.pending - a.pending)
    return {
      name,
      totalPending: data.totalPending,
      oldestDueDays: invs[0]?.dueDays ?? 0,
      invoiceCount: invs.length,
      onAccount: onAccByParty.get(name) || 0,
      invoices: invs,
    }
  }).sort((a, b) => b.totalPending - a.totalPending)

  // Pull in parties that have only on-account (no pending invoices) so
  // the user sees the "money sitting" rows too.
  for (const [name, onAcc] of onAccByParty.entries()) {
    if (!byParty.has(name)) {
      parties.push({
        name, totalPending: 0, oldestDueDays: 0, invoiceCount: 0,
        onAccount: onAcc, invoices: [],
      })
    }
  }

  const receipts = onAccountReceipts.map((r: any) => ({
    id: r.id, vchNumber: r.vchNumber, vchType: r.vchType, date: r.date,
    partyName: r.partyName, amount: r.amount,
    bankRef: r.bankRef, instrumentNo: r.instrumentNo, narration: r.narration,
    linkedCash: r.linkedCash, carryOver: r.carryOver, unallocated: r.unallocated,
    daysSince: dueDays(r.date),
  })).sort((a: any, b: any) => b.unallocated - a.unallocated)

  const totalOutstanding = parties.reduce((s, p) => s + p.totalPending, 0)
  const totalOnAccount = receipts.reduce((s: number, r: any) => s + r.unallocated, 0)

  return NextResponse.json({
    totals: {
      outstanding: round2(totalOutstanding),
      onAccount: round2(totalOnAccount),
      netReceivable: round2(totalOutstanding - totalOnAccount),
      parties: parties.length,
      invoices: pendingInvoices.length,
      receipts: receipts.length,
    },
    parties,
    receipts,
  })
}
