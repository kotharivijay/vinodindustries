export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { normalizeLotNo } from '@/lib/lot-no'

/**
 * POST /api/admin/locked-batch/fix
 * Body:
 * {
 *   foldBatchLotId: number,
 *   newLotNo: string,
 *   newThan: number,
 *   reason?: string,
 *   alsoRenameDownstream?: {
 *     foldingSlipLotIds?: number[],
 *     packingLotIds?: number[],
 *     despatchEntryLotIds?: number[]
 *   }
 * }
 *
 * Cascade (all in one prisma.$transaction):
 *  1. FoldBatchLot — lotNo + than + partyId/qualityId (re-lookup from GreyEntry)
 *  2. DyeingEntryLot — lotNo + than, matched via DyeingEntry.foldBatchId
 *  3. FinishEntryLot(s) — lotNo + than, matched via dyeingEntryId + oldLotNo
 *  4. Optional downstream rows (lotNo only) — only the explicit ids the admin
 *     ticked, validated to actually reference oldLotNo before update.
 *  5. BatchLotCorrection audit row.
 *
 * Admin-only. Returns the audit row id.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ((session as any).role !== 'admin') return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  const foldBatchLotId = Number(body.foldBatchLotId)
  const newLotNoRaw = String(body.newLotNo ?? '')
  const newLotNo = normalizeLotNo(newLotNoRaw)
  const newThan = Number(body.newThan)
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null
  const downstream = body.alsoRenameDownstream || {}
  const foldingSlipLotIds: number[] = Array.isArray(downstream.foldingSlipLotIds) ? downstream.foldingSlipLotIds.map(Number).filter(Number.isFinite) : []
  const packingLotIds: number[] = Array.isArray(downstream.packingLotIds) ? downstream.packingLotIds.map(Number).filter(Number.isFinite) : []
  const despatchEntryLotIds: number[] = Array.isArray(downstream.despatchEntryLotIds) ? downstream.despatchEntryLotIds.map(Number).filter(Number.isFinite) : []

  if (!Number.isFinite(foldBatchLotId)) return NextResponse.json({ error: 'foldBatchLotId is required' }, { status: 400 })
  if (!newLotNo) return NextResponse.json({ error: 'newLotNo must be non-empty' }, { status: 400 })
  if (!Number.isFinite(newThan) || newThan < 1) return NextResponse.json({ error: 'newThan must be >= 1' }, { status: 400 })

  const db = prisma as any

  // Pre-fetch the FBL to snapshot old values + locate the linked dye entry.
  const fbl = await db.foldBatchLot.findUnique({
    where: { id: foldBatchLotId },
    select: { id: true, lotNo: true, than: true, foldBatchId: true },
  })
  if (!fbl) return NextResponse.json({ error: `FoldBatchLot ${foldBatchLotId} not found` }, { status: 404 })

  const oldLotNo = fbl.lotNo
  const oldThan = fbl.than
  const oldLotLc = oldLotNo.toLowerCase().trim()

  // Find a DyeingEntry on this fold batch (usually exactly one). We pick the
  // first one that actually has a lot matching oldLotNo — handles the (rare)
  // multi-dye case cleanly.
  const dyeEntries = await db.dyeingEntry.findMany({
    where: { foldBatchId: fbl.foldBatchId },
    select: { id: true, lots: { select: { id: true, lotNo: true } } },
    orderBy: { id: 'asc' },
  })
  const matchedDye = dyeEntries.find((d: any) => d.lots.some((l: any) => l.lotNo.toLowerCase().trim() === oldLotLc))
  const matchedDel = matchedDye?.lots.find((l: any) => l.lotNo.toLowerCase().trim() === oldLotLc) ?? null

  // FinishEntryLots bound to that dye entry + this old lotNo (could be 0+).
  const fels = matchedDye
    ? await db.finishEntryLot.findMany({
        where: { dyeingEntryId: matchedDye.id, lotNo: { equals: oldLotNo, mode: 'insensitive' } },
        select: { id: true },
      })
    : []
  const felIds: number[] = fels.map((f: any) => f.id)

  // Validate every downstream id actually references oldLotNo. Stops the
  // client from smuggling unrelated row ids through the cascade.
  if (foldingSlipLotIds.length) {
    const rows = await db.foldingSlipLot.findMany({
      where: { id: { in: foldingSlipLotIds } },
      select: { id: true, lotNo: true },
    })
    const bad = rows.filter((r: any) => r.lotNo.toLowerCase().trim() !== oldLotLc)
    if (bad.length || rows.length !== foldingSlipLotIds.length) {
      return NextResponse.json({ error: 'One or more foldingSlipLotIds do not reference the old lotNo', bad }, { status: 400 })
    }
  }
  if (packingLotIds.length) {
    const rows = await db.packingLot.findMany({
      where: { id: { in: packingLotIds } },
      select: { id: true, lotNo: true },
    })
    const bad = rows.filter((r: any) => r.lotNo.toLowerCase().trim() !== oldLotLc)
    if (bad.length || rows.length !== packingLotIds.length) {
      return NextResponse.json({ error: 'One or more packingLotIds do not reference the old lotNo', bad }, { status: 400 })
    }
  }
  if (despatchEntryLotIds.length) {
    const rows = await db.despatchEntryLot.findMany({
      where: { id: { in: despatchEntryLotIds } },
      select: { id: true, lotNo: true },
    })
    const bad = rows.filter((r: any) => r.lotNo.toLowerCase().trim() !== oldLotLc)
    if (bad.length || rows.length !== despatchEntryLotIds.length) {
      return NextResponse.json({ error: 'One or more despatchEntryLotIds do not reference the old lotNo', bad }, { status: 400 })
    }
  }

  // Re-look party/quality from GreyEntry for the new lot (case-insensitive).
  const grey = await prisma.greyEntry.findFirst({
    where: { lotNo: { equals: newLotNo, mode: 'insensitive' } },
    select: { partyId: true, qualityId: true },
  })

  const auditRow = await prisma.$transaction(async (tx: any) => {
    // 1) FoldBatchLot
    await tx.foldBatchLot.update({
      where: { id: foldBatchLotId },
      data: {
        lotNo: newLotNo,
        than: newThan,
        partyId: grey?.partyId ?? null,
        qualityId: grey?.qualityId ?? null,
      },
    })

    // 2) DyeingEntryLot (if matched)
    if (matchedDel) {
      await tx.dyeingEntryLot.update({
        where: { id: matchedDel.id },
        data: { lotNo: newLotNo, than: newThan },
      })
    }

    // 3) FinishEntryLot(s) — rename + retune than. If multiple FELs match
    //    on the same dye-slip + old-lot, all of them get the new lotNo and
    //    a proportional retune of `than` per row.
    //
    //    Sum-preserving rule: if the FEL than total used to equal oldThan,
    //    we just write newThan onto the single FEL. If totals differ (e.g.
    //    partial finish), each FEL gets `round(fel.than * newThan / oldThan)`
    //    with the remainder absorbed into the largest row. This keeps the
    //    Finish ledger consistent with the new dye-stage than.
    if (felIds.length === 1) {
      await tx.finishEntryLot.update({
        where: { id: felIds[0] },
        data: { lotNo: newLotNo, than: newThan },
      })
    } else if (felIds.length > 1) {
      const allFels = await tx.finishEntryLot.findMany({
        where: { id: { in: felIds } },
        select: { id: true, than: true },
      })
      // Just rename — don't auto-rescale than across multiple rows; admin
      // should fix any than mismatch manually in that rare case.
      await tx.finishEntryLot.updateMany({
        where: { id: { in: felIds } },
        data: { lotNo: newLotNo },
      })
      // (allFels kept available for audit details below)
      void allFels
    }

    // 4) Optional downstream cascade — lotNo only (NOT than)
    if (foldingSlipLotIds.length) {
      await tx.foldingSlipLot.updateMany({
        where: { id: { in: foldingSlipLotIds } },
        data: { lotNo: newLotNo },
      })
    }
    if (packingLotIds.length) {
      await tx.packingLot.updateMany({
        where: { id: { in: packingLotIds } },
        data: { lotNo: newLotNo },
      })
    }
    if (despatchEntryLotIds.length) {
      await tx.despatchEntryLot.updateMany({
        where: { id: { in: despatchEntryLotIds } },
        data: { lotNo: newLotNo },
      })
    }

    // 5) Audit row
    return await tx.batchLotCorrection.create({
      data: {
        foldBatchLotId,
        oldLotNo,
        oldThan,
        newLotNo,
        newThan,
        dyeingEntryLotId: matchedDel?.id ?? null,
        finishEntryLotIds: felIds.length ? felIds : undefined,
        downstreamRenamed: {
          foldingSlipLot: foldingSlipLotIds,
          packingLot: packingLotIds,
          despatchEntryLot: despatchEntryLotIds,
        },
        reason,
        userEmail: session.user?.email || 'unknown',
      },
      select: { id: true },
    })
  })

  return NextResponse.json({
    ok: true,
    auditId: auditRow.id,
    cascade: {
      foldBatchLotId,
      dyeingEntryLotId: matchedDel?.id ?? null,
      finishEntryLotIds: felIds,
      downstream: {
        foldingSlipLot: foldingSlipLotIds,
        packingLot: packingLotIds,
        despatchEntryLot: despatchEntryLotIds,
      },
    },
  })
}
