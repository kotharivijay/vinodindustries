export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { normalizeLotNo } from '@/lib/lot-no'

// POST /api/debug/fix-fr — fix misplaced FRs or wrong than values
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = prisma as any
  const body = await req.json()

  // Action: fix FinishEntryLot than + doneThan + parent FinishEntry than
  if (body.action === 'fix-than') {
    const { lotEntryId, correctThan } = body
    if (!lotEntryId || !correctThan) return NextResponse.json({ error: 'lotEntryId and correctThan required' }, { status: 400 })

    const lotEntry = await db.finishEntryLot.findUnique({
      where: { id: parseInt(lotEntryId) },
      include: { entry: true },
    })
    if (!lotEntry) return NextResponse.json({ error: 'FinishEntryLot not found' }, { status: 404 })

    const oldThan = lotEntry.than
    await db.finishEntryLot.update({
      where: { id: parseInt(lotEntryId) },
      data: { than: parseInt(correctThan), doneThan: parseInt(correctThan) },
    })
    await db.finishEntry.update({
      where: { id: lotEntry.entryId },
      data: { than: parseInt(correctThan) },
    })

    return NextResponse.json({
      message: `Fixed FinishEntryLot ${lotEntryId}: than ${oldThan} → ${correctThan}`,
      entryId: lotEntry.entryId,
      slipNo: lotEntry.entry.slipNo,
    })
  }

  // Action: move FR from real FP to OB entry
  const { lotNo: rawLotNo, frSlipNo, obThan } = body
  if (!rawLotNo || !frSlipNo || !obThan) return NextResponse.json({ error: 'lotNo, frSlipNo, obThan required' }, { status: 400 })
  const lotNo = normalizeLotNo(rawLotNo) ?? ''

  const fr = await db.foldingReceipt.findFirst({
    where: { slipNo: frSlipNo, lotEntry: { lotNo: { equals: lotNo, mode: 'insensitive' } } },
    include: { lotEntry: { include: { entry: true } } },
  })
  if (!fr) return NextResponse.json({ error: `FR ${frSlipNo} not found for lot ${lotNo}` }, { status: 404 })

  if (fr.lotEntry.entry.slipNo === 0) {
    return NextResponse.json({ message: 'FR already on OB entry, no fix needed', fr })
  }

  let obLotEntry = await db.finishEntryLot.findFirst({
    where: { lotNo: { equals: lotNo, mode: 'insensitive' }, entry: { slipNo: 0 } },
  })

  if (!obLotEntry) {
    const entry = await db.finishEntry.create({
      data: {
        date: fr.date,
        slipNo: 0,
        lotNo,
        than: parseInt(obThan),
        notes: 'Auto-created from OB allocation',
        lots: {
          create: {
            lotNo,
            than: parseInt(obThan),
            status: 'done',
            doneThan: parseInt(obThan),
          },
        },
      },
      include: { lots: true },
    })
    obLotEntry = entry.lots[0]
  }

  const oldEntryId = fr.lotEntryId
  const updated = await db.foldingReceipt.update({
    where: { id: fr.id },
    data: { lotEntryId: obLotEntry.id },
  })

  return NextResponse.json({
    message: `Moved FR ${frSlipNo} from FinishEntryLot ${oldEntryId} (FP-${fr.lotEntry.entry.slipNo}) to OB FinishEntryLot ${obLotEntry.id}`,
    fr: updated,
  })
}
