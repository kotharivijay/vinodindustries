export const dynamic = 'force-dynamic'
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
          select: {
            batchNo: true,
            marka: true,
            foldProgram: { select: { foldNo: true, isPcJob: true } },
            shade: { select: { name: true, description: true } },
          },
        },
        machine: true,
        operator: true,
      },
      orderBy: { date: 'desc' },
    })

    // Enrich lots with marka from OB/Grey
    const allLotNos: string[] = entries.flatMap((e: any) => (e.lots?.length ? e.lots : [{ lotNo: e.lotNo }]).map((l: any) => l.lotNo))
    const { buildLotInfoMap } = await import('@/lib/lot-info')
    const lotInfoMap = await buildLotInfoMap([...new Set(allLotNos)])

    // Get Pali PC party names
    const paliParties = await prisma.party.findMany({ where: { tag: 'Pali PC Job' }, select: { name: true } })
    const paliNames = new Set(paliParties.map(p => p.name.toLowerCase().trim()))

    const enriched = entries.map((e: any) => {
      const lots = (e.lots?.length ? e.lots : [{ lotNo: e.lotNo, than: e.than }]).map((l: any) => {
        const info = lotInfoMap.get(l.lotNo.toLowerCase().trim())
        return { ...l, marka: info?.marka || null, party: info?.party || null, quality: info?.quality || null }
      })
      const isPali = lots.some((l: any) => {
        const info = lotInfoMap.get(l.lotNo.toLowerCase().trim())
        return info?.party && paliNames.has(info.party.toLowerCase().trim())
      })
      const lotMarka = lots.find((l: any) => l.marka)?.marka || null
      // Distinct party names across this slip's lots — usually one, sometimes
      // two for mixed-party batches.
      const partyNames = [...new Set(lots.map((l: any) => l.party).filter(Boolean))]
      return { ...e, lots, isPcJob: e.isPcJob || isPali, marka: e.marka || lotMarka, partyNames }
    })

    return NextResponse.json(enriched)
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
        isPcJob: data.isPcJob || false,
        marka: data.marka || null,
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
            foldProgram: { select: { foldNo: true, isPcJob: true } },
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
