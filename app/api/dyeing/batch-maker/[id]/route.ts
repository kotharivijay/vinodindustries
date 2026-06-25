export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const slip = await db.batchMakingSlip.findUnique({
    where: { id: parseInt(id) },
    include: {
      batches: {
        include: {
          foldBatch: {
            include: {
              lots: true,
              foldProgram: { select: { foldNo: true, date: true } },
              // Live shade master (for the case where FoldBatch only carries
              // shadeId without the free-text override).
              shade: { select: { name: true, description: true } },
              // Newest dyeing entry first — its shade / marka / slipNo win
              // over the BM snapshot per the codebase's read priority
              // (DyeingEntry → FoldBatch → Shade). Multiple entries exist
              // when a batch is re-dyed.
              dyeingEntries: {
                orderBy: [{ date: 'desc' }, { id: 'desc' }],
                select: {
                  id: true, slipNo: true, date: true, status: true,
                  shadeName: true, shadeDescription: true, marka: true,
                },
              },
            },
          },
        },
      },
    },
  })
  if (!slip) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // FoldBatchLot carries no marka — it lives on GreyEntry, keyed by lotNo.
  // Attach a comma-joined `marka` per lot so the print shows the grey marka
  // under each lot line (matches /api/dyeing/batch-maker GET enrichment).
  const lotNos = new Set<string>()
  for (const b of slip.batches ?? [])
    for (const l of b.foldBatch?.lots ?? [])
      if (l.lotNo) lotNos.add(l.lotNo)
  if (lotNos.size > 0) {
    const greyMeta = await prisma.greyEntry.findMany({
      where: { lotNo: { in: Array.from(lotNos) } },
      select: { lotNo: true, marka: true },
    })
    const markaMap = new Map<string, Set<string>>()
    for (const g of greyMeta) {
      if (!g.marka) continue
      const k = g.lotNo.toLowerCase()
      if (!markaMap.has(k)) markaMap.set(k, new Set())
      markaMap.get(k)!.add(g.marka)
    }
    for (const b of slip.batches ?? [])
      for (const l of b.foldBatch?.lots ?? [])
        l.marka = Array.from(markaMap.get((l.lotNo || '').toLowerCase()) || []).join(', ') || null
  }

  return NextResponse.json(slip)
}

// Soft cancel: flip slip status + cascade to all batch link rows so the
// partial unique index drops the foldBatchIds from the active set. The slip
// row + serial remain so the BM-N series stays gap-free.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const slipId = parseInt(id)
  const body = await req.json().catch(() => ({}))
  const action = String(body?.action ?? '').trim()

  if (action !== 'cancel') {
    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
  }

  const slip = await db.batchMakingSlip.findUnique({
    where: { id: slipId },
    select: { id: true, status: true },
  })
  if (!slip) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (slip.status === 'cancelled') {
    return NextResponse.json({ error: 'Already cancelled' }, { status: 400 })
  }

  const updated = await db.$transaction(async (tx: any) => {
    await tx.batchMakingSlip.update({
      where: { id: slipId },
      data: { status: 'cancelled' },
    })
    await tx.batchMakingSlipBatch.updateMany({
      where: { slipId },
      data: { slipStatus: 'cancelled' },
    })
    return tx.batchMakingSlip.findUnique({
      where: { id: slipId },
      include: { batches: true },
    })
  })

  return NextResponse.json(updated)
}
