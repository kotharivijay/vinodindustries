import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// GET /api/grey/lookup?lotNo=xxx — returns first grey entry for that lot (date only)
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const lotNo = req.nextUrl.searchParams.get('lotNo')?.trim()
  if (!lotNo) return NextResponse.json({ date: null })

  // Check grey entries first
  const entry = await prisma.greyEntry.findFirst({
    where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
    orderBy: { date: 'asc' },
    select: { date: true, lotNo: true },
  })

  if (entry) {
    return NextResponse.json({ date: entry.date, lotNo: entry.lotNo })
  }

  // Fallback: check opening balance (carry-forward lots without grey entry)
  const db = prisma as any
  const ob = await db.lotOpeningBalance.findFirst({
    where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
    select: { lotNo: true },
  })

  if (ob) {
    return NextResponse.json({ date: new Date('2025-03-31'), lotNo: ob.lotNo })
  }

  return NextResponse.json({ date: null, lotNo: null })
}
