export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const lotNo = searchParams.get('lot') || 'AJ-12930'
  const db = prisma as any

  const [ob, allocations, finishEntryLots, finishEntries] = await Promise.all([
    db.lotOpeningBalance.findFirst({
      where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
    }),
    db.lotOpeningBalanceAllocation.findMany({
      where: { balance: { lotNo: { equals: lotNo, mode: 'insensitive' } } },
      include: { balance: { select: { lotNo: true, party: true, quality: true } } },
    }),
    db.finishEntryLot.findMany({
      where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
      select: { id: true, lotNo: true, than: true, meter: true, status: true, entryId: true },
    }),
    db.finishEntry.findMany({
      where: {
        lots: { some: { lotNo: { equals: lotNo, mode: 'insensitive' } } },
      },
      select: { id: true, slipNo: true, date: true, finishDespSlipNo: true },
    }),
  ])

  const foldingReceipts = await db.foldingReceipt.findMany({
    where: { lotEntry: { lotNo: { equals: lotNo, mode: 'insensitive' } } },
    include: { lotEntry: { select: { id: true, lotNo: true, entryId: true, entry: { select: { slipNo: true } } } } },
    orderBy: { date: 'asc' },
  })

  // Check party match
  let partyMatch = null
  const partyName = ob?.party || null
  if (partyName) {
    partyMatch = await prisma.party.findFirst({ where: { name: { equals: partyName, mode: 'insensitive' } }, select: { id: true, name: true } })
  }
  // Check grey entry
  const greyEntry = await prisma.greyEntry.findFirst({
    where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
    select: { id: true, lotNo: true, partyId: true, party: { select: { name: true } } },
  })

  return NextResponse.json({
    lotNo,
    openingBalance: ob,
    allocations,
    finishEntryLots,
    finishEntries,
    foldingReceipts,
    partyInOB: partyName,
    partyMatch,
    greyEntry,
  })
}
