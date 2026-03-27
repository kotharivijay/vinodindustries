import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

function parseWeightKgPerMtr(weightStr: string | null | undefined): number {
  if (!weightStr) return 0
  const num = parseFloat(weightStr.replace(/[^0-9.]/g, ''))
  if (isNaN(num)) return 0
  const grams = num < 1 ? num * 100 : num
  return grams / 1000
}

// GET /api/grey/lot-weight?lots=PS-1234,AJ-456
// Returns weightPerThan for each lot (kg per than based on grey entry)
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const lotsParam = req.nextUrl.searchParams.get('lots')
  if (!lotsParam) return NextResponse.json({ lots: [] })

  const lotNos = lotsParam.split(',').map(l => l.trim()).filter(Boolean)

  const greyEntries = await prisma.greyEntry.findMany({
    where: { lotNo: { in: lotNos } },
    select: { lotNo: true, weight: true, grayMtr: true, than: true },
  })

  const result = lotNos.map(lotNo => {
    const entries = greyEntries.filter(g => g.lotNo === lotNo)
    let weightPerThan = 0
    let kgPerMtr = 0
    let grayMtr = 0
    for (const e of entries) {
      const w = parseWeightKgPerMtr(e.weight)
      const mtr = e.grayMtr ?? 0
      if (w > 0 && mtr > 0 && e.than > 0) {
        kgPerMtr = w
        grayMtr = mtr
        weightPerThan = Math.round((w * mtr / e.than) * 100) / 100
        break
      }
    }
    return { lotNo, weightPerThan, kgPerMtr: Math.round(kgPerMtr * 10000) / 10000, grayMtr }
  })

  return NextResponse.json({ lots: result })
}
