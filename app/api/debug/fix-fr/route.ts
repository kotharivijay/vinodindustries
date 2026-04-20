export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// POST /api/debug/fix-fr — move misplaced FRs from real FP to OB entry
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = prisma as any
  const { lotNo, frSlipNo, obThan } = await req.json()
  if (!lotNo || !frSlipNo || !obThan) return NextResponse.json({ error: 'lotNo, frSlipNo, obThan required' }, { status: 400 })

  // Find the misplaced FR
  const fr = await db.foldingReceipt.findFirst({
    where: { slipNo: frSlipNo, lotEntry: { lotNo: { equals: lotNo, mode: 'insensitive' } } },
    include: { lotEntry: { include: { entry: true } } },
  })
  if (!fr) return NextResponse.json({ error: `FR ${frSlipNo} not found for lot ${lotNo}` }, { status: 404 })

  if (fr.lotEntry.entry.slipNo === 0) {
    return NextResponse.json({ message: 'FR already on OB entry, no fix needed', fr })
  }

  // Check if OB finish entry (slipNo=0) exists
  let obLotEntry = await db.finishEntryLot.findFirst({
    where: { lotNo: { equals: lotNo, mode: 'insensitive' }, entry: { slipNo: 0 } },
  })

  if (!obLotEntry) {
    // Create OB FinishEntry + FinishEntryLot
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

  // Move FR to the OB lot entry
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
