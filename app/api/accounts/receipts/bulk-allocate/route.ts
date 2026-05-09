export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// POST /api/accounts/receipts/bulk-allocate
//
// Two modes, controlled by `?dryRun=1`:
//   • dryRun  → server runs FIFO (oldest receipt cash → oldest invoice
//               pending) and returns a suggested plan + totals + the
//               candidate invoice list. No writes.
//   • commit  → caller passes the (possibly user-edited) `rows` array
//               back; server validates, then writes all allocations in
//               one transaction.
//
// Conflict policy (locked by user): if any selected receipt already has
// at least one KsiReceiptAllocation row, the request is rejected with
// 409 + the list of offending receipts. The caller must unlink first.

interface AllocSplit { receiptId: number; allocatedAmount: number }
interface PlanRow {
  invoiceId: number
  allocations: AllocSplit[]
  tdsRatePct?: number | null
  tdsAmount?: number
  discountPct?: number | null
  discountAmount?: number
  note?: string | null
}
interface BulkBody {
  receiptIds: number[]
  partyName: string
  includeAdvance?: boolean
  rows?: PlanRow[]
}

const round2 = (n: number) => Math.round(n * 100) / 100

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const dryRun = req.nextUrl.searchParams.get('dryRun') === '1'
  const body = (await req.json().catch(() => null)) as BulkBody | null
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const { receiptIds, partyName, includeAdvance = false, rows } = body
  if (!Array.isArray(receiptIds) || receiptIds.length === 0) {
    return NextResponse.json({ error: 'receiptIds required' }, { status: 400 })
  }
  if (!partyName || typeof partyName !== 'string') {
    return NextResponse.json({ error: 'partyName required' }, { status: 400 })
  }

  const db = prisma as any

  // ── 1. Receipts: load + party guard + conflict guard ────────────────
  const receipts = await db.ksiHdfcReceipt.findMany({
    where: { id: { in: receiptIds }, direction: 'in' },
    include: { allocations: true },
  })
  if (receipts.length !== receiptIds.length) {
    const found = new Set(receipts.map((r: any) => r.id))
    const missing = receiptIds.filter(id => !found.has(id))
    return NextResponse.json({ error: 'Some receipts not found', missing }, { status: 404 })
  }

  // Match the detail page's loose party rule: drop trailing "(Branch)"
  // segment so "Yash Collection" matches "Yash Collection (Surat)".
  const partyKey = partyName.split('(')[0].trim().toLowerCase()
  const wrongParty = receipts.filter((r: any) => !r.partyName.toLowerCase().includes(partyKey))
  if (wrongParty.length > 0) {
    return NextResponse.json({
      error: 'Some selected receipts are for a different party',
      wrongParty: wrongParty.map((r: any) => ({ id: r.id, vchNumber: r.vchNumber, partyName: r.partyName })),
    }, { status: 400 })
  }

  const conflicts = receipts
    .filter((r: any) => r.allocations.length > 0)
    .map((r: any) => ({ receiptId: r.id, vchNumber: r.vchNumber, existingLinks: r.allocations.length }))
  if (conflicts.length > 0) {
    return NextResponse.json({ error: 'Some receipts already linked', conflicts }, { status: 409 })
  }

  // ── 2. Candidate invoices ───────────────────────────────────────────
  const newestReceiptDate = receipts.reduce(
    (d: Date, r: any) => (r.date.getTime() > d.getTime() ? r.date : d),
    new Date(0),
  )
  const invoices = await db.ksiSalesInvoice.findMany({
    where: {
      partyName: { contains: partyKey, mode: 'insensitive' },
      ...(includeAdvance ? {} : { date: { lte: newestReceiptDate } }),
    },
    include: { allocations: true },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
  })

  const pendingPerInvoice: Record<number, number> = {}
  for (const inv of invoices) {
    const consumed = (inv.allocations || []).reduce(
      (s: number, a: any) => s + (a.allocatedAmount || 0) + (a.tdsAmount || 0) + (a.discountAmount || 0),
      0,
    )
    pendingPerInvoice[inv.id] = round2(Math.max(0, inv.totalAmount - consumed))
  }
  const pendingInvoices = invoices
    .filter((inv: any) => pendingPerInvoice[inv.id] > 0)
    .map((inv: any) => ({
      id: inv.id, date: inv.date, vchNumber: inv.vchNumber, vchType: inv.vchType,
      totalAmount: inv.totalAmount,
      taxableAmount: inv.taxableAmount,
      partyGstin: inv.partyGstin,
      pending: pendingPerInvoice[inv.id],
    }))

  // ── 3a. Dry-run: build FIFO plan and return ─────────────────────────
  if (dryRun || !rows) {
    const sortedReceipts = [...receipts].sort((a: any, b: any) =>
      a.date.getTime() - b.date.getTime() || a.id - b.id,
    )
    const rcptRemaining: Record<number, number> = {}
    for (const r of sortedReceipts) rcptRemaining[r.id] = r.amount

    const plan: PlanRow[] = []
    let i = 0
    for (const inv of pendingInvoices) {
      let need = inv.pending
      const splits: AllocSplit[] = []
      while (need > 0 && i < sortedReceipts.length) {
        const r = sortedReceipts[i]
        const have = rcptRemaining[r.id]
        if (have <= 0.0001) { i++; continue }
        const take = round2(Math.min(have, need))
        if (take <= 0) { i++; continue }
        splits.push({ receiptId: r.id, allocatedAmount: take })
        rcptRemaining[r.id] = round2(have - take)
        need = round2(need - take)
        if (rcptRemaining[r.id] <= 0.0001) i++
      }
      if (splits.length > 0) plan.push({ invoiceId: inv.id, allocations: splits })
      if (i >= sortedReceipts.length) break
    }

    const totalReceipts = receipts.reduce((s: number, r: any) => s + r.amount, 0)
    const totalLinked = plan.reduce(
      (s, row) => s + row.allocations.reduce((ss, a) => ss + a.allocatedAmount, 0),
      0,
    )
    const leftoverReceipt = round2(Object.values(rcptRemaining).reduce((s: number, v: number) => s + v, 0))
    const totalInvoicePending = pendingInvoices.reduce((s: number, v: { pending: number }) => s + v.pending, 0)
    const leftoverInvoice = round2(Math.max(0, totalInvoicePending - totalLinked))

    return NextResponse.json({
      dryRun: true,
      plan,
      totals: {
        receipts: round2(totalReceipts),
        linked: round2(totalLinked),
        delta: round2(totalReceipts - totalLinked),
        leftoverReceipt,
        leftoverInvoice,
      },
      receipts: sortedReceipts.map((r: any) => ({
        id: r.id, vchNumber: r.vchNumber, vchType: r.vchType, date: r.date,
        amount: r.amount, partyName: r.partyName,
      })),
      invoices: pendingInvoices,
      includeAdvance,
    })
  }

  // ── 3b. Commit: validate caller-supplied rows, then write ───────────
  const rcptById: Record<number, any> = {}
  for (const r of receipts) rcptById[r.id] = r
  const cashSpentByReceipt: Record<number, number> = {}

  for (const row of rows) {
    if (!row || !Number.isFinite(row.invoiceId) || !Array.isArray(row.allocations)) {
      return NextResponse.json({ error: 'Invalid row shape' }, { status: 400 })
    }
    const invPending = pendingPerInvoice[row.invoiceId]
    if (invPending === undefined) {
      return NextResponse.json({
        error: `Invoice ${row.invoiceId} not in candidate set (party / advance filter)`,
      }, { status: 400 })
    }
    let cashForInvoice = 0
    for (const split of row.allocations) {
      if (!split || !Number.isFinite(split.receiptId) || !rcptById[split.receiptId]) {
        return NextResponse.json({ error: 'Allocation refers to a receipt outside the selection' }, { status: 400 })
      }
      if (!Number.isFinite(split.allocatedAmount) || split.allocatedAmount <= 0) {
        return NextResponse.json({ error: 'allocatedAmount must be > 0' }, { status: 400 })
      }
      cashSpentByReceipt[split.receiptId] = (cashSpentByReceipt[split.receiptId] || 0) + split.allocatedAmount
      cashForInvoice += split.allocatedAmount
    }
    const tds = Number.isFinite(row.tdsAmount) && row.tdsAmount! > 0 ? Number(row.tdsAmount) : 0
    const disc = Number.isFinite(row.discountAmount) && row.discountAmount! > 0 ? Number(row.discountAmount) : 0
    const consumed = cashForInvoice + tds + disc
    // Allow 1-rupee tolerance for rounding noise.
    if (consumed > invPending + 1) {
      return NextResponse.json({
        error: `Invoice ${row.invoiceId} over-allocated (consumed ₹${round2(consumed)} > pending ₹${invPending})`,
      }, { status: 400 })
    }
  }
  for (const [ridStr, spent] of Object.entries(cashSpentByReceipt)) {
    const rid = Number(ridStr)
    if (spent > rcptById[rid].amount + 1) {
      return NextResponse.json({
        error: `Receipt #${rcptById[rid].vchNumber} over-spent (${round2(spent)} > ${rcptById[rid].amount})`,
      }, { status: 400 })
    }
  }

  // Merge by (receiptId, invoiceId) — schema's @@unique constraint requires
  // one row per pair. If the user's plan has multiple splits for the same
  // pair (uncommon), sum them and apportion TDS / discount by cash share.
  const merged: Record<string, {
    receiptId: number; invoiceId: number;
    allocatedAmount: number; tdsAmount: number; discountAmount: number;
    tdsRatePct: number | null; note: string | null;
  }> = {}
  for (const row of rows) {
    const tdsTotal = Number.isFinite(row.tdsAmount) && row.tdsAmount! > 0 ? Number(row.tdsAmount) : 0
    const discTotal = Number.isFinite(row.discountAmount) && row.discountAmount! > 0 ? Number(row.discountAmount) : 0
    const ratePct = Number.isFinite(row.tdsRatePct) ? Number(row.tdsRatePct) : null
    const note = (row.note ?? null) || null
    const totalCash = row.allocations.reduce((s, a) => s + a.allocatedAmount, 0) || 1
    for (const split of row.allocations) {
      const ratio = split.allocatedAmount / totalCash
      const key = `${split.receiptId}:${row.invoiceId}`
      if (!merged[key]) {
        merged[key] = {
          receiptId: split.receiptId, invoiceId: row.invoiceId,
          allocatedAmount: 0, tdsAmount: 0, discountAmount: 0,
          tdsRatePct: ratePct, note,
        }
      }
      merged[key].allocatedAmount = round2(merged[key].allocatedAmount + split.allocatedAmount)
      merged[key].tdsAmount       = round2(merged[key].tdsAmount + tdsTotal * ratio)
      merged[key].discountAmount  = round2(merged[key].discountAmount + discTotal * ratio)
    }
  }

  const created = await db.$transaction(
    Object.values(merged).map(m => db.ksiReceiptAllocation.create({ data: m })),
  )

  return NextResponse.json({
    ok: true,
    saved: created.length,
    totals: {
      cash: round2(Object.values(merged).reduce((s, m) => s + m.allocatedAmount, 0)),
      tds: round2(Object.values(merged).reduce((s, m) => s + m.tdsAmount, 0)),
      discount: round2(Object.values(merged).reduce((s, m) => s + m.discountAmount, 0)),
    },
  })
}
