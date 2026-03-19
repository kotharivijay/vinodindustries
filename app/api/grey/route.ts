import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { appendRowToSheet, greyEntryToSheetRow } from '@/lib/sheets'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [entries, despatchTotals] = await Promise.all([
    prisma.greyEntry.findMany({
      include: { party: true, quality: true, transport: true, weaver: true },
      orderBy: { date: 'desc' },
    }),
    prisma.despatchEntry.groupBy({
      by: ['lotNo'],
      _sum: { than: true },
    }),
  ])

  const despatchMap = new Map(despatchTotals.map((d) => [d.lotNo, d._sum.than ?? 0]))

  const enriched = entries.map((e) => ({
    ...e,
    tDesp: despatchMap.get(e.lotNo) ?? 0,
    stock: e.than - (despatchMap.get(e.lotNo) ?? 0),
  }))

  return NextResponse.json(enriched)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const data = await req.json()

  const entry = await prisma.greyEntry.create({
    data: {
      sn: data.sn ? parseInt(data.sn) : undefined,
      date: new Date(data.date),
      challanNo: parseInt(data.challanNo),
      partyId: parseInt(data.partyId),
      qualityId: parseInt(data.qualityId),
      weight: data.weight ? data.weight.toString() : undefined,
      than: parseInt(data.than),
      grayMtr: data.grayMtr ? parseFloat(data.grayMtr) : undefined,
      transportId: parseInt(data.transportId),
      transportLrNo: data.transportLrNo || undefined,
      bale: data.bale ? parseInt(data.bale) : undefined,
      baleNo: data.baleNo || undefined,
      echBaleThan: data.echBaleThan ? parseFloat(data.echBaleThan) : undefined,
      weaverId: parseInt(data.weaverId),
      viverNameBill: data.viverNameBill || undefined,
      lrNo: data.lrNo || undefined,
      lotNo: data.lotNo,
    },
    include: { party: true, quality: true, transport: true, weaver: true },
  })

  // Auto-append to Google Sheet (non-blocking — silent if service account not configured)
  appendRowToSheet(greyEntryToSheetRow(entry)).catch(() => {})

  return NextResponse.json(entry, { status: 201 })
}
