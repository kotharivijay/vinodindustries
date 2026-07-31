export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// Detach specific challans from a payment. Body: { removeEntryIds: number[] }
// Deletes the payment when nothing remains attached.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const paymentId = parseInt(id)
  const data = await req.json()
  const removeIds: number[] = Array.isArray(data.removeEntryIds)
    ? data.removeEntryIds.map((x: any) => parseInt(x)).filter((x: number) => Number.isFinite(x))
    : []
  if (!removeIds.length) return NextResponse.json({ error: 'removeEntryIds required' }, { status: 400 })

  const db = prisma as any
  await db.despatchEntry.updateMany({
    where: { id: { in: removeIds }, transportPaymentId: paymentId },
    data: { transportPaymentId: null },
  })
  const remaining = await db.despatchEntry.count({ where: { transportPaymentId: paymentId } })
  if (remaining === 0) {
    await db.transportPayment.delete({ where: { id: paymentId } })
    return NextResponse.json({ ok: true, paymentDeleted: true })
  }
  return NextResponse.json({ ok: true, remaining })
}

// Delete a payment voucher entirely — its challans revert to unpaid (FK SetNull).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const db = prisma as any
  try {
    await db.transportPayment.delete({ where: { id: parseInt(id) } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Delete failed' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
