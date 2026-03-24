import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { appendDespatchRowToSheet, despatchEntryToSheetRow } from '@/lib/sheets'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const entries = await prisma.despatchEntry.findMany({
    include: { party: true, quality: true, transport: true },
    orderBy: { date: 'desc' },
  })

  // Include last year despatch from carry-forward data
  let lastYearDesp: any[] = []
  try {
    const db = prisma as any
    const obs = await db.lotOpeningBalance.findMany({
      include: { despatchHistory: { orderBy: { setNo: 'asc' } } },
    })
    for (const ob of obs) {
      for (const d of ob.despatchHistory) {
        if (!d.than || d.than <= 0) continue
        lastYearDesp.push({
          id: -d.id,
          date: ob.createdAt,
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
  const than = parseInt(data.than)
  const rate = data.rate ? parseFloat(data.rate) : null
  const pTotal = rate && than ? parseFloat((than * rate).toFixed(2)) : null

  // Auto-fetch qualityId from grey register by lotNo if not provided
  let qualityId = data.qualityId ? parseInt(data.qualityId) : null
  if (!qualityId && data.lotNo) {
    const greyMatch = await prisma.greyEntry.findFirst({
      where: { lotNo: { equals: data.lotNo, mode: 'insensitive' } },
      select: { qualityId: true },
    })
    qualityId = greyMatch?.qualityId ?? null
  }
  if (!qualityId) return NextResponse.json({ error: 'Quality not found for lot' }, { status: 400 })

  const db = prisma as any
  const entry = await db.despatchEntry.create({
    data: {
      date: new Date(data.date),
      challanNo: parseInt(data.challanNo),
      partyId: parseInt(data.partyId),
      qualityId,
      grayInwDate: data.grayInwDate ? new Date(data.grayInwDate) : null,
      lotNo: data.lotNo,
      jobDelivery: data.jobDelivery || null,
      than,
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
