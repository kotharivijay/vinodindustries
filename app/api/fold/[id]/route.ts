export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { logDelete } from '@/lib/deleteLog'

// GET /api/fold/[id]
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = parseInt(params.id)
  const program = await (prisma as any).foldProgram.findUnique({
    where: { id },
    include: {
      batches: {
        include: {
          shade: true,
          lots: { include: { party: true, quality: true } },
          dyeingEntries: { select: { id: true, slipNo: true, status: true, dyeingDoneAt: true } },
        },
        orderBy: { batchNo: 'asc' },
      },
    },
  })
  if (!program) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Enrich with marka for Pali PC Job lots
  const allLotNos: string[] = program.batches.flatMap((b: any) => b.lots.map((l: any) => l.lotNo))
  const hasPali = program.batches.some((b: any) => b.lots.some((l: any) => l.party?.tag?.toLowerCase().includes('pali pc job')))
  let lotMarkaMap = new Map<string, string>()
  if (hasPali && allLotNos.length > 0) {
    const { buildLotInfoMap } = await import('@/lib/lot-info')
    const infoMap = await buildLotInfoMap([...new Set(allLotNos)])
    for (const [key, info] of infoMap) {
      if (info.marka) lotMarkaMap.set(key, info.marka)
    }
  }

  // Add marka + isPali flag to response
  const enriched = {
    ...program,
    isPali: hasPali,
    batches: program.batches.map((b: any) => ({
      ...b,
      lots: b.lots.map((l: any) => ({
        ...l,
        marka: lotMarkaMap.get(l.lotNo.toLowerCase().trim()) || null,
      })),
    })),
  }
  return NextResponse.json(enriched)
}

// PATCH /api/fold/[id] — update status or notes
//
// RE-PRO lots intentionally stay as RE-PRO-N through dyeing AND fold. The
// merge back to source lots is done manually from the Re-Process module
// ("Merge Back to Original" on status='finished'), not automatically here.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = parseInt(params.id)
  const { status, notes } = await req.json()

  const program = await (prisma as any).foldProgram.update({
    where: { id },
    data: {
      ...(status && { status }),
      ...(notes !== undefined && { notes }),
    },
  })
  return NextResponse.json(program)
}

// PUT /api/fold/[id] — full update (replace batches+lots)
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = parseInt(params.id)
  const { foldNo, date, notes, batches } = await req.json()

  if (!foldNo?.trim()) return NextResponse.json({ error: 'Fold No required' }, { status: 400 })
  if (!date) return NextResponse.json({ error: 'Date required' }, { status: 400 })
  if (!batches?.length) return NextResponse.json({ error: 'At least one batch required' }, { status: 400 })

  try {
    // Check uniqueness of foldNo (exclude current)
    const existing = await (prisma as any).foldProgram.findFirst({
      where: { foldNo: foldNo.trim(), id: { not: id } },
    })
    if (existing) return NextResponse.json({ error: 'Fold No already exists' }, { status: 409 })

    // Guard: deleting batches that have dyeing slips would silently null
    // out DyeingEntry.foldBatchId (Prisma's default ON DELETE for optional
    // relations is SET NULL) → orphan slips. Block the PUT instead so the
    // operator can decide. Same gate the DELETE handler uses.
    const dyedBatches = await (prisma as any).foldBatch.findMany({
      where: { foldProgramId: id },
      include: { dyeingEntries: { select: { id: true, slipNo: true } } },
    })
    const conflicts = dyedBatches.filter((b: any) => b.dyeingEntries.length > 0)
    if (conflicts.length > 0) {
      const details = conflicts.map((b: any) =>
        `B${b.batchNo} (Slip ${b.dyeingEntries.map((d: any) => d.slipNo).join(', ')})`,
      ).join('; ')
      return NextResponse.json({
        error: `Cannot replace batches — ${conflicts.length} batch(es) have dyeing slips: ${details}. Unlink the slips first or delete them.`,
      }, { status: 409 })
    }

    // Delete old batches (cascade deletes lots)
    await (prisma as any).foldBatch.deleteMany({ where: { foldProgramId: id } })

    // Update program and recreate batches
    const program = await (prisma as any).foldProgram.update({
      where: { id },
      data: {
        foldNo: foldNo.trim(),
        date: new Date(date),
        notes: notes?.trim() || null,
        batches: {
          create: batches.map((batch: any, idx: number) => ({
            batchNo: batch.batchNo ?? idx + 1,
            shadeId: batch.shadeId || undefined,
            shadeName: batch.shadeName?.trim() || undefined,
            shadeDescription: batch.shadeDescription?.trim() || undefined,
            lots: {
              create: (batch.lots ?? []).map((lot: any) => ({
                lotNo: lot.lotNo.trim(),
                partyId: lot.partyId || undefined,
                qualityId: lot.qualityId || undefined,
                than: parseInt(lot.than) || 0,
              })),
            },
          })),
        },
      },
      include: {
        batches: {
          include: {
            shade: true,
            lots: { include: { party: true, quality: true } },
          },
          orderBy: { batchNo: 'asc' },
        },
      },
    })
    return NextResponse.json(program)
  } catch (e: any) {
    if (e.code === 'P2002') return NextResponse.json({ error: 'Fold No already exists' }, { status: 409 })
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// DELETE /api/fold/[id]
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = parseInt(params.id)
  const db = prisma as any

  // Check if any batch has dyeing entries
  const batches = await db.foldBatch.findMany({
    where: { foldProgramId: id },
    include: { dyeingEntries: { select: { id: true, slipNo: true, status: true } } },
  })
  const dyedBatches = batches.filter((b: any) => b.dyeingEntries.length > 0)
  if (dyedBatches.length > 0) {
    const details = dyedBatches.map((b: any) => `B${b.batchNo} (Slip ${b.dyeingEntries.map((d: any) => d.slipNo).join(',')})`).join(', ')
    return NextResponse.json({ error: `Cannot delete — ${dyedBatches.length} batch(es) have dyeing entries: ${details}` }, { status: 400 })
  }

  const fp = await db.foldProgram.findUnique({
    where: { id },
    select: { foldNo: true, date: true, batches: { select: { batchNo: true, lots: { select: { lotNo: true, than: true } } } } },
  })
  const allLots = (fp?.batches ?? []).flatMap((b: any) => b.lots)
  const totalThan = allLots.reduce((s: number, l: any) => s + (l.than || 0), 0)
  await logDelete({
    module: 'fold', slipType: 'Fold',
    slipNo: fp?.foldNo ?? null,
    lotNo: allLots.map((l: any) => l.lotNo).join(', ') || null,
    than: totalThan || null, recordId: id,
    details: { batches: fp?.batches ?? null },
  })
  await db.foldProgram.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
