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

  // Fetch opening balances (carry-forward from last year)
  let obMap = new Map<string, number>()
  try {
    const db = prisma as any
    const obs = await db.lotOpeningBalance.findMany({ select: { lotNo: true, openingThan: true } })
    obMap = new Map(obs.map((o: any) => [o.lotNo.toLowerCase(), o.openingThan]))
  } catch {}

  const enriched = entries.map((e) => {
    const ob = obMap.get(e.lotNo.toLowerCase()) ?? 0
    return {
      ...e,
      tDesp: despatchMap.get(e.lotNo) ?? 0,
      stock: ob + e.than - (despatchMap.get(e.lotNo) ?? 0),
      openingBalance: ob,
    }
  })

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

// DELETE all — reset entire grey table
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { confirm } = await req.json().catch(() => ({}))
  if (confirm !== 'RESET_GREY') {
    return NextResponse.json({ error: 'Confirmation required: send { confirm: "RESET_GREY" }' }, { status: 400 })
  }

  await prisma.greyEntry.deleteMany({})
  return NextResponse.json({ ok: true, message: 'All grey entries deleted' })
}
