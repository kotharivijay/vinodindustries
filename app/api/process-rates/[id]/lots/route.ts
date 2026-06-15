export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// GET /api/process-rates/[id]/lots
// The party's grey-inward lots that are NOT yet linked to any rate contract —
// the candidates to attach to this contract. Powers the "🔗 Link lots"
// multi-select on the register card.
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
    where: { partyId: contract.partyId, processRateContractId: null },
    orderBy: { date: 'desc' },
    select: { id: true, lotNo: true, than: true, date: true },
  })

  return NextResponse.json({ partyId: contract.partyId, version: contract.version, effectiveFrom: contract.effectiveFrom, lots })
}

// PUT /api/process-rates/[id]/lots  { greyEntryIds: number[] }
// Links the selected (currently-unlinked) lots to this contract. Party-scoped
// so a stray id can't touch another party's lot; only lots that are still
// unlinked are moved, so this can't steal a lot already linked elsewhere.
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = parseInt(params.id)
  if (!id) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

  const { greyEntryIds } = await req.json() as { greyEntryIds: number[] }
  const ids = Array.isArray(greyEntryIds) ? greyEntryIds.map(Number).filter(Boolean) : []
  if (!ids.length) return NextResponse.json({ ok: true, linked: 0 })

  const contract = await (prisma as any).processRateContract.findUnique({
    where: { id }, select: { partyId: true },
  })
  if (!contract) return NextResponse.json({ error: 'Contract not found' }, { status: 404 })

  const linked = await (prisma as any).greyEntry.updateMany({
    where: { id: { in: ids }, partyId: contract.partyId, processRateContractId: null },
    data: { processRateContractId: id },
  })

  return NextResponse.json({ ok: true, linked: linked.count })
}
