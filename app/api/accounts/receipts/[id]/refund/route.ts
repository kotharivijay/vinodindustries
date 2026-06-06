export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

/**
 * POST /api/accounts/receipts/[id]/refund
 *
 * Creates a Payment voucher (KsiHdfcReceipt with direction='out',
 * vchType='Payment') that refunds the source Receipt's excess
 * (unallocated) cash back to the party. The new row is linked to the
 * source via refundForReceiptId so the Outstanding endpoint can clear
 * the excess and the receipt detail page can show the refund inline.
 *
 * Body:
 *   { amount, date, vchNumber, narration?, instrumentNo?, bankRef? }
 *
 * Validation:
 *   • source receipt must exist and direction='in'
 *   • amount > 0 and amount <= source.unallocated
 *   • vchNumber+date+vchType natural key must be unique (Payment series)
 *   • blocks creating a refund when the source already has one outstanding
 *     refund for the same amount (prevents accidental double-tap dupes)
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sourceId = parseInt(params.id)
  if (!Number.isFinite(sourceId)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const amount = Number(body.amount)
  const dateStr = String(body.date || '').trim()
  const vchNumber = String(body.vchNumber || '').trim()
  const narration = body.narration ? String(body.narration).trim() : null
  const instrumentNo = body.instrumentNo ? String(body.instrumentNo).trim() : null
  const bankRef = body.bankRef ? String(body.bankRef).trim() : null

  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'amount must be > 0' }, { status: 400 })
  }
  if (!dateStr || !vchNumber) {
    return NextResponse.json({ error: 'date and vchNumber required' }, { status: 400 })
  }
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) {
    return NextResponse.json({ error: `bad date "${dateStr}"` }, { status: 400 })
  }

  const source = await db.ksiHdfcReceipt.findUnique({
    where: { id: sourceId },
    include: { allocations: true, refunds: true },
  })
  if (!source) return NextResponse.json({ error: 'Source receipt not found' }, { status: 404 })
  if (source.direction !== 'in') {
    return NextResponse.json({ error: 'Refund only allowed on Receipt (direction=in) rows' }, { status: 400 })
  }

  // Compute unallocated on source: receipt amount − net allocated cash
  // (CN allocations subtract) − carry-over − existing refunds.
  const linkedCash = (source.allocations || []).reduce((s: number, a: any) => s + (a.allocatedAmount || 0), 0)
  const carryOver = source.carryOverPriorFy || 0
  const refundedSoFar = (source.refunds || []).reduce((s: number, r: any) => s + (r.amount || 0), 0)
  const unallocated = Math.max(0, source.amount - linkedCash - carryOver - refundedSoFar)

  if (amount > unallocated + 0.5) {
    return NextResponse.json({
      error: `Refund ₹${amount.toFixed(2)} exceeds receipt's remaining unallocated ₹${unallocated.toFixed(2)} (already refunded ₹${refundedSoFar.toFixed(2)})`,
      unallocated,
      refundedSoFar,
    }, { status: 400 })
  }

  // FY derived from date (Apr-Mar fiscal). Stored as "yy-yy" matching
  // the rest of KsiHdfcReceipt / KsiSalesInvoice rows.
  const fyStartYear = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1
  const fy = `${String(fyStartYear).slice(2)}-${String(fyStartYear + 1).slice(2)}`

  try {
    const created = await db.ksiHdfcReceipt.create({
      data: {
        fy, date, vchNumber, vchType: 'Payment', direction: 'out',
        partyName: source.partyName,
        amount,
        narration: narration ?? `Refund of excess on receipt #${source.vchNumber}`,
        instrumentNo, bankRef,
        refundForReceiptId: source.id,
      },
      select: { id: true, vchNumber: true, date: true, amount: true, partyName: true, refundForReceiptId: true },
    })
    return NextResponse.json({ ok: true, payment: created }, { status: 201 })
  } catch (e: any) {
    // P2002 → duplicate natural key
    if (e?.code === 'P2002') {
      return NextResponse.json({
        error: `Payment with vchNumber "${vchNumber}" on ${dateStr} already exists. Use a different number.`,
        code: 'DUPLICATE',
      }, { status: 409 })
    }
    return NextResponse.json({ error: e?.message || 'Refund create failed' }, { status: 500 })
  }
}
