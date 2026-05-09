export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// PATCH /api/accounts/receipts/[id]/carry-over
// Body: { carryOver: number }
//
// Sets the receipt's carryOverPriorFy to the given value (absolute, not
// additive). Validates that existing allocations on the receipt plus
// the new carry-over don't exceed the receipt amount.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = parseInt(params.id)
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })

  const { carryOver } = await req.json().catch(() => ({}))
  const value = Number(carryOver)
  if (!Number.isFinite(value) || value < 0) {
    return NextResponse.json({ error: 'carryOver must be a non-negative number' }, { status: 400 })
  }
  const v = Math.round(value * 100) / 100

  const db = prisma as any
  const receipt = await db.ksiHdfcReceipt.findUnique({
    where: { id },
    include: { allocations: true },
  })
  if (!receipt) return NextResponse.json({ error: 'Receipt not found' }, { status: 404 })

  const allocCash = (receipt.allocations || []).reduce(
    (s: number, a: any) => s + (a.allocatedAmount || 0),
    0,
  )
  if (allocCash + v > receipt.amount + 1) {
    return NextResponse.json({
      error: `carry-over ₹${v.toFixed(2)} + existing linked Bank Recpt ₹${allocCash.toFixed(2)} exceeds receipt amount ₹${receipt.amount.toFixed(2)}`,
      maxCarryOver: Math.max(0, Math.round((receipt.amount - allocCash) * 100) / 100),
    }, { status: 400 })
  }

  const updated = await db.ksiHdfcReceipt.update({
    where: { id },
    data: { carryOverPriorFy: v },
    select: { id: true, carryOverPriorFy: true },
  })
  return NextResponse.json({ ok: true, receipt: updated })
}
