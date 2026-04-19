export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = prisma as any

  const allOB = await db.lotOpeningBalance.findMany({
    orderBy: { lotNo: 'asc' },
  })

  const results = []

  for (const ob of allOB) {
    const lotNo = ob.lotNo

    const despatchEntries = await prisma.despatchEntry.findMany({
      where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
      select: { than: true, challanNo: true },
    })

    const obThan = ob.openingThan ?? 0
    const despThan = despatchEntries.reduce((s: number, e: any) => s + e.than, 0)
    const balance = obThan - despThan

    results.push({
      lotNo,
      party: ob.party,
      quality: ob.quality,
      obThan,
      despThan,
      balance,
      despCount: despatchEntries.length,
    })
  }

  results.sort((a, b) => b.balance - a.balance)

  return NextResponse.json({ total: results.length, lots: results })
}
