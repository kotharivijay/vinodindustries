export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const slips = await db.checkingSlip.findMany({
    orderBy: { date: 'desc' },
    include: { lots: true, _count: { select: { lots: true } } },
  })
  return NextResponse.json(slips)
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const slipNo = String(body?.slipNo ?? '').trim()
  const dateStr = String(body?.date ?? '').trim()
  const checkerName = String(body?.checkerName ?? '').trim()
  const notes = body?.notes ? String(body.notes).trim() : null

  // Accept both shapes:
  //   { lots: [{greyEntryId, than}] }   ← new (per-lot than for PC Job partials)
  //   { greyEntryIds: [...] }            ← legacy, defaults than = full GreyEntry.than
  type Picked = { greyEntryId: number; than?: number | null }
  let picks: Picked[] = []
  if (Array.isArray(body?.lots)) {
    picks = body.lots
      .map((l: any) => ({
        greyEntryId: Number(l?.greyEntryId),
        than: l?.than == null ? null : Number(l.than),
      }))
      .filter((l: Picked) => Number.isFinite(l.greyEntryId))
  } else if (Array.isArray(body?.greyEntryIds)) {
    picks = body.greyEntryIds
      .map((n: any) => Number(n))
      .filter((n: number) => Number.isFinite(n))
      .map((id: number) => ({ greyEntryId: id, than: null }))
  }

  if (!slipNo) return NextResponse.json({ error: 'Slip No required' }, { status: 400 })
  if (!dateStr) return NextResponse.json({ error: 'Date required' }, { status: 400 })
  if (!checkerName) return NextResponse.json({ error: 'Checker name required' }, { status: 400 })
  if (picks.length === 0) return NextResponse.json({ error: 'Pick at least one lot' }, { status: 400 })

  const ids = picks.map(p => p.greyEntryId)
  const entries = await db.greyEntry.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, lotNo: true, than: true, baleNo: true,
      party: { select: { tag: true } },
    },
  })
  if (entries.length !== ids.length) {
    return NextResponse.json({ error: 'Some grey entries no longer exist' }, { status: 400 })
  }

  // For each selected lot, validate the requested than against what's already
  // been checked on prior slips. Non-PC-Job lots must record the full grey
  // than; PC Job lots may record anything up to the remaining than.
  const lotNos = Array.from(new Set(entries.map((e: any) => e.lotNo)))
  const priorByLot = new Map<string, number>()
  if (lotNos.length > 0) {
    const priors = await db.checkingSlipLot.groupBy({
      by: ['lotNo'],
      where: { lotNo: { in: lotNos } },
      _sum: { than: true },
    })
    for (const p of priors) priorByLot.set(p.lotNo, p._sum.than || 0)
  }

  const entryMap = new Map<number, any>(entries.map((e: any) => [e.id, e]))
  const lotRunningRequest = new Map<string, number>()
  type LotCreate = { greyEntryId: number; lotNo: string; than: number; baleNo: string | null }
  const lotCreates: LotCreate[] = []
  for (const p of picks) {
    const e = entryMap.get(p.greyEntryId)
    if (!e) continue
    const isPcJob = e.party?.tag === 'Pali PC Job'
    const prior = priorByLot.get(e.lotNo) || 0
    const remaining = Math.max(0, e.than - prior)
    if (remaining <= 0) {
      return NextResponse.json({
        error: `Lot ${e.lotNo} is already fully checked (${prior}/${e.than} than)`,
      }, { status: 400 })
    }
    let want = p.than == null ? remaining : Math.floor(p.than)
    if (!isPcJob) want = remaining // non-PC-Job lots check the whole remaining (which equals e.than on first slip)
    if (!Number.isFinite(want) || want <= 0) {
      return NextResponse.json({ error: `Lot ${e.lotNo}: than must be > 0` }, { status: 400 })
    }
    // Account for multiple picks of the same lot within this same request.
    const running = (lotRunningRequest.get(e.lotNo) || 0) + want
    if (running > remaining) {
      return NextResponse.json({
        error: `Lot ${e.lotNo}: requested ${want} than exceeds remaining ${remaining - (running - want)}`,
      }, { status: 400 })
    }
    lotRunningRequest.set(e.lotNo, running)
    lotCreates.push({ greyEntryId: e.id, lotNo: e.lotNo, than: want, baleNo: e.baleNo })
  }

  try {
    const slip = await db.checkingSlip.create({
      data: {
        slipNo,
        date: new Date(dateStr),
        checkerName,
        notes,
        lots: { create: lotCreates },
      },
      include: { lots: true },
    })
    return NextResponse.json(slip)
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return NextResponse.json({ error: `Slip No "${slipNo}" already used` }, { status: 409 })
    }
    return NextResponse.json({ error: err?.message ?? 'Failed to save' }, { status: 500 })
  }
}
