export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// GET /api/process-rates/qty-usage?partyId=N&contractId=M[&extraThan=12]
// Quantity consumed against a contract = total of the grey lots LINKED to it —
// used to warn when a quantity-capped rate is exhausted, and to fill the
// register's validity bar.
//
// `than` is a clean integer on GreyEntry, so it's summed exactly. `mtr` sums
// grayMtr. Weight is stored as a free-text string ("106g") with no reliable
// total-kg field, so a 'kg' cap falls back to the than count and the response
// flags kgTracked:false — the UI should warn on than/mtr and note kg is
// approximate. `extraThan` lets the caller fold in the row being saved (it
// will link on save, so it isn't yet in the linked total).
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

  // Consumption = total of the lots actually LINKED to this contract (not the
  // party's whole inward since the date). `extraThan` lets the grey-inward save
  // check add the row being created (which will link on save) before it exists.
  const agg = await (prisma as any).greyEntry.aggregate({
    where: { processRateContractId: contractId },
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
