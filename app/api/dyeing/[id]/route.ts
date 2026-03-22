import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const db = prisma as any
  const entry = await db.dyeingEntry.findUnique({
    where: { id: parseInt(id) },
    include: {
      chemicals: { include: { chemical: true } },
      lots: true,
    },
  })
  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(entry)
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
    ? data.lots.map((m: any) => ({ lotNo: String(m.lotNo).trim(), than: parseInt(m.than) || 0 }))
    : [{ lotNo: String(data.lotNo).trim(), than: parseInt(data.than) }]

  const totalThan = lots.reduce((s: number, l: any) => s + l.than, 0)

  // Update main entry
  await db.dyeingEntry.update({
    where: { id: entryId },
    data: {
      date: new Date(data.date),
      slipNo: parseInt(data.slipNo),
      lotNo: lots[0].lotNo,
      than: totalThan,
      notes: data.notes || null,
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
        })),
      })
    }
  }

  const updated = await db.dyeingEntry.findUnique({
    where: { id: entryId },
    include: {
      chemicals: { include: { chemical: true } },
      lots: true,
    },
  })
  return NextResponse.json(updated)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  await prisma.dyeingEntry.delete({ where: { id: parseInt(id) } })
  return NextResponse.json({ ok: true })
}
