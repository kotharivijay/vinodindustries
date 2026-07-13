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

// PATCH — flip per-challan flags. Currently only { showExtraCharges: boolean }
// is accepted; extend as more toggles arrive. Doesn't touch lines / party.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const numId = parseInt(id)
  if (!Number.isFinite(numId)) return NextResponse.json({ error: 'BAD_ID' }, { status: 400 })
  const body = await req.json().catch(() => ({}))

  const data: any = {}
  if ('showExtraCharges' in body) data.showExtraCharges = !!body.showExtraCharges

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'NO_UPDATES' }, { status: 400 })
  }

  try {
    const row = await db.finishDeliveryChallan.update({
      where: { id: numId },
      data,
      include: {
        party: { select: { id: true, name: true, tag: true, gstin: true, address: true, state: true } },
        lines: { orderBy: { id: 'asc' } },
      },
    })
    return NextResponse.json(row)
  } catch (e: any) {
    if (String(e?.code) === 'P2025') return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    throw e
  }
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
