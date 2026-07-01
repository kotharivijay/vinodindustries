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
  const row = await db.finishDeliveryChallan.findUnique({
    where: { id: parseInt(id) },
    include: {
      party: { select: { id: true, name: true, tag: true, gstin: true, address: true, state: true } },
      lines: { orderBy: { id: 'asc' } },
    },
  })
  if (!row) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  return NextResponse.json(row)
}

// DELETE — cancel the challan and cascade its lines (each FEL becomes
// queueable again automatically).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const numId = parseInt(id)
  const row = await db.finishDeliveryChallan.findUnique({ where: { id: numId } })
  if (!row) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  await db.finishDeliveryChallan.delete({ where: { id: numId } })
  return NextResponse.json({ ok: true })
}
