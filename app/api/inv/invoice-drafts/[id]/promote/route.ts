export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildInvoiceTotals } from '@/lib/inv/build-invoice-totals'

const db = prisma as any

/**
 * POST /api/inv/invoice-drafts/[id]/promote
 * Body: { supplierInvoiceNo, supplierInvoiceDate }
 *
 * Converts the draft into a real InvPurchaseInvoice in one transaction:
 *   1. Re-validate the draft is still un-promoted.
 *   2. Re-run buildInvoiceTotals on the saved lines (defensive: if an
 *      item's alias.gstRate changed since the draft was saved, the
 *      promoted invoice reflects the current rate, not a stale snapshot).
 *   3. Create the InvPurchaseInvoice + line rows.
 *   4. Link & flip challans → 'Invoiced'. If a challan has already been
 *      invoiced by someone else (race), the link insert violates the
 *      unique constraint and rolls the whole txn back.
 *   5. Stamp promotedInvoiceId / promotedAt on the draft for audit.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const draftId = Number(params.id)
  const body = await req.json().catch(() => ({}))
  const supplierInvoiceNo = String(body.supplierInvoiceNo || '').trim()
  const supplierInvoiceDate = body.supplierInvoiceDate
  if (!supplierInvoiceNo || !supplierInvoiceDate) {
    return NextResponse.json({ error: 'supplierInvoiceNo and supplierInvoiceDate required' }, { status: 400 })
  }

  const draft = await db.invPurchaseInvoiceDraft.findUnique({ where: { id: draftId } })
  if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
  if (draft.promotedAt) {
    return NextResponse.json({ error: 'Already promoted', promotedInvoiceId: draft.promotedInvoiceId }, { status: 409 })
  }

  const party = await db.invParty.findUnique({ where: { id: draft.partyId } })
  if (!party) return NextResponse.json({ error: 'Party missing' }, { status: 404 })

  // Re-compute against current item / alias state so promote reflects
  // any GST-rate fix that happened between draft save and confirm.
  const built = await buildInvoiceTotals(db, {
    party,
    lines: (draft.lines as any[]) || [],
    freightAmount: draft.freightAmount as any,
    otherCharges: draft.otherCharges as any,
    discountAmount: draft.discountAmount as any,
  })

  try {
    const result = await db.$transaction(async (tx: any) => {
      const inv = await tx.invPurchaseInvoice.create({
        data: {
          partyId: draft.partyId,
          supplierInvoiceNo,
          supplierInvoiceDate: new Date(supplierInvoiceDate),
          gstTreatment: built.gstTreatment,
          taxableAmount: built.taxableAmount,
          igstAmount: built.igstAmount,
          cgstAmount: built.cgstAmount,
          sgstAmount: built.sgstAmount,
          freightAmount: built.freight,
          totalDiscountAmount: built.totalDiscountAmount,
          otherCharges: built.other,
          roundOff: built.roundOff,
          totalAmount: built.totalAmount,
          hasPendingReviewItems: built.hasPendingReviewItems,
          notes: draft.notes || null,
          lines: { create: built.lineRows },
        },
        include: { lines: true },
      })
      const ids: number[] = (draft.challanIds as any[]) || []
      if (ids.length) {
        await tx.invInvoiceChallan.createMany({
          data: ids.map((cid: number) => ({ invoiceId: inv.id, challanId: cid })),
        })
        await tx.invChallan.updateMany({
          where: { id: { in: ids } },
          data: { status: 'Invoiced' },
        })
      }
      await tx.invPurchaseInvoiceDraft.update({
        where: { id: draftId },
        data: { promotedInvoiceId: inv.id, promotedAt: new Date() },
      })
      return inv
    })
    return NextResponse.json(result)
  } catch (e: any) {
    if (e?.code === 'P2002') {
      return NextResponse.json({ error: 'Invoice already exists for this party + supplierInvoiceNo' }, { status: 409 })
    }
    throw e
  }
}
