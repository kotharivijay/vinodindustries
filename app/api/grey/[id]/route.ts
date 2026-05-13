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
      weaverId: data.weaverId != null && data.weaverId !== '' ? parseInt(data.weaverId) : null,
      viverNameBill: data.viverNameBill || null,
      lrNo: data.lrNo || null,
      lotNo: data.lotNo,
      marka: data.marka != null ? (data.marka.trim() || null) : undefined,
    },
    include: { party: true, quality: true, transport: true, weaver: true },
  })
  return NextResponse.json(entry)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const entryId = parseInt(id)
  const entry = await prisma.greyEntry.findUnique({
    where: { id: entryId },
    select: { challanNo: true, lotNo: true, than: true },
  })
  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Block deletion if the lot has any downstream activity. Most downstream
  // tables store lotNo as a plain string (no FK), so the DB won't refuse the
  // delete — we enforce it here. CheckingSlipLot is FK'd to greyEntryId
  // directly, so we can pinpoint the exact bale row.
  const db = prisma as any
  const lotNo = entry.lotNo
  const [
    checkingByRow,
    foldBatch, foldSlip,
    dyeing, finish,
    packing,
    despatchParent, despatchLot,
  ] = await Promise.all([
    db.checkingSlipLot.count({ where: { greyEntryId: entryId } }),
    db.foldBatchLot.count({ where: { lotNo } }),
    db.foldingSlipLot.count({ where: { lotNo } }),
    db.dyeingEntryLot.count({ where: { lotNo } }),
    db.finishEntryLot.count({ where: { lotNo } }),
    db.packingLot.count({ where: { lotNo } }),
    db.despatchEntry.count({ where: { lotNo, despatchLots: { none: {} } } }),
    db.despatchEntryLot.count({ where: { lotNo } }),
  ])

  const blockers: string[] = []
  if (checkingByRow) blockers.push(`Checking slip (${checkingByRow})`)
  if (foldBatch)     blockers.push(`Fold batch (${foldBatch})`)
  if (foldSlip)      blockers.push(`Folding slip (${foldSlip})`)
  if (dyeing)        blockers.push(`Dyeing slip (${dyeing})`)
  if (finish)        blockers.push(`Finish slip (${finish})`)
  if (packing)       blockers.push(`Packing slip (${packing})`)
  if (despatchParent + despatchLot) blockers.push(`Despatch (${despatchParent + despatchLot})`)

  if (blockers.length > 0) {
    return NextResponse.json({
      error: `Cannot delete lot ${lotNo} — it is already used in: ${blockers.join(', ')}. Remove those entries first.`,
      blockers,
    }, { status: 409 })
  }

  await logDelete({
    module: 'grey', slipType: 'Grey', slipNo: entry.challanNo,
    lotNo: entry.lotNo, than: entry.than, recordId: entryId,
  })
  await prisma.greyEntry.delete({ where: { id: entryId } })
  return NextResponse.json({ ok: true })
}
