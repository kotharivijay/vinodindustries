import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Get all grey entries grouped by lotNo
  const greyEntries = await prisma.greyEntry.groupBy({
    by: ['lotNo'],
    _sum: { than: true },
  })

  // Get all despatch entries grouped by lotNo
  const despatchEntries = await prisma.despatchEntry.groupBy({
    by: ['lotNo'],
    _sum: { than: true },
  })

  const despatchMap = new Map(despatchEntries.map(d => [d.lotNo, d._sum.than ?? 0]))

  const lots = greyEntries
    .map(g => {
      const greyThan = g._sum.than ?? 0
      const despatchThan = despatchMap.get(g.lotNo) ?? 0
      const stock = greyThan - despatchThan
      return { lotNo: g.lotNo, greyThan, despatchThan, stock }
    })
    .filter(l => l.stock > 0) // Only lots with available stock
    .sort((a, b) => a.lotNo.localeCompare(b.lotNo))

  return NextResponse.json(lots)
}
