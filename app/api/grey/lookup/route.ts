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

  const db = prisma as any

  // Helper: calculate stock for a lot
  async function calcStock(ln: string): Promise<number> {
    const greyAgg = await prisma.greyEntry.aggregate({ where: { lotNo: { equals: ln, mode: 'insensitive' } }, _sum: { than: true } })
    const greyThan = greyAgg._sum.than ?? 0

    let obThan = 0
    try {
      const ob = await db.lotOpeningBalance.findFirst({ where: { lotNo: { equals: ln, mode: 'insensitive' } }, select: { openingThan: true } })
      obThan = ob?.openingThan ?? 0
    } catch {}

    const despAgg = await prisma.despatchEntry.aggregate({ where: { lotNo: { equals: ln, mode: 'insensitive' } }, _sum: { than: true } })
    const despThan = despAgg._sum.than ?? 0

    // Also count despatch from DespatchEntryLot
    let despLotThan = 0
    try {
      const despLots = await db.despatchEntryLot.aggregate({ where: { lotNo: { equals: ln, mode: 'insensitive' } }, _sum: { than: true } })
      despLotThan = despLots._sum?.than ?? 0
    } catch {}

    return obThan + greyThan - Math.max(despThan, despLotThan)
  }

  // Check grey entries first
  const entry = await prisma.greyEntry.findFirst({
    where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
    orderBy: { date: 'asc' },
    select: { date: true, lotNo: true, partyId: true, qualityId: true, party: { select: { name: true } }, quality: { select: { name: true } } },
  })

  if (entry) {
    const stock = await calcStock(entry.lotNo)
    return NextResponse.json({ date: entry.date, lotNo: entry.lotNo, partyId: entry.partyId, qualityId: entry.qualityId, partyName: entry.party?.name, qualityName: entry.quality?.name, stock })
  }

  // Fallback: check opening balance (carry-forward lots without grey entry)
  const ob = await db.lotOpeningBalance.findFirst({
    where: { lotNo: { equals: lotNo, mode: 'insensitive' } },
    select: { lotNo: true, party: true, quality: true, greyDate: true },
  })

  if (ob) {
    const party = ob.party ? await prisma.party.findFirst({ where: { name: { equals: ob.party, mode: 'insensitive' } } }) : null
    const quality = ob.quality ? await prisma.quality.findFirst({ where: { name: { equals: ob.quality, mode: 'insensitive' } } }) : null
    const stock = await calcStock(ob.lotNo)
    return NextResponse.json({ date: ob.greyDate ?? new Date('2025-03-31'), lotNo: ob.lotNo, partyId: party?.id ?? null, qualityId: quality?.id ?? null, partyName: ob.party, qualityName: ob.quality, stock })
  }

  return NextResponse.json({ date: null, lotNo: null, partyId: null, qualityId: null, stock: 0 })
}
