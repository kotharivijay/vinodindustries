import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let entries: any[]
  try {
    const db = prisma as any
    entries = await db.finishEntry.findMany({
      include: {
        chemicals: { include: { chemical: true } },
        lots: true,
      },
      orderBy: { date: 'desc' },
    })
  } catch {
    return NextResponse.json([])
  }

  // Enrich with party names
  const allLotNos = new Set<string>()
  for (const e of entries) {
    if (e.lots?.length) e.lots.forEach((l: any) => allLotNos.add(l.lotNo))
    else allLotNos.add(e.lotNo)
  }

  const greyWithParty = await prisma.greyEntry.findMany({
    where: { lotNo: { in: Array.from(allLotNos) } },
    select: { lotNo: true, party: { select: { name: true } } },
    distinct: ['lotNo'],
  })
  const lotPartyMap = new Map(greyWithParty.map(g => [g.lotNo, g.party.name]))

  const enriched = entries.map((e: any) => {
    const lots = e.lots?.length ? e.lots : [{ lotNo: e.lotNo, than: e.than }]
    const partyNames = [...new Set(lots.map((l: any) => lotPartyMap.get(l.lotNo)).filter(Boolean))]
    return { ...e, partyName: partyNames.join(', ') || null }
  })

  return NextResponse.json(enriched)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const data = await req.json()
  if (!data.date || !data.slipNo) {
    return NextResponse.json({ error: 'Date and Slip No are required.' }, { status: 400 })
  }

  const lots = data.marka?.length
    ? data.marka.map((m: any) => ({ lotNo: String(m.lotNo).trim(), than: parseInt(m.than) || 0, meter: m.meter != null ? parseFloat(m.meter) : null }))
    : [{ lotNo: String(data.lotNo || '').trim(), than: parseInt(data.than) || 0, meter: data.meter != null ? parseFloat(data.meter) : null }]

  const chemData = data.chemicals?.length
    ? data.chemicals.map((c: any) => ({
        chemicalId: c.chemicalId ?? null,
        name: c.name,
        quantity: c.quantity != null ? parseFloat(c.quantity) : null,
        unit: c.unit || 'kg',
        rate: c.rate != null ? parseFloat(c.rate) : null,
        cost: c.cost != null ? parseFloat(c.cost) : null,
      }))
    : []

  const db = prisma as any
  try {
    const entry = await db.finishEntry.create({
      data: {
        date: new Date(data.date),
        slipNo: parseInt(data.slipNo),
        lotNo: lots[0].lotNo,
        than: lots[0].than,
        meter: data.totalMeter != null ? parseFloat(data.totalMeter) : null,
        mandi: data.mandi != null ? parseFloat(data.mandi) : null,
        notes: data.notes || null,
        chemicals: chemData.length ? { create: chemData } : undefined,
        lots: { create: lots },
      },
      include: {
        chemicals: { include: { chemical: true } },
        lots: true,
      },
    })
    return NextResponse.json(entry, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Failed to save' }, { status: 500 })
  }
}
