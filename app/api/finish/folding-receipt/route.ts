export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const receipts = await db.foldingReceipt.findMany({
    include: { lotEntry: { include: { entry: true } } },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(receipts)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { lotEntryId, slipNo, date, than, notes } = await req.json()
  if (!lotEntryId || !slipNo || !than) return NextResponse.json({ error: 'lotEntryId, slipNo, than required' }, { status: 400 })

  const receipt = await db.foldingReceipt.create({
    data: {
      lotEntryId: parseInt(lotEntryId),
      slipNo,
      date: date ? new Date(date) : new Date(),
      than: parseInt(than),
      notes: notes || null,
    },
  })
  return NextResponse.json(receipt, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, than, slipNo, date, notes } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const data: any = {}
  if (than !== undefined) data.than = parseInt(than)
  if (slipNo !== undefined) data.slipNo = slipNo
  if (date !== undefined) data.date = new Date(date)
  if (notes !== undefined) data.notes = notes || null

  const updated = await db.foldingReceipt.update({ where: { id: parseInt(id) }, data })
  return NextResponse.json(updated)
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await req.json()
  await db.foldingReceipt.delete({ where: { id: parseInt(id) } })
  return NextResponse.json({ ok: true })
}
