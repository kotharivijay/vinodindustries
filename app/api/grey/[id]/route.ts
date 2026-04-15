export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const entry = await prisma.greyEntry.findUnique({
    where: { id: parseInt(id) },
    include: { party: true, quality: true, transport: true, weaver: true },
  })
  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(entry)
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const data = await req.json()

  const entry = await prisma.greyEntry.update({
    where: { id: parseInt(id) },
    data: {
      sn: data.sn ? parseInt(data.sn) : undefined,
      date: new Date(data.date),
      challanNo: parseInt(data.challanNo),
      partyId: parseInt(data.partyId),
      qualityId: parseInt(data.qualityId),
      weight: data.weight ? data.weight.toString() : null,
      than: parseInt(data.than),
      grayMtr: data.grayMtr ? parseFloat(data.grayMtr) : null,
      transportId: parseInt(data.transportId),
      transportLrNo: data.transportLrNo || null,
      bale: data.bale ? parseInt(data.bale) : null,
      baleNo: data.baleNo || null,
      echBaleThan: data.echBaleThan ? parseFloat(data.echBaleThan) : null,
      weaverId: parseInt(data.weaverId),
      viverNameBill: data.viverNameBill || null,
      lrNo: data.lrNo || null,
      lotNo: data.lotNo,
    },
    include: { party: true, quality: true, transport: true, weaver: true },
  })
  return NextResponse.json(entry)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  await prisma.greyEntry.delete({ where: { id: parseInt(id) } })
  return NextResponse.json({ ok: true })
}
