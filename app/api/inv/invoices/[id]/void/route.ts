export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

/**
 * Voiding an invoice frees its linked challans back to PendingInvoice and
 * removes the join rows. The original Tally voucher is NOT auto-reversed —
 * accountant decides per the PRD's Phase 2 note.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = Number(params.id)
  const inv = await db.invPurchaseInvoice.findUnique({
    where: { id },
    include: { challans: true },
  })
  if (!inv) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const challanIds = inv.challans.map((c: any) => c.challanId)
  await db.$transaction([
    db.invInvoiceChallan.deleteMany({ where: { invoiceId: id } }),
    challanIds.length
      ? db.invChallan.updateMany({ where: { id: { in: challanIds } }, data: { status: 'PendingInvoice' } })
      : db.$executeRaw`SELECT 1`,
    db.invPurchaseInvoice.update({ where: { id }, data: { status: 'Voided' } }),
  ])
  return NextResponse.json({ ok: true, freedChallans: challanIds.length })
}
