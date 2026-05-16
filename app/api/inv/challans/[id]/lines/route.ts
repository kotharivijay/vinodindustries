export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { computeLineMath } from '@/lib/inv/challan-line-math'

const db = prisma as any

/**
 * Add one or more new lines to an existing InvChallan. Body:
 *   { lines: [{ itemId, qty, unit?, rate?, gstRate?, discountType?, discountValue?, discountAmount?, notes? }] }
 * Recomputes parent challan rollups (totalQty / totalAmount / GST / etc.)
 * inside one transaction.
 *
 * Refuses to add lines to an Invoiced challan — matches the line-edit and
 * header-edit guards on the PUT routes.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const challanId = Number(params.id)
  const challan = await db.invChallan.findUnique({
    where: { id: challanId },
    select: { id: true, status: true, ratesIncludeGst: true },
  })
  if (!challan) return NextResponse.json({ error: 'Challan not found' }, { status: 404 })
  if (challan.status === 'Invoiced') {
    return NextResponse.json({ error: 'Cannot edit an invoiced challan' }, { status: 409 })
  }

  const body = await req.json()
  const incoming: any[] = Array.isArray(body.lines) ? body.lines : (body.line ? [body.line] : [])
  if (incoming.length === 0) {
    return NextResponse.json({ error: 'Provide at least one line' }, { status: 400 })
  }

  // Next lineNo — append after the highest existing.
  const existing = await db.invChallanLine.findMany({
    where: { challanId },
    select: { lineNo: true },
  })
  let nextLineNo = existing.reduce((m: number, l: any) => Math.max(m, l.lineNo || 0), 0)

  // Validate + materialise each new row.
  const created: any[] = []
  let hasPendingReviewItems = false
  for (const l of incoming) {
    const itemId = Number(l.itemId)
    if (!itemId) return NextResponse.json({ error: 'itemId required on every line' }, { status: 400 })
    const item = await db.invItem.findUnique({ where: { id: itemId } })
    if (!item) return NextResponse.json({ error: `Item ${itemId} not found` }, { status: 404 })
    if (item.reviewStatus === 'pending_review') hasPendingReviewItems = true

    const qty = Number(l.qty || 0)
    const rate = l.rate != null && l.rate !== '' ? Number(l.rate) : null
    // GST: caller-supplied first, else the item's alias rate so the new line
    // doesn't silently start at 0 (matches the auto-fill on existing lines).
    const aliasGst = item.aliasId
      ? (await db.invAliasItem.findUnique({ where: { id: item.aliasId }, select: { gstRate: true } }))?.gstRate
      : null
    const gstRate = l.gstRate != null && l.gstRate !== ''
      ? Number(l.gstRate)
      : (aliasGst != null ? Number(aliasGst) : null)

    let discountType = l.discountType || null
    let discountValue = l.discountValue != null && l.discountValue !== '' ? Number(l.discountValue) : null
    let discountAmount = l.discountAmount != null && l.discountAmount !== '' ? Number(l.discountAmount) : null
    if (discountType === 'PCT' && discountValue != null) {
      const gross = qty * (rate ?? 0)
      discountAmount = Math.round(gross * discountValue / 100 * 100) / 100
    }

    const m = computeLineMath(
      { qty, rate, gstRate, discountAmount },
      !!challan.ratesIncludeGst,
    )

    nextLineNo++
    created.push({
      challanId,
      lineNo: nextLineNo,
      itemId: item.id,
      poLineId: l.poLineId ? Number(l.poLineId) : null,
      qty,
      unit: l.unit || item.unit,
      rate,
      gstRate,
      discountType,
      discountValue,
      discountAmount,
      grossAmount: m.grossAmount,
      amount: m.amount,
      gstAmount: m.gstAmount,
      totalWithGst: m.totalWithGst,
      notes: l.notes || null,
    })
  }

  await db.$transaction(async (tx: any) => {
    await tx.invChallanLine.createMany({ data: created })
    // Recompute parent rollups from ALL lines (existing + new).
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
        ...(hasPendingReviewItems ? { hasPendingReviewItems: true } : {}),
      },
    })
  })

  const fresh = await db.invChallan.findUnique({
    where: { id: challanId },
    include: { lines: { include: { item: { include: { alias: true } } }, orderBy: { lineNo: 'asc' } } },
  })
  return NextResponse.json(fresh, { status: 201 })
}
