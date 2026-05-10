export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// GET /api/accounts/receipts/[id]
// Returns the receipt + party's KSI sales/process invoices + existing
// allocations.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = parseInt(params.id)
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })

  const db = prisma as any
  const receipt = await db.ksiHdfcReceipt.findUnique({
    where: { id },
    include: { allocations: { include: { invoice: true } } },
  })
  if (!receipt) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Bulk-batch siblings: every other receipt that was committed in the
  // same /bulk-allocate call as any of this receipt's allocations.
  const batchIds: string[] = Array.from(new Set(
    (receipt.allocations || []).map((a: any) => a.bulkBatchId).filter((b: any): b is string => !!b),
  ))
  let batchSiblings: any[] = []
  let batchInvoiceIds: number[] = []
  let batchNote: string | null = null
  if (batchIds.length > 0) {
    const batchAllocs = await db.ksiReceiptAllocation.findMany({
      where: { bulkBatchId: { in: batchIds } },
      include: { receipt: { select: { id: true, vchNumber: true, vchType: true, date: true, amount: true, partyName: true } } },
    })
    const sibMap = new Map<number, any>()
    const invSet = new Set<number>()
    const sibTotals: Record<number, { cash: number; tds: number; discount: number; count: number }> = {}
    for (const a of batchAllocs) {
      invSet.add(a.invoiceId)
      if (!batchNote && a.note) batchNote = a.note
      const rcptId = a.receipt.id
      if (!sibMap.has(rcptId)) sibMap.set(rcptId, a.receipt)
      const t = sibTotals[rcptId] ??= { cash: 0, tds: 0, discount: 0, count: 0 }
      t.cash += a.allocatedAmount
      t.tds += a.tdsAmount
      t.discount += a.discountAmount
      t.count += 1
    }
    sibMap.delete(id)  // drop the current receipt
    batchSiblings = [...sibMap.values()].map(r => ({ ...r, ...sibTotals[r.id] }))
    batchSiblings.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    batchInvoiceIds = [...invSet]
  }

  // Pull invoices for the party (case-insensitive partial match: Tally
  // sometimes uses slightly different capitalisations) AND any invoice
  // that has an allocation to this receipt — even if its party name
  // doesn't match. Catches mis-linked allocations (e.g. when a fuzzy
  // party search at bulk-link time pulled in cross-party bills) so
  // the user can always see and unlink them.
  const linkedInvoiceIds = (receipt.allocations || []).map((a: any) => a.invoiceId)
  const invoices = await db.ksiSalesInvoice.findMany({
    where: {
      OR: [
        { partyName: { contains: receipt.partyName.split('(')[0].trim(), mode: 'insensitive' } },
        ...(linkedInvoiceIds.length > 0 ? [{ id: { in: linkedInvoiceIds } }] : []),
      ],
    },
    include: {
      lines: { orderBy: { lineNo: 'asc' } },
      ledgers: true,
      allocations: { include: { receipt: { select: { id: true, vchNumber: true, date: true, amount: true } } } },
    },
    orderBy: { date: 'desc' },
    take: 100,
  })

  // Category map for ledger classification (Net Ask uses extras + discounts)
  const categories = await db.ksiSalesLedgerCategory.findMany()
  const categoryMap: Record<string, string> = {}
  for (const c of categories) categoryMap[c.ledgerName.toLowerCase()] = c.category

  // Pending = totalAmount − Σ(allocatedAmount + tdsAmount + discountAmount).
  // TDS / discount reduce the invoice's outstanding without being cash receipts,
  // so they belong on the "consumed" side just like the cash allocation.
  const enriched = invoices.map((inv: any) => {
    const allocated = (inv.allocations || []).reduce((s: number, a: any) => s + (a.allocatedAmount || 0), 0)
    const tds = (inv.allocations || []).reduce((s: number, a: any) => s + (a.tdsAmount || 0), 0)
    const discount = (inv.allocations || []).reduce((s: number, a: any) => s + (a.discountAmount || 0), 0)
    return {
      ...inv,
      allocated, tds, discount,
      consumed: allocated + tds + discount,
      pending: Math.max(0, inv.totalAmount - allocated - tds - discount),
    }
  })

  return NextResponse.json({
    receipt, invoices: enriched, categoryMap,
    batchIds, batchSiblings, batchInvoiceIds, batchNote,
  })
}
