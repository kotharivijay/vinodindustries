import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = prisma as any

  // Current year qualities from GreyEntry → Quality
  const qualities = await prisma.quality.findMany({
    select: { name: true },
    orderBy: { name: 'asc' },
  })
  const currentYearNames = new Set(qualities.map(q => q.name.trim()))

  // Carry-forward lot qualities from LotOpeningBalance
  try {
    const cfLots = await db.lotOpeningBalance.findMany({
      where: { quality: { not: null } },
      select: { quality: true },
      distinct: ['quality'],
    })
    for (const cf of cfLots) {
      if (cf.quality?.trim()) currentYearNames.add(cf.quality.trim())
    }
  } catch {}

  const sorted = Array.from(currentYearNames).sort((a, b) => a.localeCompare(b))
  return NextResponse.json(sorted)
}
