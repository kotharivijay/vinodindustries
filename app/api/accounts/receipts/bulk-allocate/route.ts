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
  // Free-form note saved on every allocation row in this batch.
  // Surfaced on the receipt detail page and shared on WhatsApp.
  batchNote?: string | null
  // Total amount of these receipts that should be marked as carry-over
  // to a prior FY (e.g. FY 24-25). Reduces the FIFO pool before
  // allocation; distributed FIFO across selected receipts oldest-first
  // and persisted on each receipt's carryOverPriorFy column.
  carryOver?: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const dryRun = req.nextUrl.searchParams.get('dryRun') === '1'
  const body = (await req.json().catch(() => null)) as BulkBody | null
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const { receiptIds, partyName, includeAdvance = false, rows, batchNote, carryOver = 0 } = body
  const carryOverAmt = Number.isFinite(carryOver) && carryOver > 0 ? round2(Number(carryOver)) : 0
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

  // Stricter check: all selected receipts must share the same canonical
  // party name. The user's loose search query (e.g. "Kesh") could
  // otherwise pick up "Keshav Synthetics" + "Keshari Textile" together
  // and the FIFO would happily cross-link them. Canonical = name with
  // any "(Branch)" suffix dropped, whitespace collapsed, lower-cased.
  const canonicalize = (n: string) => n.split('(')[0].trim().toLowerCase().replace(/\s+/g, ' ')
  const receiptCanonical = new Set<string>(receipts.map((r: any) => canonicalize(r.partyName)))
  if (receiptCanonical.size > 1) {
    return NextResponse.json({
      error: `Selected receipts span ${receiptCanonical.size} different parties: ${[...receiptCanonical].join(', ')}. Refine the party search to one party first.`,
      receiptParties: [...receiptCanonical],
    }, { status: 400 })
  }
  const truePartyCanonical: string = [...receiptCanonical][0] ?? ''

  const conflicts = receipts
    .filter((r: any) => r.allocations.length > 0)
    .map((r: any) => ({ receiptId: r.id, vchNumber: r.vchNumber, existingLinks: r.allocations.length }))
  if (conflicts.length > 0) {
    return NextResponse.json({ error: 'Some receipts already linked', conflicts }, { status: 409 })
  }

  // ── 2. Candidate invoices ───────────────────────────────────────────
  // Default candidate set = invoices dated *on or before* the newest
  // selected receipt — same-day bills are "old" (most users settle a
  // bill issued same-day with the same receipt).
  // "Advance invoices" toggle widens to include invoices dated
  // *strictly after* the newest receipt — the genuine advance-payment
  // case where the bill hasn't been issued yet.
  const newestReceiptDate = receipts.reduce(
    (d: Date, r: any) => (r.date.getTime() > d.getTime() ? r.date : d),
    new Date(0),
  )
  const partyInvoicesRaw = await db.ksiSalesInvoice.findMany({
    where: { partyName: { contains: partyKey, mode: 'insensitive' } },
    include: { allocations: true },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
  })
  // Tighten with canonical match so a coarse "Kesh" search doesn't
  // pull in another party with the same prefix. Bidirectional: an
  // invoice party whose canonical name CONTAINS the receipts' true
  // canonical (or vice-versa) counts as a match — covers branch
  // suffixes and "M/s" prefixes.
  const partyInvoices = partyInvoicesRaw.filter((inv: any) => {
    const c = canonicalize(inv.partyName)
    return c === truePartyCanonical || c.includes(truePartyCanonical) || truePartyCanonical.includes(c)
  })
  // Partition into old vs advance so we can return an advanceCount
  // even when the toggle is off (used to label the pill). Boundaries
  // are mutually exclusive: <= goes to "old", > goes to "advance".
  const newestMs = newestReceiptDate.getTime()
  const advancePartyInvoices = partyInvoices.filter((inv: any) => inv.date.getTime() > newestMs)
  const advancePendingCount = advancePartyInvoices.filter((inv: any) => {
    const consumed = (inv.allocations || []).reduce(
      (s: number, a: any) => s + (a.allocatedAmount || 0) + (a.tdsAmount || 0) + (a.discountAmount || 0),
      0,
    )
    return inv.totalAmount - consumed > 0.5
  }).length
  const invoices = includeAdvance
    ? partyInvoices
    : partyInvoices.filter((inv: any) => inv.date.getTime() <= newestMs)

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
      // Persistent skip flag — bulk-link FIFO passes over these.
      skipAutoLink: !!inv.skipAutoLink,
      skipAutoLinkReason: inv.skipAutoLinkReason ?? null,
    }))

  // ── 3a. Dry-run: build FIFO plan and return ─────────────────────────
  const sortedReceipts = [...receipts].sort((a: any, b: any) =>
    a.date.getTime() - b.date.getTime() || a.id - b.id,
  )

  // Distribute the new carry-over (FIFO oldest-first) on top of any
  // existing carryOverPriorFy. Each receipt's available pool is then
  // r.amount − existing − additional. Used by both the dry-run FIFO
  // and the commit-time validation.
  const additionalCarryOver: Record<number, number> = {}
  if (carryOverAmt > 0) {
    let need = carryOverAmt
    for (const r of sortedReceipts) {
      if (need <= 0.0001) break
      const existing = (r as any).carryOverPriorFy || 0
      const headroom = Math.max(0, round2(r.amount - existing))
      if (headroom <= 0.0001) continue
      const take = round2(Math.min(headroom, need))
      additionalCarryOver[r.id] = take
      need = round2(need - take)
    }
    if (need > 0.5) {
      return NextResponse.json({
        error: `Carry-over ₹${carryOverAmt.toFixed(2)} exceeds available pool by ₹${need.toFixed(2)}`,
      }, { status: 400 })
    }
  }

  if (dryRun || !rows) {
    const rcptRemaining: Record<number, number> = {}
    for (const r of sortedReceipts) {
      const existing = (r as any).carryOverPriorFy || 0
      const add = additionalCarryOver[r.id] || 0
      rcptRemaining[r.id] = round2(Math.max(0, r.amount - existing - add))
    }

    const plan: PlanRow[] = []
    let i = 0
    for (const inv of pendingInvoices) {
      // Skipped invoices are passed over by FIFO — receipt cash flows
      // to the next eligible invoice. They still appear in the dryRun
      // response so the client can render the badge + reason.
      if (inv.skipAutoLink) continue
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
    const totalExistingCarryOver = sortedReceipts.reduce(
      (s: number, r: any) => s + (r.carryOverPriorFy || 0), 0,
    )
    const totalCarryOver = round2(totalExistingCarryOver + carryOverAmt)
    const leftoverReceipt = round2(Object.values(rcptRemaining).reduce((s: number, v: number) => s + v, 0))
    const totalInvoicePending = pendingInvoices.reduce((s: number, v: { pending: number }) => s + v.pending, 0)
    const leftoverInvoice = round2(Math.max(0, totalInvoicePending - totalLinked))

    return NextResponse.json({
      dryRun: true,
      plan,
      totals: {
        receipts: round2(totalReceipts),
        linked: round2(totalLinked),
        carryOver: totalCarryOver,
        delta: round2(totalReceipts - totalLinked - totalCarryOver),
        leftoverReceipt,
        leftoverInvoice,
      },
      receipts: sortedReceipts.map((r: any) => ({
        id: r.id, vchNumber: r.vchNumber, vchType: r.vchType, date: r.date,
        amount: r.amount, partyName: r.partyName,
        carryOverPriorFy: r.carryOverPriorFy || 0,
        additionalCarryOver: additionalCarryOver[r.id] || 0,
      })),
      invoices: pendingInvoices,
      includeAdvance,
      advanceCount: advancePendingCount,
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
    // Reject any caller-supplied row pointing at a skipped invoice —
    // the user must explicitly unskip it first.
    const invRow = invoices.find((i: any) => i.id === row.invoiceId)
    if (invRow?.skipAutoLink) {
      return NextResponse.json({
        error: `Invoice ${invRow.vchNumber} is marked Skip — unskip it first.`,
        skippedInvoiceId: row.invoiceId,
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
    const r = rcptById[rid]
    const reserved = (r.carryOverPriorFy || 0) + (additionalCarryOver[rid] || 0)
    const cap = r.amount - reserved
    if (spent > cap + 1) {
      return NextResponse.json({
        error: `Receipt #${r.vchNumber} over-spent (cash ₹${round2(spent)} > available ₹${round2(cap)} after carry-over ₹${round2(reserved)})`,
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
    // Bulk-level note overrides per-row notes when present, so every
    // row in the batch shares the same string (used for sibling
    // listing on the detail page and WhatsApp share).
    const note = (batchNote && batchNote.trim()) ? batchNote.trim() : ((row.note ?? null) || null)
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

  // One UUID per bulk-link operation, stamped on every row created in
  // this transaction. Lets the receipt detail page pull every sibling
  // receipt + invoice in the same batch when any one is opened.
  const bulkBatchId = crypto.randomUUID()
  const allocCreates = Object.values(merged).map(m =>
    db.ksiReceiptAllocation.create({ data: { ...m, bulkBatchId } }),
  )
  // Bump carryOverPriorFy on each affected receipt by its FIFO share.
  const carryOverUpdates = Object.entries(additionalCarryOver)
    .filter(([, add]) => (add as number) > 0)
    .map(([ridStr, add]) => {
      const rid = Number(ridStr)
      const existing = rcptById[rid].carryOverPriorFy || 0
      return db.ksiHdfcReceipt.update({
        where: { id: rid },
        data: { carryOverPriorFy: round2(existing + (add as number)) },
      })
    })
  const result = await db.$transaction([...carryOverUpdates, ...allocCreates])
  const created = result.slice(carryOverUpdates.length)

  return NextResponse.json({
    ok: true,
    saved: created.length,
    bulkBatchId,
    totals: {
      cash: round2(Object.values(merged).reduce((s, m) => s + m.allocatedAmount, 0)),
      tds: round2(Object.values(merged).reduce((s, m) => s + m.tdsAmount, 0)),
      discount: round2(Object.values(merged).reduce((s, m) => s + m.discountAmount, 0)),
      carryOverApplied: round2(Object.values(additionalCarryOver).reduce((s, v) => s + v, 0)),
    },
  })
}
