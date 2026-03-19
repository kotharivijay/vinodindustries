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

  const entry = await prisma.greyEntry.findFirst({
    where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
    orderBy: { date: 'asc' },
    select: { date: true, lotNo: true },
  })

  return NextResponse.json({ date: entry?.date ?? null, lotNo: entry?.lotNo ?? null })
}
