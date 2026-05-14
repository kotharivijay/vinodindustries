export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { appendDespatchRowToSheet, despatchEntryToSheetRow } from '@/lib/sheets'
import { normalizeLotNo } from '@/lib/lot-no'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = prisma as any
  const entries = await db.despatchEntry.findMany({
    include: { party: true, quality: true, transport: true, despatchLots: { include: { quality: true } } },
    orderBy: { date: 'desc' },
  })

  // Include last year despatch from carry-forward data
  let lastYearDesp: any[] = []
  try {
    const obs = await db.lotOpeningBalance.findMany({
      include: { despatchHistory: { orderBy: { setNo: 'asc' } } },
    })
    for (const ob of obs) {
      for (const d of ob.despatchHistory) {
        if (!d.than || d.than <= 0) continue
        lastYearDesp.push({
          id: -d.id,
          date: d.date ?? new Date('2025-03-31'),
          challanNo: parseInt(d.challanNo) || 0,
          party: { id: 0, name: ob.party || '-' },
          quality: { id: 0, name: ob.quality || '-' },
          transport: null,
          lotNo: ob.lotNo,
          than: d.than,
          billNo: d.billNo || null,
          rate: d.rate || null,
          pTotal: d.than && d.rate ? parseFloat((d.than * d.rate).toFixed(2)) : null,
          lrNo: null,
          bale: null,
          grayInwDate: null,
          jobDelivery: null,
          despatchLots: [],
          isLastYear: true,
          financialYear: ob.financialYear,
        })
      }
    }
  } catch {}

  return NextResponse.json([...entries, ...lastYearDesp])
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const data = await req.json()
  const db = prisma as any

  // Multi-lot mode
  if (data.lots && Array.isArray(data.lots) && data.lots.length > 0) {
    const firstLot = data.lots[0]

    // Resolve qualityId for the first lot (backward compat fields)
    let qualityId = firstLot.qualityId ? parseInt(firstLot.qualityId) : null
    if (!qualityId && firstLot.lotNo) {
      const greyMatch = await prisma.greyEntry.findFirst({
        where: { lotNo: { equals: firstLot.lotNo, mode: 'insensitive' } },
        select: { qualityId: true },
      })
      qualityId = greyMatch?.qualityId ?? null
    }
    if (!qualityId) return NextResponse.json({ error: 'Quality not found for first lot' }, { status: 400 })

    const totalThan = data.lots.reduce((s: number, l: any) => s + (parseInt(l.than) || 0), 0)
    const totalMeter = data.lots.reduce((s: number, l: any) => s + (parseFloat(l.meter) || 0), 0)
    const totalAmount = data.lots.reduce((s: number, l: any) => s + (parseFloat(l.amount) || 0), 0)

    const entry = await db.despatchEntry.create({
      data: {
        date: new Date(data.date),
        challanNo: parseInt(data.challanNo),
        partyId: parseInt(data.partyId),
        qualityId,
        lotNo: normalizeLotNo(firstLot.lotNo) ?? '',
        than: totalThan,
        meter: totalMeter > 0 ? totalMeter : null,
        rate: firstLot.rate ? parseFloat(firstLot.rate) : null,
        pTotal: totalAmount || null,
        billNo: data.billNo || null,
        lrNo: data.lrNo || null,
        transportId: data.transportId ? parseInt(data.transportId) : null,
        bale: data.bale ? parseInt(data.bale) : null,
        narration: data.lots.map((l: any) => l.description).filter(Boolean).join(', ') || null,
        despatchLots: {
          create: data.lots.map((l: any) => ({
            lotNo: normalizeLotNo(l.lotNo) ?? '',
            than: parseInt(l.than),
            meter: l.meter ? parseFloat(l.meter) : null,
            rate: l.rate ? parseFloat(l.rate) : null,
            amount: l.amount ? parseFloat(l.amount) : null,
            description: l.description || null,
            qualityId: l.qualityId ? parseInt(l.qualityId) : null,
          })),
        },
      },
      include: { party: true, quality: true, transport: true, despatchLots: true },
    })

    appendDespatchRowToSheet(despatchEntryToSheetRow(entry)).catch(() => {})
    return NextResponse.json(entry, { status: 201 })
  }

  // Legacy single-lot mode (backward compat for imports/sync)
  const than = parseInt(data.than)
  const rate = data.rate ? parseFloat(data.rate) : null
  const meter = data.meter ? parseFloat(data.meter) : null
  // Amount = meter × rate when meter is provided, else than × rate
  const pTotal = rate
    ? parseFloat((((meter && meter > 0) ? meter : than) * rate).toFixed(2))
    : null

  let qualityId = data.qualityId ? parseInt(data.qualityId) : null
  if (!qualityId && data.lotNo) {
    const greyMatch = await prisma.greyEntry.findFirst({
      where: { lotNo: { equals: data.lotNo, mode: 'insensitive' } },
      select: { qualityId: true },
    })
    qualityId = greyMatch?.qualityId ?? null
  }
  if (!qualityId) return NextResponse.json({ error: 'Quality not found for lot' }, { status: 400 })

  const entry = await db.despatchEntry.create({
    data: {
      date: new Date(data.date),
      challanNo: parseInt(data.challanNo),
      partyId: parseInt(data.partyId),
      qualityId,
      grayInwDate: data.grayInwDate ? new Date(data.grayInwDate) : null,
      lotNo: normalizeLotNo(data.lotNo) ?? '',
      jobDelivery: data.jobDelivery || null,
      than,
      meter,
      billNo: data.billNo || null,
      rate,
      pTotal,
      lrNo: data.lrNo || null,
      transportId: data.transportId ? parseInt(data.transportId) : null,
      bale: data.bale ? parseInt(data.bale) : null,
      narration: data.narration || null,
    },
    include: { party: true, quality: true, transport: true },
  })

  appendDespatchRowToSheet(despatchEntryToSheetRow(entry)).catch(() => {})
  return NextResponse.json(entry, { status: 201 })
}

// DELETE all — reset entire despatch table
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { confirm } = await req.json()
  if (confirm !== 'RESET_DESPATCH') return NextResponse.json({ error: 'Confirmation required' }, { status: 400 })

  const { count } = await prisma.despatchEntry.deleteMany({})
  return NextResponse.json({ deleted: count })
}
