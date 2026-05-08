export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

/**
 * POST — flip a FoldBatch to cancelled.
 * Body: { reason?: string }
 *
 * Effect:
 *  - cancelled=true, cancelledAt=now, cancelledReason=body.reason
 *  - Linked dyeing slip(s) untouched — the slip still references this batch
 *    so its history is preserved.
 *  - Stock side: the batch's lots are excluded from the foldMap deduction
 *    in /api/stock + /api/grey/unallocated-stock + /api/fold/stock, so the
 *    than they were holding returns to the unallocated pool.
 *
 * To restore: DELETE / 'uncancel' endpoint flips the flag back.
 */
export async function POST(req: NextRequest, { params }: { params: { batchId: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = Number(params.batchId)
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid batchId' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const reason = body?.reason ? String(body.reason).trim() : null

  const existing = await db.foldBatch.findUnique({
    where: { id },
    include: { dyeingEntries: { select: { id: true, slipNo: true } } },
  })
  if (!existing) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })
  if (existing.cancelled) return NextResponse.json({ ok: true, alreadyCancelled: true })

  // Rule: batches with any linked dyeing slip cannot be cancelled. Cancelling
  // would leave the slip pointing at a stock-zero parent and confuse history.
  // Operator must move/detach the slip first (Settings → Service → Orphan
  // Dyeing Slips supports the standard relink flow).
  if (existing.dyeingEntries.length > 0) {
    const slipNos = existing.dyeingEntries.map((d: any) => d.slipNo).join(', ')
    return NextResponse.json({
      error: `Cannot cancel — ${existing.dyeingEntries.length} dyeing slip(s) still linked: ${slipNos}. Move or detach them first.`,
    }, { status: 409 })
  }

  const updated = await db.foldBatch.update({
    where: { id },
    data: { cancelled: true, cancelledAt: new Date(), cancelledReason: reason },
    select: {
      id: true, batchNo: true, cancelled: true, cancelledAt: true, cancelledReason: true,
      foldProgram: { select: { foldNo: true } },
      lots: { select: { lotNo: true, than: true } },
    },
  })

  return NextResponse.json({ ok: true, batch: updated })
}

/**
 * DELETE — uncancel (restore) a previously cancelled batch.
 * Use sparingly; the assumption is most cancellations are permanent.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { batchId: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = Number(params.batchId)
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid batchId' }, { status: 400 })

  const updated = await db.foldBatch.update({
    where: { id },
    data: { cancelled: false, cancelledAt: null, cancelledReason: null },
    select: { id: true, batchNo: true, cancelled: true },
  })
  return NextResponse.json({ ok: true, batch: updated })
}
