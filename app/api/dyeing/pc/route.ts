export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = prisma as any

  const entries = await db.dyeingEntry.findMany({
    where: { isPcJob: true },
    include: {
      chemicals: { include: { chemical: true } },
      lots: true,
      machine: true,
      operator: true,
      additions: {
        include: { chemicals: true, machine: true, operator: true },
        orderBy: { roundNo: 'asc' },
      },
    },
    orderBy: { date: 'desc' },
  })

  // Enrich with party names from grey entries
  const allLotNos = new Set<string>()
  for (const e of entries) {
    if (e.lots?.length) e.lots.forEach((l: any) => allLotNos.add(l.lotNo))
    else allLotNos.add(e.lotNo)
  }

  const { buildLotInfoMap } = await import('@/lib/lot-info')
  const lotInfoMap = await buildLotInfoMap(Array.from(allLotNos))

  const enriched = entries.map((e: any) => {
    const lots = e.lots?.length ? e.lots : [{ lotNo: e.lotNo, than: e.than }]
    const partyNames = [...new Set(lots.map((l: any) => lotInfoMap.get(l.lotNo.toLowerCase().trim())?.party).filter(Boolean))]
    return { ...e, partyName: partyNames.join(', ') || null }
  })

  return NextResponse.json(enriched)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const data = await req.json()
  if (!data.date || !data.slipNo || !data.lots?.length) {
    return NextResponse.json({ error: 'Date, Slip No, and at least one lot are required.' }, { status: 400 })
  }

  const lots = data.lots.map((l: any) => ({
    lotNo: String(l.lotNo).trim(),
    than: parseInt(l.than) || 0,
  }))

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
      lotNo: lots[0].lotNo,
      than: lots[0].than,
      shadeName: data.shadeName?.trim() || null,
      notes: data.notes || null,
      machineId: data.machineId ? parseInt(data.machineId) : null,
      operatorId: data.operatorId ? parseInt(data.operatorId) : null,
      isPcJob: true,
      marka: data.marka?.trim() || null,
      partyInstructions: data.partyInstructions?.trim() || null,
      chemicals: chemData.length ? { create: chemData } : undefined,
      lots: { create: lots },
    },
    include: {
      chemicals: { include: { chemical: true } },
      lots: true,
      machine: true,
      operator: true,
    },
  })

  return NextResponse.json(entry, { status: 201 })
}
