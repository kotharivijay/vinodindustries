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
  const slip = await db.checkingSlip.findUnique({
    where: { id: parseInt(id) },
    include: { lots: true },
  })
  if (!slip) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(slip)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const slipId = parseInt(id)
  const slip = await db.checkingSlip.findUnique({ where: { id: slipId }, select: { id: true } })
  if (!slip) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // CheckingSlipLot rows cascade via the FK (onDelete: Cascade in schema).
  await db.checkingSlip.delete({ where: { id: slipId } })
  return NextResponse.json({ ok: true })
}
