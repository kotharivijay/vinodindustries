export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

// PATCH — flip a PC-RP from 'pending-approval' to 'pending' (manager gate).
// Only this transition is allowed by this endpoint; downstream transitions
// (in-fold / in-dyeing / finished / merged) are driven by their own hooks.
export async function PATCH(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const numericId = parseInt(id)
  if (!Number.isFinite(numericId)) {
    return NextResponse.json({ error: 'INVALID_ID' }, { status: 400 })
  }

  const lot = await db.pcPaliReprocessLot.findUnique({ where: { id: numericId } })
  if (!lot) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  if (lot.status !== 'pending-approval') {
    return NextResponse.json({
      error: 'INVALID_TRANSITION',
      message: `PC-RP is already in status '${lot.status}' — only 'pending-approval' can be approved.`,
    }, { status: 409 })
  }

  const updated = await db.pcPaliReprocessLot.update({
    where: { id: numericId },
    data: { status: 'pending' },
    include: {
      sources: true,
      party: { select: { name: true } },
      quality: { select: { name: true } },
    },
  })

  return NextResponse.json(updated)
}
