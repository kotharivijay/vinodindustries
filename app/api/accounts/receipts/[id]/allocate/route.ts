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
  const tds = Number.isFinite(tdsAmount) && tdsAmount > 0 ? Number(tdsAmount) : 0
  const disc = Number.isFinite(discountAmount) && discountAmount > 0 ? Number(discountAmount) : 0
  const ratePct = Number.isFinite(tdsRatePct) ? Number(tdsRatePct) : null

  const db = prisma as any
  const row = await db.ksiReceiptAllocation.upsert({
    where: { receiptId_invoiceId: { receiptId, invoiceId } },
    create: { receiptId, invoiceId, allocatedAmount, tdsAmount: tds, discountAmount: disc, tdsRatePct: ratePct, note: note || null },
    update: { allocatedAmount, tdsAmount: tds, discountAmount: disc, tdsRatePct: ratePct, note: note || null },
  })
  return NextResponse.json({ ok: true, allocation: row })
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const receiptId = parseInt(params.id)
  if (!Number.isFinite(receiptId)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  const { invoiceId } = await req.json().catch(() => ({}))
  if (!Number.isFinite(invoiceId)) return NextResponse.json({ error: 'invoiceId required' }, { status: 400 })

  const db = prisma as any
  const result = await db.ksiReceiptAllocation.deleteMany({ where: { receiptId, invoiceId } })
  return NextResponse.json({ ok: true, deleted: result.count })
}
