/**
 * Allocate this Finish Program's per-lot than counts back to the dyeing
 * slips they came from. There's no FK linking FinishEntryLot → DyeingEntryLot,
 * so we infer: walk dyeing entries newest → oldest, take each slip's lot than
 * as long as it fits in the FP's remaining allocation for that lot. Skip
 * slips that are too big (a smaller, exact-match slip may come later). After
 * a "whole-take" pass, any unsatisfied remainder is filled by partial-capping.
 *
 * The resulting hierarchy:
 *   - sums to the FP's totalThan by construction (no over-counting)
 *   - shows each contributing dyeing slip with its real lot than
 *   - skips dyeing slips for the same lot that went to a different FP
 */

interface DyeingEntryLike {
  // Optional `id` — when supplied, FEL rows with a matching dyeingEntryId
  // get allocated directly to this slip (the exact path). Without ids the
  // allocator falls back to the old fit-by-than heuristic for everything.
  id?: number
  slipNo: number
  shadeName: string | null
  // Slip-level shade descriptor (typed in dyeing form Step 2). Wins over
  // any fold-batch / master description.
  shadeDescription?: string | null
  lots: { lotNo: string; than: number }[]
  foldBatch: {
    // Per-batch description overrides the master so generic recipes (Hitset
    // / APC) can carry a per-batch descriptor without touching the master.
    shadeDescription?: string | null
    foldProgram?: { foldNo: string | null } | null
    shade?: { name: string | null; description: string | null } | null
  } | null
}

// `fpLotId` — id of the FinishEntryLot this row was allocated from. Set only
// when the FEL had an explicit dyeingEntryId (Pass 0 direct path). For
// heuristic allocations the source FEL is ambiguous, so this stays undefined
// and the renderer must fall back to lookup-by-lotNo.
export interface AllocatedLot { lotNo: string; than: number; fpLotId?: number }
export interface AllocatedSlip {
  slipNo: number
  shadeName: string | null
  shadeDesc: string | null
  foldNo: string
  lots: AllocatedLot[]
}
export interface AllocatedFoldGroup {
  foldNo: string
  slips: AllocatedSlip[]
}

