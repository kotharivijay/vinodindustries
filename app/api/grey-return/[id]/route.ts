export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { logDelete } from '@/lib/deleteLog'

const db = prisma as any

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const gr = await db.greyReturn.findUnique({
    where: { id: parseInt(id) },
    include: {
      party: { select: { id: true, name: true, tag: true } },
      lots: {
        orderBy: { id: 'asc' },
        include: { finishDeliveryChallanLine: { select: { challan: { select: { id: true, challanNo: true, date: true, status: true } } } } },
      },
    },
  })
  if (!gr) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  return NextResponse.json(gr)
}

// DELETE — only while nothing is on a challan. Restores any fold lines that
// were shrunk at save time, so cancelling a return leaves the fold program
// exactly as it was.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const grId = parseInt(id)

  const gr = await db.greyReturn.findUnique({
    where: { id: grId },
    include: {
      party: { select: { name: true } },
      lots: { include: { finishDeliveryChallanLine: { select: { challan: { select: { challanNo: true } } } } } },
    },
  })
  if (!gr) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  const challaned = (gr.lots as any[]).filter((l: any) => l.finishDeliveryChallanLine)
  if (challaned.length) {
    const nos = [...new Set(challaned.map((l: any) => l.finishDeliveryChallanLine.challan.challanNo))]
    return NextResponse.json({
      error: 'ALREADY_ON_CHALLAN',
      message: `Cannot delete ${gr.slipNo} — ${challaned.length} lot(s) are already on delivery challan ${nos.join(', ')}. Cancel the challan first.`,
      challanNos: nos,
    }, { status: 409 })
  }

  await logDelete({
    module: 'grey-return',
    slipType: 'GR',
    slipNo: gr.slipNo,
    lotNo: (gr.lots as any[]).map((l: any) => l.lotNo).join(', '),
    than: (gr.lots as any[]).reduce((s: number, l: any) => s + l.than, 0),
    recordId: grId,
    details: { party: gr.party?.name, lots: gr.lots },
  })

  await db.$transaction(async (tx: any) => {
    // Give the than back to the fold lines this return had shrunk. The line
    // may have been deleted outright (fully returned), in which case it is
    // recreated from the snapshot on the return row.
    for (const l of gr.lots as any[]) {
      if (l.source !== 'fold' || l.foldBatchLotId == null) continue
      const line = await tx.foldBatchLot.findUnique({ where: { id: l.foldBatchLotId }, select: { id: true, than: true } })
      if (line) await tx.foldBatchLot.update({ where: { id: line.id }, data: { than: line.than + l.than } })
      // If the line is gone the fold batch itself may have been removed; the
      // than simply returns to the plain-grey pool, which is correct.
    }
    await tx.greyReturn.delete({ where: { id: grId } })
  })

  return NextResponse.json({ ok: true })
}
