export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { computeLineMath } from '@/lib/inv/challan-line-math'

const db = prisma as any

/**
 * Inline edit a single InvChallanLine. Accepts any subset of
 * { qty, unit, rate, gstRate, discountAmount }. Recomputes the line's
 * money columns AND the parent challan's totalQty / totalAmount /
 * totalGstAmount / totalWithGst in one transaction.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string; lineId: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const challanId = Number(params.id)
  const lineId = Number(params.lineId)

  const challan = await db.invChallan.findUnique({
    where: { id: challanId },
    select: { id: true, status: true, ratesIncludeGst: true },
  })
  if (!challan) return NextResponse.json({ error: 'Challan not found' }, { status: 404 })
  if (challan.status === 'Invoiced') {
    return NextResponse.json({ error: 'Cannot edit an invoiced challan' }, { status: 409 })
  }

  const existingLine = await db.invChallanLine.findUnique({
    where: { id: lineId },
    select: {
      id: true, challanId: true, qty: true, rate: true, gstRate: true,
      discountAmount: true, unit: true, notes: true,
    },
  })
  if (!existingLine || existingLine.challanId !== challanId) {
    return NextResponse.json({ error: 'Line not found' }, { status: 404 })
  }

  const body = await req.json()
  const next = {
    qty: body.qty !== undefined ? Number(body.qty) : Number(existingLine.qty),
    unit: body.unit !== undefined ? String(body.unit) : existingLine.unit,
    rate: body.rate !== undefined
      ? (body.rate === '' || body.rate == null ? null : Number(body.rate))
      : (existingLine.rate != null ? Number(existingLine.rate) : null),
    gstRate: body.gstRate !== undefined
      ? (body.gstRate === '' || body.gstRate == null ? null : Number(body.gstRate))
      : (existingLine.gstRate != null ? Number(existingLine.gstRate) : null),
    discountAmount: body.discountAmount !== undefined
      ? (body.discountAmount === '' || body.discountAmount == null ? null : Number(body.discountAmount))
      : (existingLine.discountAmount != null ? Number(existingLine.discountAmount) : null),
    notes: body.notes !== undefined
      ? (body.notes === '' || body.notes == null ? null : String(body.notes))
      : (existingLine.notes ?? null),
  }

  const m = computeLineMath(next, !!challan.ratesIncludeGst)

  await db.$transaction(async (tx: any) => {
    await tx.invChallanLine.update({
      where: { id: lineId },
      data: {
        qty: next.qty,
        unit: next.unit,
        rate: next.rate,
        gstRate: next.gstRate,
        discountAmount: next.discountAmount,
        notes: next.notes,
        grossAmount: m.grossAmount,
        amount: m.amount,
        gstAmount: m.gstAmount,
        totalWithGst: m.totalWithGst,
      },
    })
    // Recompute parent rollups
    const lines = await tx.invChallanLine.findMany({
      where: { challanId },
      select: { qty: true, amount: true, gstAmount: true, totalWithGst: true, rate: true },
    })
    const totalQty = lines.reduce((s: number, l: any) => s + Number(l.qty || 0), 0)
    const totalAmount = lines.reduce((s: number, l: any) => s + Number(l.amount || 0), 0)
    const totalGstAmount = lines.reduce((s: number, l: any) => s + Number(l.gstAmount || 0), 0)
    const totalWithGst = lines.reduce((s: number, l: any) => s + Number(l.totalWithGst || 0), 0)
    const hasRatelessLines = lines.some((l: any) => l.rate == null)
    await tx.invChallan.update({
      where: { id: challanId },
      data: {
        totalQty,
        totalAmount,
        totalGstAmount,
        totalWithGst,
        hasRatelessLines,
      },
    })
  })

  // Return the freshly recomputed challan + lines for the UI to swap in.
  const fresh = await db.invChallan.findUnique({
    where: { id: challanId },
    include: { lines: { include: { item: { include: { alias: true } } }, orderBy: { lineNo: 'asc' } } },
  })
  return NextResponse.json(fresh)
}