export function allocateFpToDyeingSlips(
  fpLots: { id?: number; lotNo: string; than: number; dyeingEntryId?: number | null }[],
  dyeingEntries: DyeingEntryLike[],
): AllocatedFoldGroup[] {
  // Lowercase keying so case mismatches don't break the join
  const remaining = new Map<string, number>()
  const originalCasing = new Map<string, string>() // lotLc → lotNo (original)
  // FELs with an explicit dyeingEntryId go straight to that slip's bucket;
  // anything else is summed into `remaining` for the heuristic pass below.
  // Without summing, multiple FELs sharing a lotNo would overwrite each
  // other on Map.set — losing than (the FP-177 / PS-57 bug).
  const directByEntry = new Map<number, Array<{ lotKey: string; than: number; original: string; fpLotId?: number }>>()
  for (const fl of fpLots) {
    const k = fl.lotNo.toLowerCase()
    const n = Number(fl.than) || 0
    if (!originalCasing.has(k)) originalCasing.set(k, fl.lotNo)
    if (fl.dyeingEntryId != null) {
      let bucket = directByEntry.get(fl.dyeingEntryId)
      if (!bucket) { bucket = []; directByEntry.set(fl.dyeingEntryId, bucket) }
      bucket.push({ lotKey: k, than: n, original: fl.lotNo, fpLotId: fl.id })
    } else {
      remaining.set(k, (remaining.get(k) ?? 0) + n)
    }
  }

  // Sort dyeing entries newest → oldest. (Caller may have already sorted; do
  // it here defensively so this helper is safe to call directly.)
  const entries = [...dyeingEntries].sort((a, b) => b.slipNo - a.slipNo)
  const entryById = new Map<number, DyeingEntryLike>()
  for (const de of entries) if (de.id != null) entryById.set(de.id, de)

  // slipNo → { meta, lots: Map<lotLc → { than, fpLotId? }> }. fpLotId carried
  // through from Pass 0 so the renderer can look up the exact FEL (and its
  // status / doneThan) per row instead of falling back to lotNo lookup —
  // critical when one FP has multiple FELs sharing a lotNo.
  const allocs = new Map<number, {
    foldNo: string
    shadeName: string | null
    shadeDesc: string | null
    lots: Map<string, { than: number; fpLotId?: number }>
  }>()

  function metaOf(de: DyeingEntryLike) {
    return {
      foldNo: de.foldBatch?.foldProgram?.foldNo || 'No Fold',
      shadeName: de.shadeName || de.foldBatch?.shade?.name || null,
      // Slip > fold batch > master.
      shadeDesc: de.shadeDescription || de.foldBatch?.shadeDescription || de.foldBatch?.shade?.description || null,
    }
  }

  // Pass 0 — direct linkage. Each FEL that carries dyeingEntryId is
  // allocated to that exact dye slip; no inference needed.
  for (const [entryId, rows] of directByEntry) {
    const de = entryById.get(entryId)
    if (!de) {
      // Linked dye entry isn't in the supplied list (rare — caller filtered
      // it out). Fall back by stashing the than back into `remaining` so the
      // heuristic still tries to place it somewhere visible.
      for (const r of rows) remaining.set(r.lotKey, (remaining.get(r.lotKey) ?? 0) + r.than)
      continue
    }
    let bucket = allocs.get(de.slipNo)
    if (!bucket) {
      bucket = { ...metaOf(de), lots: new Map() }
      allocs.set(de.slipNo, bucket)
    }
    for (const r of rows) {
      const cur = bucket.lots.get(r.lotKey)
      bucket.lots.set(r.lotKey, {
        than: (cur?.than ?? 0) + r.than,
        // Keep the first FEL id we saw for this (slip, lot) pair — the
        // common case is one FEL per pair, so this resolves precisely.
        fpLotId: cur?.fpLotId ?? r.fpLotId,
      })
    }
  }

  // Pass 1 — take whole slips that fit cleanly
  for (const de of entries) {
    for (const dl of de.lots || []) {
      const k = dl.lotNo.toLowerCase()
      const rem = remaining.get(k) ?? 0
      if (rem <= 0) continue
      const slipThan = Number(dl.than) || 0
      if (slipThan <= 0 || slipThan > rem) continue
      let bucket = allocs.get(de.slipNo)
      if (!bucket) {
        bucket = { ...metaOf(de), lots: new Map() }
        allocs.set(de.slipNo, bucket)
      }
      const cur = bucket.lots.get(k)
      bucket.lots.set(k, { than: (cur?.than ?? 0) + slipThan, fpLotId: cur?.fpLotId })
      remaining.set(k, rem - slipThan)
      // Track original casing in case the FP's casing was different
      if (!originalCasing.has(k)) originalCasing.set(k, dl.lotNo)
    }
  }

  // Pass 2 — partial fill for anything still short. Walk newest → oldest;
  // take min(remaining, slip's leftover than) and stop when satisfied.
  for (const [k, rem] of remaining) {
    if (rem <= 0) continue
    let stillNeeded = rem
    for (const de of entries) {
      if (stillNeeded <= 0) break
      const dl = (de.lots || []).find(l => l.lotNo.toLowerCase() === k)
      if (!dl) continue
      const dyeingTotal = Number(dl.than) || 0
      if (dyeingTotal <= 0) continue
      const alreadyHere = allocs.get(de.slipNo)?.lots.get(k)?.than ?? 0
      const leftover = dyeingTotal - alreadyHere
      if (leftover <= 0) continue
      const take = Math.min(leftover, stillNeeded)
      let bucket = allocs.get(de.slipNo)
      if (!bucket) {
        bucket = { ...metaOf(de), lots: new Map() }
        allocs.set(de.slipNo, bucket)
      }
      const cur = bucket.lots.get(k)
      bucket.lots.set(k, { than: alreadyHere + take, fpLotId: cur?.fpLotId })
      stillNeeded -= take
    }
    remaining.set(k, stillNeeded)
  }

  // Materialise into fold-grouped output, ordering slips desc within a fold
  const foldMap = new Map<string, AllocatedSlip[]>()
  for (const [slipNo, b] of allocs) {
    const lotsOut: AllocatedLot[] = Array.from(b.lots.entries()).map(([k, v]) => ({
      lotNo: originalCasing.get(k) || k,
      than: v.than,
      ...(v.fpLotId != null ? { fpLotId: v.fpLotId } : {}),
    }))
    if (lotsOut.length === 0) continue
    if (!foldMap.has(b.foldNo)) foldMap.set(b.foldNo, [])
    foldMap.get(b.foldNo)!.push({
      slipNo,
      shadeName: b.shadeName,
      shadeDesc: b.shadeDesc,
      foldNo: b.foldNo,
      lots: lotsOut,
    })
  }
  for (const slips of foldMap.values()) slips.sort((a, b) => b.slipNo - a.slipNo)

  return Array.from(foldMap.entries())
    .map(([foldNo, slips]) => ({ foldNo, slips }))
    .sort((a, b) => a.foldNo.localeCompare(b.foldNo))
}
