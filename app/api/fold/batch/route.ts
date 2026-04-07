import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// PATCH /api/fold/batch — update shade or lot on a batch
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  // Update lot in a batch
  if (body.action === 'update-lot' && body.lotId) {
    const lot = await (prisma as any).foldBatchLot.update({
      where: { id: body.lotId },
      data: {
        lotNo: body.lotNo,
        than: parseInt(body.than) || 0,
        partyId: body.partyId ?? undefined,
        qualityId: body.qualityId ?? undefined,
      },
    })
    return NextResponse.json(lot)
  }

  // Update shade on a batch (existing)
  const { batchId, shadeId, shadeName, shadeDescription } = body as {
    batchId: number
    shadeId?: number | null
    shadeName?: string | null
    shadeDescription?: string | null
  }
  if (!batchId) return NextResponse.json({ error: 'batchId required' }, { status: 400 })

  const batch = await (prisma as any).foldBatch.update({
    where: { id: batchId },
    data: {
      shadeId: shadeId ?? null,
      shadeName: shadeName ?? null,
      shadeDescription: shadeDescription !== undefined ? (shadeDescription ?? null) : undefined,
    },
  })

  return NextResponse.json(batch)
}
