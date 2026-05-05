export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

/**
 * Mark a Draft / PendingInvoice challan as Cash Paid (no-bill cash buy).
 * Body: { date?, note? }
 *  - 409 if status not in {Draft, PendingInvoice}
 *  - 409 if any line has returnedQty > 0 (Cash Paid implies all goods accepted)
 *  - No stock movement (goods stay in stock)
 *  - No Tally voucher (Phase-1 local-only)
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = Number(params.id)
  const body = await req.json().catch(() => ({}))
  const date = body?.date ? new Date(body.date) : new Date()
  const note: string | null = body?.note ? String(body.note) : null

  const c = await db.invChallan.findUnique({
    where: { id },
    include: { lines: { select: { returnedQty: true } } },
  })
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!['Draft', 'PendingInvoice'].includes(c.status)) {
    return NextResponse.json({ error: `Cannot mark Cash Paid — challan is ${c.status}` }, { status: 409 })
  }
  const hasReturned = c.lines.some((l: any) => Number(l.returnedQty ?? 0) > 0)
  if (hasReturned) {
    return NextResponse.json({
      error: 'Cannot mark Cash Paid — challan has partial returns. Resolve returns first.',
    }, { status: 409 })
  }

  await db.invChallan.update({
    where: { id },
    data: { status: 'CashPaid', cashPaidDate: date, cashPaidNote: note },
  })

  return NextResponse.json({ ok: true })
}
