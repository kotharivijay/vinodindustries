export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

/**
 * DELETE /api/accounts/sales/[id]
 *
 * Hard-deletes a KsiSalesInvoice — currently restricted to vchType=Journal
 * so the operator can clean up TDS/discount journals without touching real
 * Tally-synced Sales / Process Job / Credit Note rows.
 *
 * No linked-allocation guard: user has stated that all entries can be
 * deleted because they can re-push from Tally if needed. KsiReceiptAllocation
 * rows cascade automatically (Prisma onDelete: Cascade on the FK).
 *
 * Note: if the invoice was Tally-synced (isOpeningBalance=false), the next
 * sales sync will RE-CREATE it from Tally. To make a delete permanent for a
 * synced row, delete the source voucher in Tally first.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = Number(params.id)
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'bad id' }, { status: 400 })

  const existing = await db.ksiSalesInvoice.findUnique({
    where: { id },
    select: { id: true, vchType: true, vchNumber: true, partyName: true, totalAmount: true, isOpeningBalance: true },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (existing.vchType !== 'Journal') {
    return NextResponse.json({
      error: `Only Journal vouchers can be deleted here (this one is "${existing.vchType}"). Delete it in Tally and re-sync if needed.`,
    }, { status: 409 })
  }

  await db.ksiSalesInvoice.delete({ where: { id } })

  return NextResponse.json({
    ok: true,
    deleted: { id, vchType: existing.vchType, vchNumber: existing.vchNumber, partyName: existing.partyName, totalAmount: existing.totalAmount },
    note: existing.isOpeningBalance
      ? 'Manual opening-balance row — deletion is permanent.'
      : 'Tally-synced row — a future sales-sync will RE-CREATE this voucher from Tally. Delete it in Tally too to make this permanent.',
  })
}
