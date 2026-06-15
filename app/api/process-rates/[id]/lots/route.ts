export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// GET /api/process-rates/[id]/lots
// The party's grey-inward lots that are candidates to attach to this contract:
//   • not yet linked to any rate contract, AND
//   • inward-dated on/after the contract's applicable (effective) date — a lot
//     that arrived before the rate was approved can't belong to it.
// Powers the "🔗 Link lots" multi-select on the register card.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = parseInt(params.id)
  if (!id) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

  const contract = await (prisma as any).processRateContract.findUnique({
    where: { id }, select: { partyId: true, version: true, effectiveFrom: true },
  })
  if (!contract) return NextResponse.json({ error: 'Contract not found' }, { status: 404 })

  const lots = await (prisma as any).greyEntry.findMany({
    where: {
      partyId: contract.partyId,
      processRateContractId: null,
      date: { gte: contract.effectiveFrom },
    },
    orderBy: { date: 'desc' },
    select: { id: true, lotNo: true, than: true, date: true },
  })

  return NextResponse.json({ partyId: contract.partyId, version: contract.version, effectiveFrom: contract.effectiveFrom, lots })
}

// PUT /api/process-rates/[id]/lots  { greyEntryIds?: number[], unlinkIds?: number[] }
// `greyEntryIds` — link these currently-unlinked lots to this contract.
// `unlinkIds`    — unlink these lots from this contract (back to the pool).
// Party-scoped, and link only touches still-unlinked lots, so this can't steal
// a lot already linked to another version; unlink only clears lots that point
// at THIS contract.
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = parseInt(params.id)
  if (!id) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

  const body = await req.json() as { greyEntryIds?: number[]; unlinkIds?: number[] }
  const linkIds = Array.isArray(body.greyEntryIds) ? body.greyEntryIds.map(Number).filter(Boolean) : []
  const unlinkIds = Array.isArray(body.unlinkIds) ? body.unlinkIds.map(Number).filter(Boolean) : []
  if (!linkIds.length && !unlinkIds.length) return NextResponse.json({ ok: true, linked: 0, unlinked: 0 })

  const contract = await (prisma as any).processRateContract.findUnique({
    where: { id }, select: { partyId: true },
  })
  if (!contract) return NextResponse.json({ error: 'Contract not found' }, { status: 404 })

  const result = await (prisma as any).$transaction(async (tx: any) => {
    const linked = linkIds.length
      ? await tx.greyEntry.updateMany({
          where: { id: { in: linkIds }, partyId: contract.partyId, processRateContractId: null },
          data: { processRateContractId: id },
        })
      : { count: 0 }
    const unlinked = unlinkIds.length
      ? await tx.greyEntry.updateMany({
          where: { id: { in: unlinkIds }, partyId: contract.partyId, processRateContractId: id },
          data: { processRateContractId: null },
        })
      : { count: 0 }
    return { linked: linked.count, unlinked: unlinked.count }
  })

  return NextResponse.json({ ok: true, ...result })
}
