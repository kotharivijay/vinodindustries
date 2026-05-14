export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { normalizeLotNo } from '@/lib/lot-no'

const db = prisma as any

interface OrphanLot { lotNo: string; than: number }
interface Orphan {
  id: number
  slipNo: number
  date: string
  shadeName: string | null
  lots: OrphanLot[]
  totalThan: number
}

/**
 * GET — list every dyeing slip with no fold-batch link, INCLUDING PC-job
 * slips. PC jobs legitimately don't need a fold normally, but the operator
 * may want to bind them to a fold programme retroactively, so we surface
 * them too with the isPcJob flag visible on each card.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rows = await db.dyeingEntry.findMany({
    where: { foldBatchId: null },
    select: {
      id: true, slipNo: true, date: true, shadeName: true, isPcJob: true,
      lotNo: true, than: true,
      lots: { select: { lotNo: true, than: true } },
    },
    orderBy: [{ date: 'asc' }, { slipNo: 'asc' }],
  })

  const orphans = rows.map((r: any) => {
    const lots: OrphanLot[] = r.lots?.length
      ? r.lots.map((l: any) => ({ lotNo: l.lotNo, than: l.than }))
      : (r.lotNo ? [{ lotNo: r.lotNo, than: r.than }] : [])
    return {
      id: r.id, slipNo: r.slipNo,
      date: r.date.toISOString(),
      shadeName: r.shadeName,
      isPcJob: r.isPcJob,
      lots,
      totalThan: lots.reduce((s, l) => s + l.than, 0),
    }
  })

  return NextResponse.json({ count: orphans.length, orphans })
}

/**
 * POST — create / append fold from selected orphan slips.
 * Body: { foldNo: string, date: string, slipIds: number[] }
 *
 * Each selected slip becomes ONE FoldBatch under the named FoldProgram
 * (created if absent). Each batch's lots mirror the slip's lots; party +
 * quality on each FoldBatchLot are resolved from grey/OB origin.
 *
 * One transaction. Stale or already-linked slips are silently skipped.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const foldNo = String(body?.foldNo ?? '').trim()
  const dateRaw = String(body?.date ?? '').trim()
  const slipIds: number[] = Array.isArray(body?.slipIds)
    ? Array.from(new Set<number>(body.slipIds.map((x: any) => Number(x)).filter((n: number) => Number.isFinite(n))))
    : []

  if (!foldNo) return NextResponse.json({ error: 'foldNo is required' }, { status: 400 })
  if (!dateRaw) return NextResponse.json({ error: 'date is required' }, { status: 400 })
  if (slipIds.length === 0) return NextResponse.json({ error: 'slipIds[] required' }, { status: 400 })

  const date = new Date(dateRaw)
  if (Number.isNaN(date.getTime())) return NextResponse.json({ error: 'invalid date' }, { status: 400 })

  // Pre-fetch slips with lots; only those still orphaned are eligible.
  const slips = await db.dyeingEntry.findMany({
    where: { id: { in: slipIds } },
    select: {
      id: true, slipNo: true, foldBatchId: true, isPcJob: true,
      shadeName: true, lotNo: true, than: true,
      lots: { select: { lotNo: true, than: true } },
    },
    orderBy: { slipNo: 'asc' },
  })
  // Only "already linked" rows are skipped — PC-job slips are eligible
  // because the operator opted in by selecting them. Their isPcJob flag is
  // left untouched on link (a PC-job slip can be part of a fold programme
  // for tracking purposes; the flag still affects display elsewhere).
  const eligible = slips.filter((s: any) => s.foldBatchId == null)
  const skipped = slips.filter((s: any) => s.foldBatchId != null)

  if (eligible.length === 0) {
    return NextResponse.json({
      error: 'No eligible orphan slips in selection (all already linked)',
      skipped: skipped.map((s: any) => ({ id: s.id, slipNo: s.slipNo, reason: 'already linked' })),
    }, { status: 409 })
  }

  // Lot-info lookup so each FoldBatchLot gets party + quality. Same source the
  // grey-driven flows use (grey row → OB → re-pro).
  const allLotNos = [...new Set(eligible.flatMap((s: any) =>
    (s.lots?.length ? s.lots : [{ lotNo: s.lotNo }]).map((l: any) => l.lotNo)
  ).filter(Boolean) as string[])]
  const { buildLotInfoMap } = await import('@/lib/lot-info')
  const lotInfoMap = await buildLotInfoMap(allLotNos)

  // Resolve party / quality master ids by name (build once).
  const [allParties, allQualities, allShades] = await Promise.all([
    prisma.party.findMany({ select: { id: true, name: true } }),
    prisma.quality.findMany({ select: { id: true, name: true } }),
    db.shade.findMany({ select: { id: true, name: true } }).catch(() => [] as any[]),
  ])
  const partyByName = new Map<string, number>(allParties.map((p: any) => [p.name.toLowerCase(), p.id]))
  const qualityByName = new Map<string, number>(allQualities.map((q: any) => [q.name.toLowerCase(), q.id]))
  const shadeByName = new Map<string, number>((allShades as any[]).map((s: any) => [s.name.toLowerCase(), s.id]))

  const result = await prisma.$transaction(async (tx: any) => {
    // 1. Find or create FoldProgram
    let program = await tx.foldProgram.findUnique({ where: { foldNo } })
    let createdProgram = false
    if (!program) {
      program = await tx.foldProgram.create({
        data: { foldNo, date, status: 'draft' },
      })
      createdProgram = true
    }

    // 2. Continue batch numbering
    const maxBatch = await tx.foldBatch.aggregate({
      where: { foldProgramId: program.id },
      _max: { batchNo: true },
    })
    let nextBatchNo = (maxBatch._max.batchNo ?? 0) + 1

    const linked: { slipId: number; slipNo: number; batchId: number; batchNo: number }[] = []

    for (const slip of eligible) {
      const slipLots = slip.lots?.length
        ? slip.lots
        : (slip.lotNo ? [{ lotNo: slip.lotNo, than: slip.than }] : [])
      if (slipLots.length === 0) continue   // shouldn't happen but defensive

      const shadeId = slip.shadeName
        ? shadeByName.get(slip.shadeName.toLowerCase()) ?? null
        : null

      const newBatch = await tx.foldBatch.create({
        data: {
          foldProgramId: program.id,
          batchNo: nextBatchNo++,
          shadeId,
          shadeName: slip.shadeName,
          lots: {
            create: slipLots.map((l: any) => {
              const info = lotInfoMap.get((l.lotNo || '').toLowerCase().trim())
              const partyId = info?.party ? partyByName.get(info.party.toLowerCase()) ?? null : null
              const qualityId = info?.quality ? qualityByName.get(info.quality.toLowerCase()) ?? null : null
              return { lotNo: normalizeLotNo(l.lotNo) ?? '', than: l.than, partyId, qualityId }
            }),
          },
        },
      })

      await tx.dyeingEntry.update({
        where: { id: slip.id },
        data: { foldBatchId: newBatch.id },
      })

      linked.push({ slipId: slip.id, slipNo: slip.slipNo, batchId: newBatch.id, batchNo: newBatch.batchNo })
    }

    return { programId: program.id, foldNo: program.foldNo, createdProgram, linked }
  })

  return NextResponse.json({
    ok: true,
    foldId: result.programId,
    foldNo: result.foldNo,
    createdProgram: result.createdProgram,
    newBatchCount: result.linked.length,
    linkedSlipIds: result.linked.map(l => l.slipId),
    skipped: skipped.map((s: any) => ({ id: s.id, slipNo: s.slipNo, reason: 'already linked' })),
  })
}
