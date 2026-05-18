export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { decideGstTreatment } from '@/lib/inv/gst'
import { computeInvoiceTotals } from '@/lib/inv/invoice-totals'

const KSI_STATE = process.env.KSI_STATE || 'Rajasthan'
const db = prisma as any

/**
 * Surgical reverse of one challan attached to a purchase invoice.
 *
 * Pulls THIS challan off its parent invoice without voiding the whole
 * thing — invoice lines sourced from the challan are removed, totals are
 * recomputed from the survivors, and the challan flips back to
 * 'PendingInvoice'. If no challans remain on the invoice afterwards the
 * invoice itself is hard-deleted so the supplier invoice no. is free for
 * reuse (manually-added lines, if any, are dropped via cascade).
 *
 * Refuses when the invoice has already been pushed to Tally — operator
 * must void/un-push the Tally side first.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const challanId = Number(params.id)
  if (!Number.isFinite(challanId)) {
    return NextResponse.json({ error: 'Invalid challan id', code: 'BAD_INPUT' }, { status: 400 })
  }

  const link = await db.invInvoiceChallan.findUnique({
    where: { challanId },
    include: {
      challan: { select: { id: true, challanNo: true, internalSeriesNo: true, seriesFy: true } },
      invoice: {
        include: {
          party: { select: { id: true, displayName: true, state: true, gstRegistrationType: true } },
          lines: { select: { id: true, challanLineId: true, amount: true, gstRate: true, discountAmount: true } },
          _count: { select: { challans: true } },
        },
      },
    },
  })
  if (!link) {
    return NextResponse.json({
      error: 'This challan is not attached to any invoice.',
      code: 'NOT_INVOICED',
    }, { status: 404 })
  }

  const inv = link.invoice
  if (inv.status === 'PushedToTally') {
    return NextResponse.json({
      error: `Invoice ${inv.supplierInvoiceNo} is already pushed to Tally. Void the Tally voucher and the invoice first, then re-create.`,
      code: 'INVOICE_PUSHED',
      details: { invoiceId: inv.id, tallyVoucherNo: inv.tallyVoucherNo },
    }, { status: 409 })
  }
  if (inv.status === 'PushPending') {
    return NextResponse.json({
      error: `Invoice ${inv.supplierInvoiceNo} is mid-push. Wait for the push to settle or reset its status.`,
      code: 'INVOICE_PUSH_PENDING',
      details: { invoiceId: inv.id },
    }, { status: 409 })
  }
  if (inv.status === 'Voided') {
    return NextResponse.json({
      error: `Invoice ${inv.supplierInvoiceNo} is already voided — challan should already be free. Refresh.`,
      code: 'INVOICE_VOIDED',
      details: { invoiceId: inv.id },
    }, { status: 409 })
  }

  // Identify invoice lines sourced from this challan.
  const challanLines = await db.invChallanLine.findMany({
    where: { challanId },
    select: { id: true },
  })
  const challanLineIds: number[] = challanLines.map((l: any) => l.id)
  const droppingLines = inv.lines.filter((l: any) => l.challanLineId != null && challanLineIds.includes(l.challanLineId))
  const survivingLines = inv.lines.filter((l: any) => !droppingLines.some((d: any) => d.id === l.id))

  // Preserve any header-level discount that wasn't tied to a specific line.
  // headerDiscount = stored totalDiscountAmount − sum(line.discountAmount)
  const allLineDiscount = inv.lines.reduce((s: number, l: any) => s + Number(l.discountAmount || 0), 0)
  const oldTotalDiscount = Number(inv.totalDiscountAmount || 0)
  const headerDiscount = Math.max(0, +(oldTotalDiscount - allLineDiscount).toFixed(2))

  const result = await db.$transaction(async (tx: any) => {
    // 1. Drop invoice lines sourced from this challan.
    if (droppingLines.length) {
      await tx.invPurchaseInvoiceLine.deleteMany({
        where: { invoiceId: inv.id, id: { in: droppingLines.map((d: any) => d.id) } },
      })
    }
    // 2. Drop the join row.
    await tx.invInvoiceChallan.delete({ where: { challanId } })
    // 3. Flip the challan back to PendingInvoice so it can be re-attached
    //    to a different invoice. Other status fields are untouched.
    await tx.invChallan.update({
      where: { id: challanId },
      data: { status: 'PendingInvoice' },
    })

    // 4. Cascade decision. If this was the last challan on the invoice,
    //    the invoice has no purchase source left — hard-delete it (cascade
    //    kills any manually-added lines too). Otherwise recompute totals.
    const remainingLinks = inv._count.challans - 1
    if (remainingLinks <= 0) {
      // Audit before delete — we still want to remember it existed.
      await tx.invAuditLog.create({
        data: {
          action: 'INVOICE_DELETED_ON_UNLINK',
          entityType: 'InvPurchaseInvoice',
          entityId: inv.id,
          payload: {
            supplierInvoiceNo: inv.supplierInvoiceNo,
            partyId: inv.partyId,
            challanId,
            challanNo: link.challan.challanNo,
            droppedLineCount: droppingLines.length,
            manualLineCount: inv.lines.length - droppingLines.length,
            totalAmount: inv.totalAmount,
          },
        },
      })
      await tx.invPurchaseInvoice.delete({ where: { id: inv.id } })
      return {
        action: 'invoice_deleted',
        invoiceId: inv.id,
        droppedLines: droppingLines.length,
      }
    }

    // Recompute totals from survivors using the same math as create.
    const isIntra = (inv.party.state || '').toLowerCase() === KSI_STATE.toLowerCase()
    const gstTreatment = decideGstTreatment(inv.party)
    const isUnreg = gstTreatment === 'NONE'
    const linesForTotals = survivingLines.map((l: any) => ({
      amount: Number(l.amount || 0),
      gstRate: Number(l.gstRate || 0),
    }))
    const freight = Number(inv.freightAmount || 0)
    const other = Number(inv.otherCharges || 0)
    const totals = computeInvoiceTotals(linesForTotals, freight, headerDiscount, isIntra, isUnreg)
    const survivorLineDiscount = survivingLines.reduce((s: number, l: any) => s + Number(l.discountAmount || 0), 0)
    const newTotalDiscount = +(survivorLineDiscount + headerDiscount).toFixed(2)

    await tx.invPurchaseInvoice.update({
      where: { id: inv.id },
      data: {
        taxableAmount: totals.taxable,
        igstAmount: totals.igst,
        cgstAmount: totals.cgst,
        sgstAmount: totals.sgst,
        roundOff: totals.roundOff,
        totalAmount: totals.total + other,
        totalDiscountAmount: newTotalDiscount,
      },
    })

    await tx.invAuditLog.create({
      data: {
        action: 'CHALLAN_UNLINKED_FROM_INVOICE',
        entityType: 'InvPurchaseInvoice',
        entityId: inv.id,
        payload: {
          challanId,
          challanNo: link.challan.challanNo,
          challanSeries: link.challan.seriesFy && link.challan.internalSeriesNo
            ? `${link.challan.seriesFy}/${link.challan.internalSeriesNo}`
            : null,
          droppedLineCount: droppingLines.length,
          survivingLineCount: survivingLines.length,
          oldTotalAmount: inv.totalAmount,
          newTotalAmount: totals.total + other,
        },
      },
    })

    return {
      action: 'invoice_recomputed',
      invoiceId: inv.id,
      droppedLines: droppingLines.length,
      survivingLines: survivingLines.length,
      newTotals: {
        taxable: totals.taxable,
        igst: totals.igst,
        cgst: totals.cgst,
        sgst: totals.sgst,
        roundOff: totals.roundOff,
        total: totals.total + other,
        totalDiscount: newTotalDiscount,
      },
    }
  })

  return NextResponse.json({ ok: true, ...result })
}
