import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  try {
    const db = prisma as any
    const entry = await db.finishEntry.findUnique({
      where: { id: parseInt(id) },
      include: {
        chemicals: { include: { chemical: true } },
        lots: true,
        additions: { include: { chemicals: true }, orderBy: { createdAt: 'asc' } },
      },
    })
    if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(entry)
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const data = await req.json()
  const entryId = parseInt(id)
  const db = prisma as any

  const lots = data.lots?.length
    ? data.lots.map((m: any) => ({ lotNo: String(m.lotNo).trim(), than: parseInt(m.than) || 0, meter: m.meter != null ? parseFloat(m.meter) : null }))
    : [{ lotNo: String(data.lotNo || '').trim(), than: parseInt(data.than) || 0, meter: null }]

  try {
    await db.finishEntry.update({
      where: { id: entryId },
      data: {
        date: new Date(data.date),
        slipNo: parseInt(data.slipNo),
        lotNo: lots[0].lotNo,
        than: lots[0].than,
        meter: data.totalMeter != null ? parseFloat(data.totalMeter) : null,
        mandi: data.mandi != null ? parseFloat(data.mandi) : null,
        opMandi: data.opMandi != null ? parseFloat(data.opMandi) : null,
        newMandi: data.newMandi != null ? parseFloat(data.newMandi) : null,
        stockMandi: data.stockMandi != null ? parseFloat(data.stockMandi) : null,
        notes: data.notes || null,
      },
    })

    await db.finishEntryLot.deleteMany({ where: { entryId } })
    if (lots.length > 0) {
      await db.finishEntryLot.createMany({
        data: lots.map((l: any) => ({ entryId, lotNo: l.lotNo, than: l.than, meter: l.meter })),
      })
    }

    await db.finishSlipChemical.deleteMany({ where: { entryId } })
    if (data.chemicals?.length) {
      await db.finishSlipChemical.createMany({
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

    // Save additions (delete old, recreate)
    if (data.additions !== undefined) {
      // Delete old additions and their chemicals (cascade)
      const oldAdditions = await db.finishAddition.findMany({ where: { entryId }, select: { id: true } })
      for (const a of oldAdditions) {
        await db.finishAdditionChemical.deleteMany({ where: { additionId: a.id } })
      }
      await db.finishAddition.deleteMany({ where: { entryId } })

      // Create new additions
      if (data.additions?.length) {
        for (const add of data.additions) {
          const chems = (add.chemicals || []).filter((c: any) => c.quantity && parseFloat(c.quantity) > 0)
          if (chems.length === 0 && !add.reason) continue
          await db.finishAddition.create({
            data: {
              entryId,
              reason: add.reason || null,
              chemicals: {
                create: chems.map((c: any) => ({
                  chemicalId: c.chemicalId ?? null,
                  name: c.name,
                  quantity: parseFloat(c.quantity) || 0,
                  unit: c.unit || 'kg',
                })),
              },
            },
          })
        }
      }
    }

    const updated = await db.finishEntry.findUnique({
      where: { id: entryId },
      include: { chemicals: { include: { chemical: true } }, lots: true, additions: { include: { chemicals: true } } },
    })
    return NextResponse.json(updated)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const db = prisma as any
  try {
    await db.finishEntry.delete({ where: { id: parseInt(id) } })
  } catch {}
  return NextResponse.json({ ok: true })
}
