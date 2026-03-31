import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// PATCH /api/fold/batch — update shade on a batch
// body: { batchId: number; shadeId?: number | null; shadeName?: string | null }
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { batchId, shadeId, shadeName, shadeDescription } = await req.json() as {
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
