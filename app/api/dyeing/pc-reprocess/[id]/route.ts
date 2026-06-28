export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

// GET — read one PC-RP with sources
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const lot = await db.pcPaliReprocessLot.findUnique({
    where: { id: parseInt(id) },
    include: {
      sources: { include: { sourceDyeingEntry: { select: { slipNo: true } } }, orderBy: { id: 'asc' } },
      party: { select: { name: true } },
      quality: { select: { name: true } },
    },
  })
  if (!lot) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  return NextResponse.json(lot)
}

// DELETE — hard-delete a PC-RP. Only allowed while the rework hasn't yet
// been picked into a fold batch. Cascade removes its PcPaliReprocessSource
// rows, which makes the source dye slip's finish stock auto-recover.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const numericId = parseInt(id)
  if (!Number.isFinite(numericId)) return NextResponse.json({ error: 'INVALID_ID' }, { status: 400 })

  const lot = await db.pcPaliReprocessLot.findUnique({ where: { id: numericId } })
  if (!lot) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  if (lot.status !== 'pending-approval' && lot.status !== 'pending') {
    return NextResponse.json({
      error: 'INVALID_STATE',
      message: `Cannot cancel — PC-RP is in status '${lot.status}'. Only 'pending-approval' or 'pending' can be cancelled.`,
    }, { status: 409 })
  }

  await db.pcPaliReprocessLot.delete({ where: { id: numericId } })
  return NextResponse.json({ ok: true })
}
