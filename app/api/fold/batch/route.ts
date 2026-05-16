export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { normalizeLotNo } from '@/lib/lot-no'

// PATCH /api/fold/batch — update shade or lot on a batch
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  // Update lot in a batch
  if (body.action === 'update-lot' && body.lotId) {
    const db = prisma as any
    const oldLot = await db.foldBatchLot.findUnique({ where: { id: body.lotId }, select: { lotNo: true, than: true, foldBatchId: true } })

    // Look up party + quality from grey entry for this lot. Case-insensitive:
    // body.lotNo casing can differ from GreyEntry's.
    const greyEntry = await prisma.greyEntry.findFirst({
      where: { lotNo: { equals: body.lotNo, mode: 'insensitive' } },
      select: { partyId: true, qualityId: true },
    })

    const lot = await db.foldBatchLot.update({
      where: { id: body.lotId },
      data: {
        lotNo: normalizeLotNo(body.lotNo) ?? '',
        than: parseInt(body.than) || 0,
        partyId: greyEntry?.partyId ?? null,
        qualityId: greyEntry?.qualityId ?? null,
      },
    })

    // Cascade: update linked DyeingEntryLot if a DyeingEntry is linked to this fold batch
    if (oldLot?.foldBatchId) {
      try {
        const dyeEntry = await db.dyeingEntry.findFirst({
          where: { foldBatchId: oldLot.foldBatchId },
          select: { id: true },
        })
        if (dyeEntry) {
          // Update the matching DyeingEntryLot (same old lotNo)
          await db.dyeingEntryLot.updateMany({
            where: { entryId: dyeEntry.id, lotNo: { equals: oldLot.lotNo, mode: 'insensitive' } },
            data: { lotNo: normalizeLotNo(body.lotNo) ?? '', than: parseInt(body.than) || 0 },
          })
        }
      } catch {}
    }

    return NextResponse.json(lot)
  }

  // Update shade on a batch (existing). Only touch fields the client
  // explicitly sent — sending just shadeDescription should NOT clear the
  // selected shadeId / shadeName (was the bug — bare PATCH wiped them).
  const { batchId, shadeId, shadeName, shadeDescription } = body as {
    batchId: number
    shadeId?: number | null
    shadeName?: string | null
    shadeDescription?: string | null
  }
  if (!batchId) return NextResponse.json({ error: 'batchId required' }, { status: 400 })

  const data: any = {}
  if (Object.prototype.hasOwnProperty.call(body, 'shadeId')) data.shadeId = shadeId ?? null
  if (Object.prototype.hasOwnProperty.call(body, 'shadeName')) data.shadeName = shadeName ?? null
  if (Object.prototype.hasOwnProperty.call(body, 'shadeDescription')) data.shadeDescription = shadeDescription ?? null
  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 })

  const batch = await (prisma as any).foldBatch.update({
    where: { id: batchId },
    data,
  })

  return NextResponse.json(batch)
}
