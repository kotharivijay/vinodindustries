export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { logDelete } from '@/lib/deleteLog'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const db = prisma as any
  let entry
  try {
    entry = await db.despatchEntry.findUnique({
      where: { id: parseInt(id) },
      include: { party: true, quality: true, transport: true, despatchLots: { include: { quality: true } }, changeLogs: { orderBy: { createdAt: 'desc' } } },
    })
  } catch {
    const raw = await prisma.despatchEntry.findUnique({
      where: { id: parseInt(id) },
      include: { party: true, quality: true, transport: true },
    })
    entry = raw ? { ...raw, changeLogs: [], despatchLots: [] } : null
  }
  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(entry)
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const entryId = parseInt(id)
  const data = await req.json()
  const db = prisma as any

  // Fetch existing entry for change tracking
  const existing = await prisma.despatchEntry.findUnique({ where: { id: entryId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Multi-lot mode
  if (data.lots?.length) {
    const lots = data.lots as { lotNo: string; qualityId: number | null; than: number; meter: number | null; rate: number | null; amount: number | null; description: string | null }[]
    const totalThan = lots.reduce((s: number, l: any) => s + (l.than || 0), 0)
    const totalMeter = lots.reduce((s: number, l: any) => s + (l.meter || 0), 0)
    const totalAmount = lots.reduce((s: number, l: any) => s + (l.amount || 0), 0)

    // Delete old despatch lots
    await db.despatchEntryLot.deleteMany({ where: { entryId } })

    // Update main entry
    const entry = await db.despatchEntry.update({
      where: { id: entryId },
      data: {
        date: new Date(data.date),
        challanNo: parseInt(data.challanNo),
        partyId: parseInt(data.partyId),
        qualityId: lots[0]?.qualityId ? parseInt(String(lots[0].qualityId)) : existing.qualityId,
        lotNo: lots[0]?.lotNo || existing.lotNo,
        than: totalThan,
        meter: totalMeter > 0 ? totalMeter : null,
        rate: lots[0]?.rate ?? null,
        pTotal: totalAmount || null,
        billNo: data.billNo || null,
        lrNo: data.lrNo || null,
        transportId: data.transportId ? parseInt(data.transportId) : null,
        bale: data.bale ? parseInt(data.bale) : null,
        despatchLots: {
          create: lots.map(l => ({
            lotNo: l.lotNo,
            than: l.than,
            meter: l.meter,
            rate: l.rate,
            amount: l.amount,
            description: l.description,
            qualityId: l.qualityId ? parseInt(String(l.qualityId)) : null,
          })),
        },
      },
      include: { party: true, quality: true, transport: true, despatchLots: { include: { quality: true } } },
    })

    return NextResponse.json(entry)
  }

  // Legacy single-lot mode
  const newThan = parseInt(data.than)
  const rate = data.rate ? parseFloat(data.rate) : null
  const newMeter = data.meter ? parseFloat(data.meter) : null
  // Amount = meter × rate when meter is provided, else than × rate
  const pTotal = rate
    ? parseFloat((((newMeter && newMeter > 0) ? newMeter : newThan) * rate).toFixed(2))
    : null
  const newLotNo = data.lotNo
  const newRate = rate
  const newBillNo = data.billNo || null

  const entry = await db.despatchEntry.update({
    where: { id: entryId },
    data: {
      date: new Date(data.date),
      challanNo: parseInt(data.challanNo),
      partyId: parseInt(data.partyId),
      qualityId: data.qualityId ? parseInt(data.qualityId) : existing.qualityId,
      grayInwDate: data.grayInwDate ? new Date(data.grayInwDate) : null,
      lotNo: newLotNo,
      jobDelivery: data.jobDelivery || null,
      than: newThan,
      meter: newMeter,
      billNo: newBillNo,
      rate: newRate,
      pTotal,
      lrNo: data.lrNo || null,
      transportId: data.transportId ? parseInt(data.transportId) : null,
      bale: data.bale ? parseInt(data.bale) : null,
      narration: data.narration || null,
    },
    include: { party: true, quality: true, transport: true },
  })

  // Track changes
  const changes: { field: string; oldValue: string; newValue: string }[] = []
  if (existing.than !== newThan) changes.push({ field: 'than', oldValue: String(existing.than), newValue: String(newThan) })
  if (existing.lotNo !== newLotNo) changes.push({ field: 'lotNo', oldValue: existing.lotNo, newValue: newLotNo })
  if ((existing.rate ?? null) !== newRate) changes.push({ field: 'rate', oldValue: String(existing.rate ?? ''), newValue: String(newRate ?? '') })
  if ((existing.billNo ?? null) !== newBillNo) changes.push({ field: 'billNo', oldValue: existing.billNo ?? '', newValue: newBillNo ?? '' })

  if (changes.length > 0) {
    try {
      await db.despatchChangeLog.createMany({
        data: changes.map(c => ({ entryId, ...c, changedBy: session.user?.email || 'unknown' }))
      })
    } catch {}
  }

  return NextResponse.json(entry)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const entryId = parseInt(id)
  const db = prisma as any
  const entry = await db.despatchEntry.findUnique({
    where: { id: entryId },
    select: { challanNo: true, lotNo: true, than: true, despatchLots: { select: { lotNo: true, than: true } } },
  })
  const lotList = entry?.despatchLots?.length ? entry.despatchLots.map((l: any) => l.lotNo).join(', ') : (entry?.lotNo ?? null)
  await logDelete({
    module: 'despatch', slipType: 'Despatch',
    slipNo: entry?.challanNo ?? null, lotNo: lotList, than: entry?.than ?? null, recordId: entryId,
    details: { lots: entry?.despatchLots ?? null },
  })
  await prisma.despatchEntry.delete({ where: { id: entryId } })
  return NextResponse.json({ ok: true })
}
