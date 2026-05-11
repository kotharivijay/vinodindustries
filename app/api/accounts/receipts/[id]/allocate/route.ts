export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// POST /api/accounts/receipts/[id]/allocate
// Body: { invoiceId, allocatedAmount, note? } — links a receipt to an invoice.
// DELETE — body { invoiceId } removes the link.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const receiptId = parseInt(params.id)
  if (!Number.isFinite(receiptId)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })

  const { invoiceId, allocatedAmount, tdsAmount, discountAmount, tdsRatePct, note } = await req.json().catch(() => ({}))
  if (!Number.isFinite(invoiceId) || !Number.isFinite(allocatedAmount) || allocatedAmount <= 0) {
    return NextResponse.json({ error: 'invoiceId + positive allocatedAmount required' }, { status: 400 })
  }
  const ratePct = Number.isFinite(tdsRatePct) ? Number(tdsRatePct) : null

  const db = prisma as any

  // Pending check — prevent over-allocation when the invoice is shared
  // by multiple receipts. Sum every existing allocation for this invoice
  // EXCEPT the current (receiptId, invoiceId) row (which is being
  // replaced by the upsert), and verify the new total stays within the
  // invoice's totalAmount + ₹1 tolerance.
  const inv = await db.ksiSalesInvoice.findUnique({
    where: { id: invoiceId },
    include: { allocations: true },
  })
  if (!inv) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

  // Credit Notes carry no TDS / Discount — force them to 0 server-side
  // even if the client mis-sends a value.
  const isCN = inv.vchType === 'Credit Note'
  const tds = isCN ? 0 : (Number.isFinite(tdsAmount) && tdsAmount > 0 ? Number(tdsAmount) : 0)
  const disc = isCN ? 0 : (Number.isFinite(discountAmount) && discountAmount > 0 ? Number(discountAmount) : 0)

  const existingFromOthers = (inv.allocations || [])
    .filter((a: any) => a.receiptId !== receiptId)
    .reduce((s: number, a: any) => s + (a.allocatedAmount || 0) + (a.tdsAmount || 0) + (a.discountAmount || 0), 0)
  const newOnThisRow = Number(allocatedAmount) + tds + disc
  if (existingFromOthers + newOnThisRow > inv.totalAmount + 1) {
    return NextResponse.json({
      error: `Over-allocation: invoice total ₹${inv.totalAmount.toFixed(2)}, already paid by other receipts ₹${existingFromOthers.toFixed(2)}, this allocation ₹${newOnThisRow.toFixed(2)}`,
      pending: Math.max(0, inv.totalAmount - existingFromOthers),
    }, { status: 400 })
  }

  const row = await db.ksiReceiptAllocation.upsert({
    where: { receiptId_invoiceId: { receiptId, invoiceId } },
    create: { receiptId, invoiceId, allocatedAmount, tdsAmount: tds, discountAmount: disc, tdsRatePct: ratePct, note: note || null },
    update: { allocatedAmount, tdsAmount: tds, discountAmount: disc, tdsRatePct: ratePct, note: note || null },
  })
  return NextResponse.json({ ok: true, allocation: row })
}

// DELETE — body { invoiceId, removeAllReceipts? }
//   removeAllReceipts:false (default) → only this receipt's allocation
//   removeAllReceipts:true            → every receipt's allocation for
//                                       this invoice (cascade unlink)
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const receiptId = parseInt(params.id)
  if (!Number.isFinite(receiptId)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  const { invoiceId, removeAllReceipts } = await req.json().catch(() => ({}))
  if (!Number.isFinite(invoiceId)) return NextResponse.json({ error: 'invoiceId required' }, { status: 400 })

  const db = prisma as any
  const where = removeAllReceipts === true ? { invoiceId } : { receiptId, invoiceId }
  const result = await db.ksiReceiptAllocation.deleteMany({ where })
  return NextResponse.json({ ok: true, deleted: result.count })
}
