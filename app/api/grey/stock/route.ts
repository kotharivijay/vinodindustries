export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// GET /api/grey/stock?lotNo=xxx
// Returns: { exists, greyThan, despatchThan, stock }
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const lotNo = req.nextUrl.searchParams.get('lotNo')?.trim()
  if (!lotNo) return NextResponse.json({ exists: false, stock: 0 })

  // RE-PRO lot? Treat its totalThan as the grey supply, despatch as
  // outflow. Drops out automatically once status flips to 'merged'.
  if (/^RE-PRO-/i.test(lotNo)) {
    try {
      const db = prisma as any
      const r = await db.reProcessLot.findFirst({
        where: { reproNo: { equals: lotNo, mode: 'insensitive' }, status: { in: ['pending', 'in-dyeing', 'finished'] } },
      })
      if (r) {
        const despAggR = await prisma.despatchEntryLot.aggregate({
          where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
          _sum: { than: true },
        })
        const despParentR = await prisma.despatchEntry.aggregate({
          where: { lotNo: { equals: lotNo, mode: 'insensitive' }, despatchLots: { none: {} } },
          _sum: { than: true },
        })
        const desp = (despAggR._sum.than ?? 0) + (despParentR._sum.than ?? 0)
        const stock = r.totalThan - desp
        return NextResponse.json({ exists: true, stock, greyThan: r.totalThan, despatchThan: desp, openingBalance: 0, obAllocated: 0, openingGrey: 0, isReProcess: true })
      }
    } catch {}
  }

  // Sum grey than for this lot
  const greyAgg = await prisma.greyEntry.aggregate({
    where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
    _sum: { than: true },
  })

  const greyThan = greyAgg._sum.than ?? 0

  // Fetch opening balance (carry-forward from last year) + deduct stage allocations
  let openingBalance = 0
  let obAllocated = 0
  try {
    const db = prisma as any
    const ob = await db.lotOpeningBalance.findFirst({
      where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
      include: { allocations: true },
    })
    if (ob) {
      openingBalance = ob.openingThan
      obAllocated = (ob.allocations || []).reduce((s: number, a: any) => s + (a.than || 0), 0)
    }
  } catch {}

  const openingGrey = Math.max(0, openingBalance - obAllocated)

  if (greyThan === 0 && openingGrey === 0) {
    return NextResponse.json({ exists: false, stock: 0, greyThan: 0, despatchThan: 0, openingBalance: 0, obAllocated })
  }

  // Sum despatch than for this lot — multi-lot aware
  const despParent = await prisma.despatchEntry.aggregate({
    where: { lotNo: { equals: lotNo, mode: 'insensitive' }, despatchLots: { none: {} } },
    _sum: { than: true },
  })
  const despChildren = await prisma.despatchEntryLot.aggregate({
    where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
    _sum: { than: true },
  })

  const despatchThan = (despParent._sum.than ?? 0) + (despChildren._sum.than ?? 0)
  const stock = openingGrey + greyThan - despatchThan

  return NextResponse.json({ exists: true, stock, greyThan, despatchThan, openingBalance, obAllocated, openingGrey })
}
