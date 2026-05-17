export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// GET /api/admin/locked-batch?foldNo=122&batchNo=31
// Returns the batch + each lot's full downstream graph (dye + finish +
// optional folding/packing/despatch). Admin-only.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ((session as any).role !== 'admin') return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const foldNo = (searchParams.get('foldNo') || '').trim()
  const batchNoRaw = (searchParams.get('batchNo') || '').trim()
  const batchNo = parseInt(batchNoRaw, 10)
  if (!foldNo || !Number.isFinite(batchNo)) {
    return NextResponse.json({ error: 'foldNo and batchNo are required' }, { status: 400 })
  }

  const db = prisma as any

  const program = await db.foldProgram.findFirst({
    where: { foldNo },
    select: { id: true, foldNo: true, date: true, status: true },
  })
  if (!program) return NextResponse.json({ error: `Fold ${foldNo} not found` }, { status: 404 })

  const batch = await db.foldBatch.findFirst({
    where: { foldProgramId: program.id, batchNo },
    select: {
      id: true, batchNo: true, cancelled: true, shadeName: true, shadeDescription: true,
      shade: { select: { name: true } },
    },
  })
  if (!batch) return NextResponse.json({ error: `Batch ${batchNo} not found in Fold ${foldNo}` }, { status: 404 })

  const fbls = await db.foldBatchLot.findMany({
    where: { foldBatchId: batch.id },
    select: {
      id: true, lotNo: true, than: true,
      party: { select: { name: true } },
      quality: { select: { name: true } },
    },
    orderBy: { id: 'asc' },
  })

  // Every DyeingEntry linked to this fold batch (usually 1, but multiple
  // possible if re-dyed). For each FBL we pick the lot row from the dye
  // entry's snapshot that matches the FBL's current lotNo case-insensitively.
  const dyeEntries = await db.dyeingEntry.findMany({
    where: { foldBatchId: batch.id },
    select: {
      id: true, slipNo: true, status: true, dyeingDoneAt: true,
      lots: { select: { id: true, lotNo: true, than: true } },
    },
    orderBy: { id: 'asc' },
  })

  const lots: any[] = []
  for (const fbl of fbls) {
    const oldLotLc = fbl.lotNo.toLowerCase().trim()

    // Find matching DyeingEntryLot (across all dye entries on this batch)
    let dyeingEntryLot: any = null
    let matchedDye: any = null
    for (const de of dyeEntries) {
      const hit = de.lots.find((l: any) => l.lotNo.toLowerCase().trim() === oldLotLc)
      if (hit) {
        dyeingEntryLot = { id: hit.id, lotNo: hit.lotNo, than: hit.than, dyeingEntryId: de.id, dyeSlipNo: de.slipNo, dyeingDoneAt: de.dyeingDoneAt }
        matchedDye = de
        break
      }
    }

    // FinishEntryLot rows bound to that dye entry + this lotNo
    let finishEntryLots: any[] = []
    if (matchedDye) {
      const fels = await db.finishEntryLot.findMany({
        where: { dyeingEntryId: matchedDye.id, lotNo: { equals: fbl.lotNo, mode: 'insensitive' } },
        select: { id: true, lotNo: true, than: true, entryId: true, entry: { select: { slipNo: true, date: true } } },
        orderBy: { id: 'asc' },
      })
      finishEntryLots = fels.map((f: any) => ({
        id: f.id, lotNo: f.lotNo, than: f.than,
        finishEntryId: f.entryId, finishSlipNo: f.entry?.slipNo, finishDate: f.entry?.date,
      }))
    }

    // Downstream refs (opt-in cascade targets) — all rows matching this lotNo
    // across the 3 downstream tables. We don't filter by "originated from this
    // batch" because the link isn't stored — admin picks which rows to rename.
    const [foldingSlipLots, packingLots, despatchEntryLots] = await Promise.all([
      db.foldingSlipLot.findMany({
        where: { lotNo: { equals: fbl.lotNo, mode: 'insensitive' } },
        select: { id: true, lotNo: true, than: true, meter: true, foldingSlipId: true, foldingSlip: { select: { slipNo: true, date: true } } },
        orderBy: { id: 'desc' },
      }),
      db.packingLot.findMany({
        where: { lotNo: { equals: fbl.lotNo, mode: 'insensitive' } },
        select: { id: true, lotNo: true, than: true, boxes: true, packingEntryId: true, packingEntry: { select: { date: true } } },
        orderBy: { id: 'desc' },
      }),
      db.despatchEntryLot.findMany({
        where: { lotNo: { equals: fbl.lotNo, mode: 'insensitive' } },
        select: { id: true, lotNo: true, than: true, entryId: true, entry: { select: { challanNo: true, date: true } } },
        orderBy: { id: 'desc' },
      }),
    ])

    lots.push({
      fbl: {
        id: fbl.id,
        lotNo: fbl.lotNo,
        than: fbl.than,
        partyName: fbl.party?.name ?? null,
        qualityName: fbl.quality?.name ?? null,
      },
      dyeingEntryLot,
      finishEntryLots,
      downstreamRefs: {
        foldingSlipLots: foldingSlipLots.map((r: any) => ({
          id: r.id, lotNo: r.lotNo, than: r.than, meter: r.meter,
          slipNo: r.foldingSlip?.slipNo, date: r.foldingSlip?.date,
        })),
        packingLots: packingLots.map((r: any) => ({
          id: r.id, lotNo: r.lotNo, than: r.than, boxes: r.boxes,
          packingEntryId: r.packingEntryId, date: r.packingEntry?.date,
        })),
        despatchEntryLots: despatchEntryLots.map((r: any) => ({
          id: r.id, lotNo: r.lotNo, than: r.than,
          entryId: r.entryId, challanNo: r.entry?.challanNo, date: r.entry?.date,
        })),
      },
    })
  }

  return NextResponse.json({
    batch: {
      id: batch.id, foldNo: program.foldNo, batchNo: batch.batchNo,
      cancelled: batch.cancelled,
      shadeName: batch.shade?.name || batch.shadeName || null,
      shadeDescription: batch.shadeDescription || null,
    },
    dyeEntries: dyeEntries.map((d: any) => ({ id: d.id, slipNo: d.slipNo, status: d.status, dyeingDoneAt: d.dyeingDoneAt })),
    lots,
  })
}
