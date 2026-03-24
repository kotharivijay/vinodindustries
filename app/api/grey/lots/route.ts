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

  // Fetch opening balances (carry-forward from last year)
  let obMap = new Map<string, number>()
  try {
    const db = prisma as any
    const obs = await db.lotOpeningBalance.findMany({ select: { lotNo: true, openingThan: true } })
    obMap = new Map(obs.map((o: any) => [o.lotNo, o.openingThan]))
  } catch {}

  const lots = greyEntries
    .map(g => {
      const greyThan = g._sum.than ?? 0
      const despatchThan = despatchMap.get(g.lotNo) ?? 0
      const ob = obMap.get(g.lotNo) ?? 0
      const stock = ob + greyThan - despatchThan
      return { lotNo: g.lotNo, greyThan, despatchThan, stock, openingBalance: ob }
    })
    .filter(l => l.stock > 0) // Only lots with available stock

  // Add lots that ONLY have opening balance (no current year grey entries)
  for (const [lotNo, ob] of obMap) {
    if (!lots.some(l => l.lotNo === lotNo)) {
      const despThan = despatchMap.get(lotNo) ?? 0
      const stock = ob - despThan
      if (stock > 0) lots.push({ lotNo, greyThan: 0, despatchThan: despThan, stock, openingBalance: ob })
    }
  }

  lots.sort((a, b) => a.lotNo.localeCompare(b.lotNo))

  return NextResponse.json(lots)
}
