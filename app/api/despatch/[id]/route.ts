import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const entry = await prisma.despatchEntry.findUnique({
    where: { id: parseInt(id) },
    include: { party: true, quality: true, transport: true },
  })
  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(entry)
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const data = await req.json()
  const than = parseInt(data.than)
  const rate = data.rate ? parseFloat(data.rate) : null
  const pTotal = rate && than ? parseFloat((than * rate).toFixed(2)) : null

  const entry = await prisma.despatchEntry.update({
    where: { id: parseInt(id) },
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
  return NextResponse.json(entry)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  await prisma.despatchEntry.delete({ where: { id: parseInt(id) } })
  return NextResponse.json({ ok: true })
}
