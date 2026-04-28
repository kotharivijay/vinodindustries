export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

/**
 * Verify a Draft → flip status, create stock IN movements for trackStock items.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = Number(params.id)
  const c = await db.invChallan.findUnique({
    where: { id },
    include: { lines: { include: { item: true } } },
  })
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (c.status !== 'Draft' && c.status !== 'PendingApproval') {
    return NextResponse.json({ error: `Cannot verify from status ${c.status}` }, { status: 409 })
  }

  // Stock IN movements for trackStock=true items
  const movements = c.lines
    .filter((l: any) => l.item.trackStock && l.qty > 0)
    .map((l: any) => ({
      itemId: l.itemId,
      movementDate: c.challanDate,
      direction: 'IN',
      qty: l.qty,
      unit: l.unit,
      refType: 'CHALLAN',
      refId: c.id,
      remarks: `Challan ${c.challanNo}`,
    }))

  await db.$transaction([
    db.invChallan.update({
      where: { id },
      data: { status: c.hasRatelessLines ? 'PendingInvoice' : 'PendingInvoice' },
    }),
    ...(movements.length ? [db.invStockMovement.createMany({ data: movements })] : []),
  ])

  return NextResponse.json({ ok: true, movementsCreated: movements.length })
}
