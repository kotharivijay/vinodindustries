export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = prisma as any

  // Run dyeing entries + finish lots in parallel (independent queries)
  const { buildLotInfoMap } = await import('@/lib/lot-info')

  const [doneSlips, finishLots, pcReclaims, pcRpLots] = await Promise.all([
    db.dyeingEntry.findMany({
      where: { dyeingDoneAt: { not: null } },
      select: {
        id: true,
        slipNo: true,
        date: true,
        dyeingDoneAt: true,
        shadeName: true,
        lotNo: true,
        than: true,
        marka: true,
        shadeDescription: true,
        isPcJob: true,
        machine: { select: { name: true } },
        operator: { select: { name: true } },
        lots: { select: { lotNo: true, than: true } },
        foldBatch: { select: { batchNo: true, shadeDescription: true, foldProgram: { select: { foldNo: true } }, shade: { select: { name: true, description: true, colorCategory: true } } } },
        // Per-round resulting shade — if any addition changed the shade, that
        // overrides the slip's shade in finish stock (effective shade).
        additions: { select: { roundNo: true, resultShadeName: true, resultShadeDescription: true } },
      },
      orderBy: { dyeingDoneAt: 'desc' },
    }),
    // Two pieces per finish-lot row: how much was finished, and whether the
    // user explicitly bound it to a source dye slip (dyeingEntryId).
    db.finishEntryLot.findMany({
      select: { lotNo: true, than: true, dyeingEntryId: true },
    }),
    // PC Pali rework reclaims — each row permanently reduces the un-finished
    // pool on its SOURCE dye slip: that cloth physically left the slip for the
    // rework cycle and comes back as finish stock on the REWORK dye slip (see
    // pcRpLots below), so the deduction must hold even after the PC-RP is
    // merged — otherwise the same pieces would show twice.
    db.pcPaliReprocessSource.findMany({
      select: { sourceDyeingEntryId: true, originalLotNo: true, than: true },
    }),
    // PC-RP lots with their sources. A rework dye slip carries the lot code
    // "PC-RP-n"; for finishing it is expanded back into the ORIGINAL lot
    // numbers (each source's originalLotNo + than) so the merge-back finish
    // program — and everything downstream (folding, packing, despatch) — runs
    // under the customer's real lot numbers, not the rework code.
    db.pcPaliReprocessLot.findMany({
      select: { id: true, reproNo: true, sources: { select: { originalLotNo: true, than: true } } },
    }),
  ])

  const pcRpByCode = new Map<string, { id: number; reproNo: string; lots: { lotNo: string; than: number }[] }>()
  for (const rp of pcRpLots) {
    const byLot = new Map<string, { lotNo: string; than: number }>()
    for (const s of rp.sources) {
      const k = s.originalLotNo.toLowerCase().trim()
      const cur = byLot.get(k)
      if (cur) cur.than += s.than
      else byLot.set(k, { lotNo: s.originalLotNo, than: s.than })
    }
    pcRpByCode.set(rp.reproNo.toLowerCase().trim(), { id: rp.id, reproNo: rp.reproNo, lots: [...byLot.values()] })
  }
  const pcRpFor = (lotNo: string) => pcRpByCode.get(lotNo.toLowerCase().trim()) ?? null

  // Collect all lot numbers (original lots behind a PC-RP code included, so
  // party / quality resolve for the expanded rows)
  const allLotNos = new Set<string>()
  for (const d of doneSlips) {
    const lots = d.lots?.length ? d.lots : [{ lotNo: d.lotNo }]
    for (const l of lots) {
      const rp = pcRpFor(l.lotNo)
      if (rp) rp.lots.forEach(s => allLotNos.add(s.lotNo))
      else allLotNos.add(l.lotNo)
    }
  }

  const lotInfoMap = await buildLotInfoMap(Array.from(allLotNos))

  // Two finish-lot maps:
  //  • directMap — Pass 1: exact (dyeSlipId, lotNo) → finishedThan. Set when
  //    the user picked specific slips for the finish entry.
  //  • unlinkedMap — Pass 2 / legacy: lotNo → finishedThan summed across all
  //    FELs with NULL dyeingEntryId. Deducted FIFO across remaining slips.
  const directMap = new Map<string, number>()
  const unlinkedMap = new Map<string, number>()
  for (const fl of finishLots) {
    const key = fl.lotNo.toLowerCase().trim()
    if (fl.dyeingEntryId != null) {
      const dk = `${fl.dyeingEntryId}|${key}`
      directMap.set(dk, (directMap.get(dk) || 0) + fl.than)
    } else {
      unlinkedMap.set(key, (unlinkedMap.get(key) || 0) + fl.than)
    }
  }

  // PC reprocess reclaims behave like direct finish deductions on the same
  // (slipId, lotKey) key — they reduce that slip's remaining un-finished
  // than even though no FinishEntryLot exists yet.
  for (const r of pcReclaims) {
    const key = r.originalLotNo.toLowerCase().trim()
    const dk = `${r.sourceDyeingEntryId}|${key}`
    directMap.set(dk, (directMap.get(dk) || 0) + r.than)
  }

  // A slip can carry multiple DyeingEntryLot rows with the SAME lotNo (e.g.
  // split fold allocations). All maps here key by (slipId, lotKey), so those
  // rows must be merged first — otherwise a direct deduction is applied once
  // per duplicate row and the last row's remaining overwrites the others,
  // hiding the slip from stock.
  //
  // A "PC-RP-n" lot on a rework dye slip is expanded here into its original
  // source lots, tagged with pcReprocessLotId. The merge-back FinishEntryLot
  // stores (dyeingEntryId = rework slip, lotNo = original lot), so the same
  // `${slipId}|${lotKey}` direct-deduction key works unchanged.
  type SlipLot = { lotNo: string; than: number; pcReprocessLotId?: number; reproNo?: string }
  const mergedLots = (d: any): SlipLot[] => {
    const lots = d.lots?.length ? d.lots : [{ lotNo: d.lotNo, than: d.than }]
    const byKey = new Map<string, SlipLot>()
    const add = (l: SlipLot) => {
      const key = l.lotNo.toLowerCase().trim()
      const existing = byKey.get(key)
      if (existing) existing.than += l.than
      else byKey.set(key, { ...l })
    }
    for (const l of lots) {
      const rp = pcRpFor(l.lotNo)
      if (rp) rp.lots.forEach(s => add({ lotNo: s.lotNo, than: s.than, pcReprocessLotId: rp.id, reproNo: rp.reproNo }))
      else add({ lotNo: l.lotNo, than: l.than })
    }
    return Array.from(byKey.values())
  }

  // Pre-compute remaining-than for each (slipId, lotKey) in two passes.
  // Pass 2 runs in oldest-first order so the FIFO heuristic credits older
  // dye slips first — newest slips stay visible until their consumption is
  // explicit. We keep display order (desc) untouched.
  const remainingMap = new Map<string, number>()
  const deductedUnlinked = new Map<string, number>()
  const slipsAsc = [...doneSlips].sort((a: any, b: any) => {
    const ta = new Date(a.dyeingDoneAt).getTime()
    const tb = new Date(b.dyeingDoneAt).getTime()
    if (ta !== tb) return ta - tb
    return a.id - b.id
  })
  for (const d of slipsAsc) {
    const lots = mergedLots(d)
    for (const l of lots) {
      const key = l.lotNo.toLowerCase().trim()
      // Pass 1 — exact deduction from this slip
      const direct = Math.min(l.than, directMap.get(`${d.id}|${key}`) || 0)
      let remaining = l.than - direct
      // Pass 2 — FIFO across the lot's unlinked finish total
      if (remaining > 0) {
        const unlinkedTotal = unlinkedMap.get(key) || 0
        const alreadyDeducted = deductedUnlinked.get(key) || 0
        const stillToDeduct = Math.max(0, unlinkedTotal - alreadyDeducted)
        const fifoDeduct = Math.min(remaining, stillToDeduct)
        deductedUnlinked.set(key, alreadyDeducted + fifoDeduct)
        remaining -= fifoDeduct
      }
      remainingMap.set(`${d.id}|${key}`, remaining)
    }
  }

  // Now build display list in the original desc order using precomputed remaining.
  const { effectiveShade } = await import('@/lib/effective-shade')

  const stock: any[] = []
  for (const d of doneSlips) {
    const lots = mergedLots(d)
    const lotInfo = lotInfoMap.get((lots[0]?.lotNo || d.lotNo).toLowerCase().trim())
    // Effective shade: an addition round may have changed the colour to a
    // different shade (e.g. K-cream → T-186). That override wins here.
    const baseShadeName = d.shadeName || d.foldBatch?.shade?.name || null
    const eff = effectiveShade({ shadeName: baseShadeName, shadeDescription: d.shadeDescription, additions: d.additions })
    const shadeName = eff.name
    // Priority: effective-shade result → slip > fold batch > master. Slip-level
    // descriptor (typed in dyeing form Step 2) wins so each slip carries its
    // own colour. When an addition changed the shade, its description wins.
    const shadeDesc = eff.changed
      ? eff.description
      : (d.shadeDescription || d.foldBatch?.shadeDescription || d.foldBatch?.shade?.description || null)
    // Colour category lives only on the live shade master. Gate on a name match
    // so a renamed master can't attach its category to a slip's old shade name.
    // When the shade was changed by an addition it no longer maps to the fold's
    // master shade, so no category is attached.
    const shadeColorCategory = !eff.changed && d.foldBatch?.shade?.name && d.foldBatch.shade.name === shadeName ? (d.foldBatch.shade.colorCategory ?? null) : null

    // Piece-color jobs use the customer/owner name as the lotNo and don't
    // have grey/OB records — without explicit handling they fall through to
    // 'Unknown' in the Stock Report. Label them so they group cleanly.
    const pcJobParty = d.isPcJob ? 'PC Job' : null
    const pcJobQuality = d.isPcJob ? (shadeName || 'PC Job') : null

    const adjustedLots: any[] = []
    for (const l of lots) {
      const key = l.lotNo.toLowerCase().trim()
      const remaining = remainingMap.get(`${d.id}|${key}`) ?? l.than
      const deductFromThis = l.than - remaining
      if (remaining > 0) {
        const li = lotInfoMap.get(key)
        adjustedLots.push({
          lotNo: l.lotNo,
          than: remaining,
          originalThan: l.than,
          finishedThan: deductFromThis,
          party: li?.party || lotInfo?.party || pcJobParty || null,
          quality: li?.quality || lotInfo?.quality || pcJobQuality || null,
          weight: li?.weight || lotInfo?.weight || null,
          mtrPerThan: li?.mtrPerThan || lotInfo?.mtrPerThan || null,
          // Set when this row is an original lot coming back from PC rework;
          // the finish form must store it so the PC-RP flips to 'merged'.
          pcReprocessLotId: l.pcReprocessLotId ?? null,
          reproNo: l.reproNo ?? null,
        })
      }
    }

    // Skip entire slip if all lots are fully finished
    if (adjustedLots.length === 0) continue

    stock.push({
      id: d.id,
      slipNo: d.slipNo,
      date: d.date,
      dyeingDoneAt: d.dyeingDoneAt,
      shadeName,
      shadeDescription: shadeDesc,
      shadeColorCategory,
      // When an addition round changed the shade, surface the original so the
      // finish screen can show "T-186 (was Milan-K cream)".
      shadeChangedFrom: eff.changed ? eff.originalName : null,
      foldNo: d.foldBatch?.foldProgram?.foldNo || null,
      batchNo: d.foldBatch?.batchNo || null,
      lots: adjustedLots,
      totalThan: adjustedLots.reduce((s: number, l: any) => s + l.than, 0),
      party: lotInfo?.party || pcJobParty || null,
      quality: lotInfo?.quality || pcJobQuality || null,
      weight: lotInfo?.weight || null,
      marka: d.marka || null,
      isPcJob: d.isPcJob || false,
      machineName: d.machine?.name || null,
      operatorName: d.operator?.name || null,
    })
  }

  // Inject OB allocations tagged as 'dyed' (available for finish)
  try {
    const obDyed = await db.lotOpeningBalanceAllocation.findMany({
      where: { stage: 'dyed' },
      include: { balance: true },
    })
    for (const alloc of obDyed) {
      const b = alloc.balance
      const key = b.lotNo.toLowerCase().trim()
      // OB allocations share the unlinked-finish FIFO pool with legacy dye
      // slips — any finish than left after the dye-slip pass spills here.
      const totalFinished = unlinkedMap.get(key) || 0
      const alreadyDeducted = deductedUnlinked.get(key) || 0
      const remainingToDeduct = Math.max(0, totalFinished - alreadyDeducted)
      const deductFromThis = Math.min(alloc.than, remainingToDeduct)
      deductedUnlinked.set(key, alreadyDeducted + deductFromThis)
      const remaining = alloc.than - deductFromThis
      if (remaining <= 0) continue

      const mtrPerThan = b.grayMtr && b.greyThan ? b.grayMtr / b.greyThan : null
      stock.push({
        id: -alloc.id, // negative id to avoid collision with real DyeingEntry ids
        slipNo: 0,
        date: b.greyDate || b.createdAt,
        dyeingDoneAt: b.greyDate || b.createdAt,
        shadeName: null,
        shadeDescription: null,
        shadeColorCategory: null,
        foldNo: null,
        batchNo: null,
        lots: [{
          lotNo: b.lotNo,
          than: remaining,
          originalThan: alloc.than,
          finishedThan: deductFromThis,
          party: b.party,
          quality: b.quality,
          weight: b.weight,
          mtrPerThan,
        }],
        totalThan: remaining,
        party: b.party,
        quality: b.quality,
        weight: b.weight,
        marka: b.marka,
        isPcJob: false,
        machineName: null,
        operatorName: null,
        isFromOB: true,
        obStage: 'dyed',
        obNotes: alloc.notes || null,
      })
    }
  } catch {}

  // Inject current-year lots tagged with startStage='finish'. These arrived
  // already-processed and skip Grey/Fold/Dye → they should appear as
  // ready-to-finish stock here. Same FIFO finish-deduction as dye slips.
  try {
    const startStageRows = await prisma.greyEntry.findMany({
      where: { startStage: 'finish' },
      select: {
        id: true, lotNo: true, than: true, date: true, grayMtr: true, weight: true, marka: true,
        party: { select: { name: true } },
        quality: { select: { name: true } },
      },
      orderBy: { date: 'asc' },
    })
    // Aggregate by lotNo so multi-challan lots show as one virtual entry
    const grouped = new Map<string, any>()
    for (const r of startStageRows) {
      const k = r.lotNo.toLowerCase().trim()
      const existing = grouped.get(k)
      if (existing) {
        existing.totalThan += r.than
        if (r.grayMtr) existing.meter = (existing.meter || 0) + r.grayMtr
      } else {
        grouped.set(k, {
          firstId: r.id,
          lotNo: r.lotNo,
          totalThan: r.than,
          meter: r.grayMtr || null,
          date: r.date,
          party: r.party?.name || null,
          quality: r.quality?.name || null,
          weight: r.weight,
          marka: r.marka,
        })
      }
    }
    for (const [key, info] of grouped) {
      // startStage='finish' rows share the unlinked-finish FIFO pool too.
      const totalFinished = unlinkedMap.get(key) || 0
      const alreadyDeducted = deductedUnlinked.get(key) || 0
      const remainingToDeduct = Math.max(0, totalFinished - alreadyDeducted)
      const deductFromThis = Math.min(info.totalThan, remainingToDeduct)
      deductedUnlinked.set(key, alreadyDeducted + deductFromThis)
      const remaining = info.totalThan - deductFromThis
      if (remaining <= 0) continue

      const mtrPerThan = info.meter && info.totalThan ? info.meter / info.totalThan : null
      stock.push({
        id: -info.firstId * 1000, // synthetic, distinct from OB injections
        slipNo: 0,
        date: info.date,
        dyeingDoneAt: info.date,
        shadeName: null,
        shadeDescription: null,
        shadeColorCategory: null,
        foldNo: null,
        batchNo: null,
        lots: [{
          lotNo: info.lotNo,
          than: remaining,
          originalThan: info.totalThan,
          finishedThan: deductFromThis,
          party: info.party,
          quality: info.quality,
          weight: info.weight,
          mtrPerThan,
        }],
        totalThan: remaining,
        party: info.party,
        quality: info.quality,
        weight: info.weight,
        marka: info.marka,
        isPcJob: false,
        machineName: null,
        operatorName: null,
        isFromStartStage: true,
        startStage: 'finish',
      })
    }
  } catch {}

  return NextResponse.json({
    stock,
    totalSlips: stock.length,
    totalThan: stock.reduce((s: number, d: any) => s + d.totalThan, 0),
  })
}
