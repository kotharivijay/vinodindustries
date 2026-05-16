export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { logDelete } from '@/lib/deleteLog'
import { normalizeLotNo } from '@/lib/lot-no'

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

  // Only carry dyeingEntryId through when the client explicitly supplies it
  // (preserve existing link when the edit form omits the field).
  const lots = data.lots?.length
    ? data.lots.map((m: any) => {
        const base: any = {
          lotNo: normalizeLotNo(m.lotNo) ?? '',
          than: parseInt(m.than) || 0,
          meter: m.meter != null ? parseFloat(m.meter) : null,
        }
        if (Object.prototype.hasOwnProperty.call(m, 'dyeingEntryId')) {
          base.dyeingEntryId = m.dyeingEntryId != null ? (parseInt(m.dyeingEntryId) || null) : null
        }
        return base
      })
    : [{ lotNo: normalizeLotNo(data.lotNo) ?? '', than: parseInt(data.than) || 0, meter: null }]

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

    // Reconcile lots without cascading FoldingReceipts.
    // Match existing FELs to incoming lots by lotNo (case-insensitive):
    //   - existing + incoming → UPDATE in place (preserves id, keeps FRs)
    //   - existing but not incoming → DELETE (cascade allowed, user removed lot)
    //   - incoming but not existing → CREATE new FEL
    const existingFels = await db.finishEntryLot.findMany({ where: { entryId } })
    const existingByLot = new Map<string, any>()
    for (const fel of existingFels) existingByLot.set(fel.lotNo.toLowerCase().trim(), fel)

    const incomingKeys = new Set<string>()
    for (const l of lots) {
      const key = l.lotNo.toLowerCase().trim()
      incomingKeys.add(key)
      const match = existingByLot.get(key)
      if (match) {
        // Only overwrite dyeingEntryId when the client explicitly supplies it
        // (typed undefined → preserve whatever's stored).
        const updateData: any = { lotNo: l.lotNo, than: l.than, meter: l.meter }
        if (l.dyeingEntryId !== undefined) updateData.dyeingEntryId = l.dyeingEntryId
        await db.finishEntryLot.update({ where: { id: match.id }, data: updateData })
      } else {
        await db.finishEntryLot.create({
          data: { entryId, lotNo: l.lotNo, than: l.than, meter: l.meter, dyeingEntryId: l.dyeingEntryId ?? null },
        })
      }
    }
    // Delete FELs whose lotNo is no longer in the payload.
    for (const fel of existingFels) {
      if (!incomingKeys.has(fel.lotNo.toLowerCase().trim())) {
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
