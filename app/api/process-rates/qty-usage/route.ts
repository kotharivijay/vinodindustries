export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// GET /api/process-rates/qty-usage?partyId=N&contractId=M[&extraThan=12]
// Cumulative grey-inward quantity booked for a party since its contract's
// effectiveFrom date — used to warn when a quantity-capped rate is exhausted.
//
// `than` is a clean integer on GreyEntry, so it's summed exactly. `mtr` sums
// grayMtr. Weight is stored as a free-text string ("106g") with no reliable
// total-kg field, so a 'kg' cap falls back to the than count and the response
// flags kgTracked:false — the UI should warn on than/mtr and note kg is
// approximate. `extraThan` lets the caller fold in the row being saved.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const partyId = parseInt(req.nextUrl.searchParams.get('partyId') ?? '')
  const contractId = parseInt(req.nextUrl.searchParams.get('contractId') ?? '')
  const extraThan = parseInt(req.nextUrl.searchParams.get('extraThan') ?? '0') || 0
  if (!partyId || !contractId) {
    return NextResponse.json({ error: 'partyId and contractId required' }, { status: 400 })
  }

  const contract = await (prisma as any).processRateContract.findUnique({
    where: { id: contractId },
    select: { effectiveFrom: true, validityQty: true, validityUnit: true, partyId: true },
  })
  if (!contract || contract.partyId !== partyId) {
    return NextResponse.json({ error: 'Contract not found for party' }, { status: 404 })
  }

  const agg = await (prisma as any).greyEntry.aggregate({
    where: { partyId, date: { gte: contract.effectiveFrom } },
    _sum: { than: true, grayMtr: true },
    _count: { _all: true },
  })

  const usedThan = (agg._sum.than ?? 0) + extraThan
  const usedMtr = agg._sum.grayMtr ?? 0
  const unit = contract.validityUnit ?? 'than'
  const used = unit === 'mtr' ? usedMtr : usedThan // kg falls back to than
  const cap = contract.validityQty != null ? Number(contract.validityQty) : null
  const exceeded = cap != null && used > cap

  return NextResponse.json({
    sinceDate: contract.effectiveFrom,
    validityUnit: unit,
    validityQty: contract.validityQty,            // string|null (decimal)
    kgTracked: unit !== 'kg',
    usedThan,
    usedMtr,
    used,
    remaining: cap != null ? Math.max(0, cap - used) : null,
    exceeded,
    entryCount: agg._count._all,
  })
}
