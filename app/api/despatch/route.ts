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
  return NextResponse.json(entries)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const data = await req.json()
  const than = parseInt(data.than)
  const rate = data.rate ? parseFloat(data.rate) : null
  const pTotal = rate && than ? parseFloat((than * rate).toFixed(2)) : null

  const entry = await prisma.despatchEntry.create({
    data: {
      date: new Date(data.date),
      challanNo: parseInt(data.challanNo),
      partyId: parseInt(data.partyId),
      qualityId: parseInt(data.qualityId),
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
    },
    include: { party: true, quality: true, transport: true },
  })

  appendDespatchRowToSheet(despatchEntryToSheetRow(entry)).catch(() => {})
  return NextResponse.json(entry, { status: 201 })
}
