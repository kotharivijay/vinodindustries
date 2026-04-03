import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    // Fetch batch dyeing slips (those with foldBatchId set)
    const db = prisma as any
    const entries = await db.dyeingEntry.findMany({
      where: { foldBatchId: { not: null } },
      include: {
        chemicals: { include: { chemical: true } },
        lots: true,
        foldBatch: {
          include: {
            foldProgram: { select: { foldNo: true } },
            shade: { select: { name: true, description: true } },
          },
        },
        machine: true,
        operator: true,
      },
      orderBy: { date: 'desc' },
    })

    return NextResponse.json(entries)
  } catch (err: any) {
    console.error('GET /api/dyeing/batch error:', err)
    return NextResponse.json({ error: err.message ?? 'Server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const data = await req.json()

    if (!data.date || !data.slipNo || !data.foldBatchId) {
      return NextResponse.json(
        { error: 'Date, Slip No, and Fold Batch are required.' },
        { status: 400 }
      )
    }

    // Build lots from the batch lots data
    const lots = data.lots?.length
      ? data.lots.map((l: any) => ({ lotNo: String(l.lotNo).trim(), than: parseInt(l.than) || 0 }))
      : []

    const totalThan = lots.reduce((s: number, l: any) => s + l.than, 0)

    // Build chemicals
    const chemData = data.chemicals?.length
      ? data.chemicals.map((c: any) => ({
          chemicalId: c.chemicalId ?? null,
          name: c.name,
          quantity: c.quantity != null ? parseFloat(c.quantity) : null,
          unit: c.unit || 'kg',
          rate: c.rate != null ? parseFloat(c.rate) : null,
          cost: c.cost != null ? parseFloat(c.cost) : null,
          processTag: c.processTag || null,
        }))
      : []

    const db = prisma as any

    const entry = await db.dyeingEntry.create({
      data: {
        date: new Date(data.date),
        slipNo: parseInt(data.slipNo),
        lotNo: lots[0]?.lotNo ?? '',
        than: totalThan,
        notes: data.notes || null,
        shadeName: data.shadeName || null,
        foldBatchId: parseInt(data.foldBatchId),
        machineId: data.machineId ? parseInt(data.machineId) : null,
        operatorId: data.operatorId ? parseInt(data.operatorId) : null,
        chemicals: chemData.length ? { create: chemData } : undefined,
        lots: lots.length ? { create: lots } : undefined,
      },
      include: {
        chemicals: { include: { chemical: true } },
        lots: true,
        foldBatch: {
          include: {
            foldProgram: { select: { foldNo: true } },
            shade: { select: { name: true, description: true } },
          },
        },
        machine: true,
        operator: true,
      },
    })

    return NextResponse.json(entry, { status: 201 })
  } catch (err: any) {
    console.error('POST /api/dyeing/batch error:', err)
    return NextResponse.json({ error: err.message ?? 'Server error' }, { status: 500 })
  }
}
