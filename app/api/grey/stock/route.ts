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

  // Sum grey than for this lot
  const greyAgg = await prisma.greyEntry.aggregate({
    where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
    _sum: { than: true },
  })

  const greyThan = greyAgg._sum.than ?? 0

  // Fetch opening balance (carry-forward from last year)
  let openingBalance = 0
  try {
    const db = prisma as any
    const ob = await db.lotOpeningBalance.findFirst({ where: { lotNo: { equals: lotNo, mode: 'insensitive' } } })
    if (ob) openingBalance = ob.openingThan
  } catch {}

  if (greyThan === 0 && openingBalance === 0) {
    return NextResponse.json({ exists: false, stock: 0, greyThan: 0, despatchThan: 0, openingBalance: 0 })
  }

  // Sum despatch than for this lot
  const despatchAgg = await prisma.despatchEntry.aggregate({
    where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
    _sum: { than: true },
  })

  const despatchThan = despatchAgg._sum.than ?? 0
  const stock = openingBalance + greyThan - despatchThan

  return NextResponse.json({ exists: true, stock, greyThan, despatchThan, openingBalance })
}
