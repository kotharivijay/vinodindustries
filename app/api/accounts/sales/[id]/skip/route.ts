export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// PATCH /api/accounts/sales/[id]/skip
// Body: { skip: boolean, reason?: string | null }
//
// Marks an invoice to be skipped (or unmarked) by the bulk-link FIFO.
// The flag is persisted on KsiSalesInvoice.skipAutoLink and survives
// Tally re-syncs because the sync route only writes sync-derived
// columns on upsert.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = parseInt(params.id)
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const skip = body?.skip === true
  const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 500) || null : null

  const db = prisma as any
  const updated = await db.ksiSalesInvoice.update({
    where: { id },
    data: skip
      ? { skipAutoLink: true, skipAutoLinkReason: reason, skipAutoLinkAt: new Date() }
      : { skipAutoLink: false, skipAutoLinkReason: null, skipAutoLinkAt: null },
    select: { id: true, skipAutoLink: true, skipAutoLinkReason: true, skipAutoLinkAt: true },
  })
  return NextResponse.json({ ok: true, invoice: updated })
}
