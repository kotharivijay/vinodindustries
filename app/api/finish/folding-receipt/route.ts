export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { logDelete } from '@/lib/deleteLog'
import { normalizeLotNo } from '@/lib/lot-no'

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

  const { lotEntryId, slipNo, date, than, notes, obLotNo, obThan } = await req.json()
  if (!slipNo || !than) return NextResponse.json({ error: 'slipNo and than required' }, { status: 400 })

  let resolvedLotEntryId = lotEntryId ? parseInt(lotEntryId) : null

  // For OB lots: auto-create FinishEntry + FinishEntryLot
  if (!resolvedLotEntryId && obLotNo) {
    // Check if a "OB" finish entry (slipNo=0) already exists for this lot.
    // Case-insensitive: obLotNo comes from the request body and its casing
    // may differ from the existing FinishEntryLot — a case-sensitive match
    // would create a duplicate slipNo=0 entry instead of reusing it.
    const existing = await db.finishEntryLot.findFirst({
      where: { lotNo: { equals: obLotNo, mode: 'insensitive' }, entry: { slipNo: 0 } },
      include: { entry: true },
    })
    if (existing) {
      resolvedLotEntryId = existing.id
    } else {
      // Create a new FinishEntry with slipNo=0 for OB
      const entry = await db.finishEntry.create({
        data: {
          date: date ? new Date(date) : new Date(),
          slipNo: 0,
          lotNo: normalizeLotNo(obLotNo) ?? '',
          than: parseInt(obThan) || parseInt(than),
          notes: 'Auto-created from OB allocation',
          lots: {
            create: {
              lotNo: normalizeLotNo(obLotNo) ?? '',
              than: parseInt(obThan) || parseInt(than),
              status: 'done',
              doneThan: parseInt(obThan) || parseInt(than),
            },
          },
        },
        include: { lots: true },
      })
      resolvedLotEntryId = entry.lots[0].id
    }
  }

  if (!resolvedLotEntryId) return NextResponse.json({ error: 'lotEntryId or obLotNo required' }, { status: 400 })

  const receipt = await db.foldingReceipt.create({
    data: {
      lotEntryId: resolvedLotEntryId,
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
  const recId = parseInt(id)
  const fr = await db.foldingReceipt.findUnique({
    where: { id: recId },
    select: { slipNo: true, than: true, lotEntry: { select: { lotNo: true, entry: { select: { slipNo: true } } } } },
  })
  await logDelete({
    module: 'folding-receipt', slipType: 'FR',
    slipNo: fr?.slipNo ?? null, lotNo: fr?.lotEntry?.lotNo ?? null, than: fr?.than ?? null, recordId: recId,
    details: { fpSlipNo: fr?.lotEntry?.entry?.slipNo ?? null },
  })
  await db.foldingReceipt.delete({ where: { id: recId } })
  return NextResponse.json({ ok: true })
}
