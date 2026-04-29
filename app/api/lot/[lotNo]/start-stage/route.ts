export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const ALLOWED = ['finish', 'folding'] as const

/**
 * Start-stage override for current-year lots that arrive already-processed
 * (e.g., already dyed) and should skip the upstream pipeline stages.
 *
 * Stored on every GreyEntry row sharing this lotNo so both the lot tracking
 * page and /api/stock can pick it up consistently.
 */
export async function GET(_req: NextRequest, { params }: { params: { lotNo: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const lotNo = decodeURIComponent(params.lotNo)
  const row = await prisma.greyEntry.findFirst({
    where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
    select: { startStage: true },
  })
  return NextResponse.json({ lotNo, stage: row?.startStage ?? null })
}

export async function POST(req: NextRequest, { params }: { params: { lotNo: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const lotNo = decodeURIComponent(params.lotNo)
  const body = await req.json().catch(() => ({}))
  let stage: string | null = body.stage ?? null
  if (stage != null && !ALLOWED.includes(stage as any)) {
    return NextResponse.json({ error: `stage must be one of ${ALLOWED.join('|')} or null` }, { status: 400 })
  }
  const result = await prisma.greyEntry.updateMany({
    where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
    data: { startStage: stage },
  })
  if (result.count === 0) return NextResponse.json({ error: 'No grey entries found for this lot' }, { status: 404 })
  return NextResponse.json({ ok: true, lotNo, stage, updatedRows: result.count })
}
