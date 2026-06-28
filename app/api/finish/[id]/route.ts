export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { logDelete } from '@/lib/deleteLog'
import { normalizeLotNo } from '@/lib/lot-no'
import { validateFinishLotThan } from '@/lib/finish-validate'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  try {
    const db = prisma as any
    const entry = await db.finishEntry.findUnique({
      where: { id: parseInt(id) },
      include: {
        chemicals: { include: { chemical: true } },
        lots: true,
        additions: { include: { chemicals: true }, orderBy: { createdAt: 'asc' } },
      },
    })
    if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(entry)
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const data = await req.json()
  const entryId = parseInt(id)
  const db = prisma as any

  // Carry `id` (FinishEntryLot pk) through when the client supplies it so
  // the server can update the exact row — without it, reconciliation
  // collapses on lotNo and duplicate-lot rows (a finish entry fed by
  // multiple dyeing batches of the same lot) get overwritten by a single
  // update instead of edited individually. dyeingEntryId is preserved
  // the same way.
  const lots = data.lots?.length
    ? data.lots.map((m: any) => {
        const base: any = {
          id: m.id != null ? (parseInt(m.id) || null) : null,
          lotNo: normalizeLotNo(m.lotNo) ?? '',
          than: parseInt(m.than) || 0,
          meter: m.meter != null ? parseFloat(m.meter) : null,
        }
        if (Object.prototype.hasOwnProperty.call(m, 'dyeingEntryId')) {
          base.dyeingEntryId = m.dyeingEntryId != null ? (parseInt(m.dyeingEntryId) || null) : null
        }
        if (Object.prototype.hasOwnProperty.call(m, 'pcReprocessLotId')) {
          base.pcReprocessLotId = m.pcReprocessLotId != null ? (parseInt(m.pcReprocessLotId) || null) : null
        }
        return base
      })
    : [{ id: null, lotNo: normalizeLotNo(data.lotNo) ?? '', than: parseInt(data.than) || 0, meter: null }]

  // Same guard as POST — but excludes this entry's own existing FELs from the
  // "already finished elsewhere" total so an in-place edit doesn't double-count.
  const validateInput = lots.map((l: any) => ({
    lotNo: l.lotNo,
    than: l.than,
    dyeingEntryId: l.dyeingEntryId ?? null,
  }))
  const overClaims = await validateFinishLotThan(validateInput, entryId)
  if (overClaims) {
    return NextResponse.json({ error: 'OVER_CLAIM', messages: overClaims }, { status: 400 })
  }

  try {
    await db.finishEntry.update({
      where: { id: entryId },
      data: {
        date: new Date(data.date),
        slipNo: parseInt(data.slipNo),
        lotNo: lots[0].lotNo,
        than: lots[0].than,
        meter: data.totalMeter != null ? parseFloat(data.totalMeter) : null,
        mandi: data.mandi != null ? parseFloat(data.mandi) : null,
        opMandi: data.opMandi != null ? parseFloat(data.opMandi) : null,
        newMandi: data.newMandi != null ? parseFloat(data.newMandi) : null,
        stockMandi: data.stockMandi != null ? parseFloat(data.stockMandi) : null,
        finishThan: data.finishThan != null ? parseInt(data.finishThan) : null,
        finishMtr: data.finishMtr != null ? parseFloat(data.finishMtr) : null,
        finishDespSlipNo: data.finishDespSlipNo || null,
        notes: data.notes || null,
      },
    })

    // Reconcile FinishEntryLot rows without cascading FoldingReceipts.
    // Two-pass matching keeps the operator-level edit precise even when
    // multiple FELs share the same lotNo (e.g. a finish entry fed by
    // many dyeing batches of the same lot):
    //   1. If the incoming row carries an `id`, look that exact FEL up.
    //   2. Else find the first existing FEL on the same lotNo that
    //      hasn't already been claimed by an earlier row.
    //   3. Anything left unclaimed at the end is deleted.
    const existingFels = await db.finishEntryLot.findMany({ where: { entryId } })
    const byId = new Map<number, any>()
    const byLot = new Map<string, any[]>()
    for (const fel of existingFels) {
      byId.set(fel.id, fel)
      const k = fel.lotNo.toLowerCase().trim()
      if (!byLot.has(k)) byLot.set(k, [])
      byLot.get(k)!.push(fel)
    }
    const claimedIds = new Set<number>()

    for (const l of lots) {
      let match: any = null
      if (l.id != null) {
        const exact = byId.get(l.id)
        if (exact && !claimedIds.has(exact.id)) match = exact
      }
      if (!match) {
        const candidates = byLot.get(l.lotNo.toLowerCase().trim()) || []
        match = candidates.find((c: any) => !claimedIds.has(c.id)) || null
      }
      if (match) {
        claimedIds.add(match.id)
        const updateData: any = { lotNo: l.lotNo, than: l.than, meter: l.meter }
        if (l.dyeingEntryId !== undefined) updateData.dyeingEntryId = l.dyeingEntryId
        if (l.pcReprocessLotId !== undefined) updateData.pcReprocessLotId = l.pcReprocessLotId
        await db.finishEntryLot.update({ where: { id: match.id }, data: updateData })
      } else {
        await db.finishEntryLot.create({
          data: {
            entryId,
            lotNo: l.lotNo,
            than: l.than,
            meter: l.meter,
            dyeingEntryId: l.dyeingEntryId ?? null,
            pcReprocessLotId: l.pcReprocessLotId ?? null,
          },
        })
      }
    }
    // Delete any existing FEL that wasn't claimed by any incoming row.
    for (const fel of existingFels) {
      if (!claimedIds.has(fel.id)) {
        await db.finishEntryLot.delete({ where: { id: fel.id } })
      }
    }

    await db.finishSlipChemical.deleteMany({ where: { entryId } })
    if (data.chemicals?.length) {
      await db.finishSlipChemical.createMany({
        data: data.chemicals.map((c: any) => ({
          entryId,
          chemicalId: c.chemicalId ?? null,
          name: c.name,
          quantity: c.quantity != null ? parseFloat(c.quantity) : null,
          unit: c.unit || 'kg',
          rate: c.rate != null ? parseFloat(c.rate) : null,
          cost: c.cost != null ? parseFloat(c.cost) : null,
        })),
      })
    }

    // Save additions (delete old, recreate)
    if (data.additions !== undefined) {
      // Delete old additions and their chemicals (cascade)
      const oldAdditions = await db.finishAddition.findMany({ where: { entryId }, select: { id: true } })
      for (const a of oldAdditions) {
        await db.finishAdditionChemical.deleteMany({ where: { additionId: a.id } })
      }
      await db.finishAddition.deleteMany({ where: { entryId } })

      // Create new additions
      if (data.additions?.length) {
        for (const add of data.additions) {
          const chems = (add.chemicals || []).filter((c: any) => c.quantity && parseFloat(c.quantity) > 0)
          if (chems.length === 0 && !add.reason) continue
          await db.finishAddition.create({
            data: {
              entryId,
              reason: add.reason || null,
              chemicals: {
                create: chems.map((c: any) => ({
                  chemicalId: c.chemicalId ?? null,
                  name: c.name,
                  quantity: parseFloat(c.quantity) || 0,
                  unit: c.unit || 'kg',
                })),
              },
            },
          })
        }
      }
    }

    const updated = await db.finishEntry.findUnique({
      where: { id: entryId },
      include: { chemicals: { include: { chemical: true } }, lots: true, additions: { include: { chemicals: true } } },
    })

    // PC Pali rework hook — flip any merged-against PC-RPs to 'merged'.
    try {
      const { onPcRpMerged } = await import('@/lib/pc-reprocess-lifecycle')
      const ids = (updated?.lots ?? []).map((l: any) => l.pcReprocessLotId).filter((x: any) => x != null)
      if (ids.length) await onPcRpMerged([...new Set(ids)] as number[])
    } catch {}

    return NextResponse.json(updated)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const entryId = parseInt(id)
  const db = prisma as any

  const force = req.nextUrl.searchParams.get('force') === '1'

  // Block delete if this FP has any FoldingReceipts attached (protects against
  // orphaning folding receipts — FP 190 / FR 6918 incident).
  const linkedFRs = await db.foldingReceipt.count({ where: { lotEntry: { entryId } } })
  if (linkedFRs > 0 && !force) {
    const rows = await db.foldingReceipt.findMany({
      where: { lotEntry: { entryId } },
      select: { slipNo: true, than: true, lotEntry: { select: { lotNo: true } } },
      take: 20,
    })
    return NextResponse.json({
      error: 'FP_HAS_FOLDING_RECEIPTS',
      message: `Cannot delete — ${linkedFRs} folding receipt(s) are linked to this FP. Delete those first, or pass ?force=1 to cascade.`,
      folding: rows.map((r: any) => ({ slipNo: r.slipNo, than: r.than, lotNo: r.lotEntry?.lotNo })),
    }, { status: 409 })
  }

  const fe = await db.finishEntry.findUnique({
    where: { id: entryId },
    select: { slipNo: true, lotNo: true, than: true, lots: { select: { lotNo: true, than: true } } },
  })
  const lotList = fe?.lots?.length ? fe.lots.map((l: any) => l.lotNo).join(', ') : (fe?.lotNo ?? null)
  await logDelete({
    module: 'finish', slipType: 'FP',
    slipNo: fe?.slipNo ?? null, lotNo: lotList, than: fe?.than ?? null, recordId: entryId,
    details: { lots: fe?.lots ?? null, cascadedFoldingReceipts: linkedFRs, force },
  })

  try {
    await db.finishEntry.delete({ where: { id: entryId } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Delete failed' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, cascadedFoldingReceipts: linkedFRs })
}
