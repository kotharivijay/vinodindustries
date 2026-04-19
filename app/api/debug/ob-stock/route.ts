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

    const [greyEntries, despatchEntries] = await Promise.all([
      prisma.greyEntry.findMany({
        where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
        select: { than: true },
      }),
      prisma.despatchEntry.findMany({
        where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
        select: { than: true },
      }),
    ])

    const obThan = ob.openingThan ?? 0
    const greyThan = greyEntries.reduce((s: number, e: any) => s + e.than, 0)
    const despThan = despatchEntries.reduce((s: number, e: any) => s + e.than, 0)
    const currentBalance = obThan + greyThan - despThan
    const expectedBalance = obThan - despThan

    if (currentBalance !== expectedBalance) {
      results.push({
        lotNo,
        obThan,
        greyThan,
        despThan,
        currentBalance,
        expectedBalance,
        diff: currentBalance - expectedBalance,
      })
    }
  }

  return NextResponse.json({ total: results.length, lots: results })
}
