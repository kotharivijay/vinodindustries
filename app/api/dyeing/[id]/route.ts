export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { logDelete } from '@/lib/deleteLog'
import { normalizeLotNo } from '@/lib/lot-no'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  try {
    const db = prisma as any
    const entry = await db.dyeingEntry.findUnique({
      where: { id: parseInt(id) },
      include: {
        chemicals: { include: { chemical: true } },
        lots: true,
        machine: true,
        operator: true,
        additions: {
          include: { chemicals: { include: { chemical: true } }, machine: true, operator: true },
          orderBy: { roundNo: 'asc' },
        },
      },
    })
    if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(entry)
  } catch {
    // Fallback if lots table doesn't exist yet
    const entry = await prisma.dyeingEntry.findUnique({
      where: { id: parseInt(id) },
      include: { chemicals: { include: { chemical: true } } },
    })
    if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ ...entry, lots: [] })
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const data = await req.json()

  const entryId = parseInt(id)
  const db = prisma as any

  // Build lots array
  const lots = data.lots?.length
    ? data.lots.map((m: any) => ({ lotNo: normalizeLotNo(m.lotNo) ?? '', than: parseInt(m.than) || 0 }))
    : [{ lotNo: normalizeLotNo(data.lotNo) ?? '', than: parseInt(data.than) }]

  // Update main entry (backward compat: first lot's values)
  await db.dyeingEntry.update({
    where: { id: entryId },
    data: {
      date: new Date(data.date),
      slipNo: parseInt(data.slipNo),
      lotNo: lots[0].lotNo,
      than: lots[0].than,
      shadeName: data.shadeName?.trim() || null,
      notes: data.notes || null,
      machineId: data.machineId !== undefined ? (data.machineId ? parseInt(data.machineId) : null) : undefined,
      operatorId: data.operatorId !== undefined ? (data.operatorId ? parseInt(data.operatorId) : null) : undefined,
    },
  })

  // Update lots: delete old, create new
  await db.dyeingEntryLot.deleteMany({ where: { entryId } })
  if (lots.length > 0) {
    await db.dyeingEntryLot.createMany({
      data: lots.map((l: any) => ({ entryId, lotNo: l.lotNo, than: l.than })),
    })
  }

  // Update chemicals: delete old, create new
  if (data.chemicals) {
    await prisma.dyeingSlipChemical.deleteMany({ where: { entryId } })
    if (data.chemicals.length > 0) {
      await prisma.dyeingSlipChemical.createMany({
        data: data.chemicals.map((c: any) => ({
          entryId,
          chemicalId: c.chemicalId ?? null,
          name: c.name,
          quantity: c.quantity != null ? parseFloat(c.quantity) : null,
          unit: c.unit || 'kg',
          rate: c.rate != null ? parseFloat(c.rate) : null,
          cost: c.cost != null ? parseFloat(c.cost) : null,
          processTag: c.processTag || null,
        })),
      })
    }
  }

  const updated = await db.dyeingEntry.findUnique({
    where: { id: entryId },
    include: {
      chemicals: { include: { chemical: true } },
      lots: true,
      machine: true,
      operator: true,
    },
  })
  return NextResponse.json(updated)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const entryId = parseInt(id)
  const db = prisma as any
  const dye = await db.dyeingEntry.findUnique({
    where: { id: entryId },
    select: { slipNo: true, lotNo: true, than: true, lots: { select: { lotNo: true, than: true } } },
  })
  const lotList = dye?.lots?.length ? dye.lots.map((l: any) => l.lotNo).join(', ') : (dye?.lotNo ?? null)
  await logDelete({
    module: 'dyeing', slipType: 'Dye',
    slipNo: dye?.slipNo ?? null, lotNo: lotList, than: dye?.than ?? null, recordId: entryId,
    details: { lots: dye?.lots ?? null },
  })
  await prisma.dyeingEntry.delete({ where: { id: entryId } })
  return NextResponse.json({ ok: true })
}
