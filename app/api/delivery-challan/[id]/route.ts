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
  let row = await db.finishDeliveryChallan.findUnique({
    where: { id: parseInt(id) },
    include: {
      party: { select: { id: true, name: true, tag: true, gstin: true, address: true, state: true } },
      lines: { orderBy: { id: 'asc' } },
    },
  })
  if (!row) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  // Self-heal: any line missing its transport snapshot (older challans, or
  // ones created during a deploy race before POST learned to write it) gets
  // filled from the most recent GreyEntry for its lot. Idempotent, cheap on
  // the happy path (no work when every line already has it). One shot per
  // read means a stale challan's first print request corrects itself.
  const missing = row.lines.filter((l: any) => !l.transportName && !l.transportLrNo)
  if (missing.length) {
    const missingLots: string[] = Array.from(new Set(missing.map((l: any) => l.lotNo as string)))
    const greys = await db.greyEntry.findMany({
      where: { lotNo: { in: missingLots, mode: 'insensitive' } },
      select: {
        lotNo: true, transportLrNo: true, date: true, id: true,
        transport: { select: { name: true } },
      },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
    })
    const winner = new Map<string, { name: string | null; lrNo: string | null }>()
    for (const g of greys as any[]) {
      const k = String(g.lotNo).toLowerCase().trim()
      if (!winner.has(k)) winner.set(k, { name: g.transport?.name ?? null, lrNo: g.transportLrNo ?? null })
    }
    const updates: any[] = []
    for (const l of missing) {
      const w = winner.get(String(l.lotNo).toLowerCase().trim())
      if (!w || (!w.name && !w.lrNo)) continue
      updates.push(
        db.finishDeliveryChallanLine.update({
          where: { id: l.id },
          data: { transportName: w.name, transportLrNo: w.lrNo },
        }),
      )
    }
    if (updates.length) {
      await Promise.all(updates)
      row = await db.finishDeliveryChallan.findUnique({
        where: { id: parseInt(id) },
        include: {
          party: { select: { id: true, name: true, tag: true, gstin: true, address: true, state: true } },
          lines: { orderBy: { id: 'asc' } },
        },
      })
    }
  }

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
  if ('vehicleNo' in body) data.vehicleNo = body.vehicleNo ? String(body.vehicleNo).trim() : null
  if ('destination' in body) data.destination = body.destination ? String(body.destination).trim() : null
  if ('transport' in body) data.transport = body.transport ? String(body.transport).trim() : null
  if ('lrNo' in body) data.lrNo = body.lrNo ? String(body.lrNo).trim() : null

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
