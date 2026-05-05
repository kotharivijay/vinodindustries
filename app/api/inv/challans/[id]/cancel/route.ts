export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

/**
 * Soft-cancel a challan. Series number is retained (gap-free governance).
 * Stock IN movements are reversed (OUT) so net stock is correct.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = Number(params.id)
  const { reason } = await req.json().catch(() => ({}))
  const c = await db.invChallan.findUnique({
    where: { id },
    include: { lines: { include: { item: true } }, invoiceLink: true },
  })
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (c.status === 'Invoiced' || c.invoiceLink) {
    return NextResponse.json({ error: 'Cannot cancel — challan is on a pushed invoice' }, { status: 409 })
  }

  // Effective qty = qty - returnedQty. Returns already issued OUT movements;
  // cancel only needs to OUT what's still in stock (the unreturned remainder).
  const reversals = c.lines
    .filter((l: any) => l.item.trackStock)
    .map((l: any) => ({
      itemId: l.itemId,
      effective: Math.max(0, Number(l.qty) - Number(l.returnedQty ?? 0)),
      unit: l.unit,
    }))
    .filter((r: any) => r.effective > 0)
    .map((r: any) => ({
      itemId: r.itemId,
      movementDate: new Date(),
      direction: 'OUT',
      qty: r.effective,
      unit: r.unit,
      refType: 'CHALLAN',
      refId: c.id,
      remarks: `Cancel challan ${c.challanNo}`,
    }))

  await db.$transaction([
    db.invChallan.update({
      where: { id },
      data: { status: 'Cancelled', cancelledReason: reason || null },
    }),
    ...(reversals.length ? [db.invStockMovement.createMany({ data: reversals })] : []),
  ])

  return NextResponse.json({ ok: true })
}
