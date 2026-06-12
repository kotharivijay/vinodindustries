export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildInvoiceTotals } from '@/lib/inv/build-invoice-totals'

const db = prisma as any

/**
 * GET /api/inv/invoice-drafts/[id]
 *
 * Returns the draft + party + soft-warn list of other open drafts that
 * already include any of this draft's challanIds. The preview page
 * surfaces that so a second operator sees "challan #42 is already in
 * draft #17" before promoting.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = Number(params.id)
  const draft = await db.invPurchaseInvoiceDraft.findUnique({
    where: { id },
    include: {
      party: { select: { id: true, displayName: true, state: true, gstRegistrationType: true } },
    },
  })
  if (!draft) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Soft-warn collisions: any OTHER open draft that shares one of our
  // challan ids. Hard locks aren't enforced (see CLAUDE notes — the
  // server-side guard happens at promote time when challan status is
  // already 'Invoiced').
  let collisions: any[] = []
  if (Array.isArray(draft.challanIds) && draft.challanIds.length) {
    collisions = await db.invPurchaseInvoiceDraft.findMany({
      where: {
        id: { not: id },
        promotedAt: null,
        challanIds: { hasSome: draft.challanIds },
      },
      select: { id: true, partyId: true, challanIds: true, updatedAt: true, party: { select: { displayName: true } } },
    })
  }

  // Also pull the linked challans' metadata so the preview can render
  // KSI/IN/FY/NNNN labels without a second round trip.
  let challans: any[] = []
  if (Array.isArray(draft.challanIds) && draft.challanIds.length) {
    challans = await db.invChallan.findMany({
      where: { id: { in: draft.challanIds } },
      select: {
        id: true, challanNo: true, challanDate: true, internalSeriesNo: true,
        seriesFy: true, status: true, totalAmount: true,
      },
      orderBy: { challanDate: 'asc' },
    })
  }

  return NextResponse.json({ ...draft, challans, collisions })
}

/**
 * PATCH /api/inv/invoice-drafts/[id]
 * Body: { challanIds?, lines?, freightAmount?, otherCharges?,
 *         discountAmount?, notes? }
 *
 * Edits a draft. Totals are recomputed from whatever the body provides;
 * fields not in the body keep their current values. Refuses to edit a
 * promoted draft (audit-only at that point).
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = Number(params.id)
  const existing = await db.invPurchaseInvoiceDraft.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.promotedAt) {
    return NextResponse.json({ error: 'Draft already promoted — edit the invoice instead' }, { status: 409 })
  }

  const body = await req.json()
  const party = await db.invParty.findUnique({ where: { id: existing.partyId } })
  if (!party) return NextResponse.json({ error: 'Party missing' }, { status: 404 })

  const merged = {
    lines: Array.isArray(body.lines) ? body.lines : (existing.lines as any[]) || [],
    freightAmount: body.freightAmount !== undefined ? body.freightAmount : existing.freightAmount,
    otherCharges: body.otherCharges !== undefined ? body.otherCharges : existing.otherCharges,
    discountAmount: body.discountAmount !== undefined ? body.discountAmount : existing.discountAmount,
  }
  const built = await buildInvoiceTotals(db, { party, ...merged })

  const updated = await db.invPurchaseInvoiceDraft.update({
    where: { id },
    data: {
      challanIds: Array.isArray(body.challanIds)
        ? body.challanIds.map((c: any) => Number(c)).filter(Number.isFinite)
        : undefined,
      lines: built.lineRows,
      freightAmount: built.freight || null,
      otherCharges: built.other || null,
      discountAmount: Number(merged.discountAmount || 0) || null,
      notes: body.notes !== undefined ? (body.notes || null) : undefined,
      gstTreatment: built.gstTreatment,
      taxableAmount: built.taxableAmount,
      igstAmount: built.igstAmount,
      cgstAmount: built.cgstAmount,
      sgstAmount: built.sgstAmount,
      totalAmount: built.totalAmount,
      hasPendingReviewItems: built.hasPendingReviewItems,
    },
  })
  return NextResponse.json(updated)
}

/**
 * DELETE /api/inv/invoice-drafts/[id]
 * Discards an unpromoted draft. Promoted drafts are preserved for audit.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = Number(params.id)
  const existing = await db.invPurchaseInvoiceDraft.findUnique({
    where: { id }, select: { id: true, promotedAt: true },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.promotedAt) {
    return NextResponse.json({ error: 'Promoted drafts cannot be discarded — they are audit history' }, { status: 409 })
  }
  await db.invPurchaseInvoiceDraft.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
