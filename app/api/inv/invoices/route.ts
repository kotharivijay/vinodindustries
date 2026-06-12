export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildInvoiceTotals } from '@/lib/inv/build-invoice-totals'

const db = prisma as any

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const status = sp.get('status')
  const partyId = sp.get('partyId')
  const where: any = {}
  if (status) where.status = status
  if (partyId) where.partyId = Number(partyId)

  const invoices = await db.invPurchaseInvoice.findMany({
    where,
    include: {
      party: { select: { id: true, displayName: true, state: true, gstRegistrationType: true } },
      _count: { select: { lines: true, challans: true } },
    },
    orderBy: { supplierInvoiceDate: 'desc' },
    take: 200,
  })
  return NextResponse.json(invoices)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const {
    partyId, supplierInvoiceNo, supplierInvoiceDate,
    challanIds, lines, freightAmount, otherCharges, defaultDiscountPct, discountAmount, notes,
  } = body
  if (!partyId || !supplierInvoiceNo || !supplierInvoiceDate || !Array.isArray(lines)) {
    return NextResponse.json({ error: 'partyId, supplierInvoiceNo, supplierInvoiceDate, lines required' }, { status: 400 })
  }

  const party = await db.invParty.findUnique({ where: { id: Number(partyId) } })
  if (!party) return NextResponse.json({ error: 'Party not found' }, { status: 404 })

  const built = await buildInvoiceTotals(db, {
    party, lines, freightAmount, otherCharges, discountAmount,
  })

  try {
    const created = await db.$transaction(async (tx: any) => {
      const inv = await tx.invPurchaseInvoice.create({
        data: {
          partyId: Number(partyId),
          supplierInvoiceNo: String(supplierInvoiceNo).trim(),
          supplierInvoiceDate: new Date(supplierInvoiceDate),
          gstTreatment: built.gstTreatment,
          defaultDiscountPct: defaultDiscountPct != null ? Number(defaultDiscountPct) : null,
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
          notes: notes || null,
          lines: { create: built.lineRows },
        },
        include: { lines: true },
      })
      // Link challans + flip their status
      if (Array.isArray(challanIds) && challanIds.length) {
        await tx.invInvoiceChallan.createMany({
          data: challanIds.map((cid: number) => ({ invoiceId: inv.id, challanId: Number(cid) })),
        })
        await tx.invChallan.updateMany({
          where: { id: { in: challanIds.map((c: number) => Number(c)) } },
          data: { status: 'Invoiced' },
        })
      }
      return inv
    })
    return NextResponse.json(created)
  } catch (e: any) {
    if (e?.code === 'P2002') {
      return NextResponse.json({ error: 'Invoice already exists for this party + supplierInvoiceNo' }, { status: 409 })
    }
    throw e
  }
}
