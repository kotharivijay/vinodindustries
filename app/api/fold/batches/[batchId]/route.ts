export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { logDelete } from '@/lib/deleteLog'

const db = prisma as any

/**
 * DELETE /api/fold/batches/[batchId] — permanently remove a fold batch.
 *
 * Works for both active and cancelled batches. Refuses (409) when any
 * dyeing slip references the batch — those would orphan via Prisma's
 * default ON DELETE SET NULL on the optional FK.
 *
 * For soft-delete (preserves audit row + can return than to pool) use
 * POST /api/fold/batches/[batchId]/cancel instead.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { batchId: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = Number(params.batchId)
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid batchId' }, { status: 400 })

  const existing = await db.foldBatch.findUnique({
    where: { id },
    include: {
      dyeingEntries: { select: { id: true, slipNo: true } },
      lots: { select: { lotNo: true, than: true } },
      foldProgram: { select: { foldNo: true } },
    },
  })
  if (!existing) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })

  if (existing.dyeingEntries.length > 0) {
    const slipNos = existing.dyeingEntries.map((d: any) => d.slipNo).join(', ')
    return NextResponse.json({
      error: `Cannot delete — ${existing.dyeingEntries.length} dyeing slip(s) still linked: ${slipNos}. Move or detach them first.`,
    }, { status: 409 })
  }

  const totalThan = (existing.lots ?? []).reduce((s: number, l: any) => s + (l.than || 0), 0)
  await logDelete({
    module: 'fold', slipType: 'FoldBatch',
    slipNo: existing.foldProgram?.foldNo ? `${existing.foldProgram.foldNo}/B${existing.batchNo}` : `B${existing.batchNo}`,
    lotNo: (existing.lots ?? []).map((l: any) => l.lotNo).join(', ') || null,
    than: totalThan || null, recordId: id,
    details: { lots: existing.lots, cancelled: existing.cancelled, cancelledReason: existing.cancelledReason },
  })

  await db.foldBatch.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
