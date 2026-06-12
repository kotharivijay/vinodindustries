export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildInvoiceTotals } from '@/lib/inv/build-invoice-totals'

const db = prisma as any

/**
 * GET /api/inv/invoice-drafts
 * Query: ?partyId= ?includePromoted=1
 *
 * Default filter hides promoted drafts (they're audit-only); flip
 * includePromoted to surface them in the list page's history view.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const partyId = sp.get('partyId')
  const includePromoted = sp.get('includePromoted') === '1'

  const where: any = {}
  if (partyId) where.partyId = Number(partyId)
  if (!includePromoted) where.promotedAt = null

  const drafts = await db.invPurchaseInvoiceDraft.findMany({
    where,
    include: {
      party: { select: { id: true, displayName: true, state: true, gstRegistrationType: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  })
  return NextResponse.json(drafts)
}

/**
 * POST /api/inv/invoice-drafts
 * Body: { partyId, challanIds[], lines[], freightAmount?, otherCharges?,
 *         discountAmount?, notes? }
 *
 * Creates a new draft. Lines are server-recomputed (gstRate auto-fills
 * from item.alias when absent, totals via the shared helper). The
 * supplier invoice number is intentionally NOT accepted here — it's
 * stamped at promote time.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { partyId, challanIds, lines, freightAmount, otherCharges, discountAmount, notes } = body
  if (!partyId || !Array.isArray(lines)) {
    return NextResponse.json({ error: 'partyId and lines required' }, { status: 400 })
  }
  const party = await db.invParty.findUnique({ where: { id: Number(partyId) } })
  if (!party) return NextResponse.json({ error: 'Party not found' }, { status: 404 })

  const built = await buildInvoiceTotals(db, { party, lines, freightAmount, otherCharges, discountAmount })

  const draft = await db.invPurchaseInvoiceDraft.create({
    data: {
      partyId: Number(partyId),
      challanIds: Array.isArray(challanIds) ? challanIds.map((c: any) => Number(c)).filter(Number.isFinite) : [],
      lines: built.lineRows,
      freightAmount: built.freight || null,
      otherCharges: built.other || null,
      discountAmount: Number(discountAmount || 0) || null,
      notes: notes || null,
      gstTreatment: built.gstTreatment,
      taxableAmount: built.taxableAmount,
      igstAmount: built.igstAmount,
      cgstAmount: built.cgstAmount,
      sgstAmount: built.sgstAmount,
      totalAmount: built.totalAmount,
      hasPendingReviewItems: built.hasPendingReviewItems,
    },
  })
  return NextResponse.json(draft)
}
