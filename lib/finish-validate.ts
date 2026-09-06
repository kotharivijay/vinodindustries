import { prisma } from '@/lib/prisma'

type LotInput = {
  lotNo: string
  than: number
  dyeingEntryId: number | null
}

/**
 * For each lot row that is bound to a source dyeing slip via `dyeingEntryId`,
 * verify the claimed `than` does not push total finish-than past what the
 * source slip actually dyed for that lot. Counts previously-recorded FELs on
 * the same (dyeSlipId, lotNo) too, so split finishes don't silently exceed
 * the source. Excludes `currentEntryId`'s own rows on edit.
 */
export async function validateFinishLotThan(
  lots: LotInput[],
  currentEntryId: number | null = null,
): Promise<string[] | null> {
  const db = prisma as any
  const grouped = new Map<string, number>()
  for (const l of lots) {
    if (l.dyeingEntryId == null) continue
    if (!l.lotNo) continue
    const k = `${l.dyeingEntryId}|${l.lotNo.toLowerCase().trim()}`
    grouped.set(k, (grouped.get(k) ?? 0) + (l.than || 0))
  }
  if (grouped.size === 0) return null

  const errors: string[] = []
  for (const [key, requestThan] of grouped) {
    const sepIdx = key.indexOf('|')
    const dyeId = parseInt(key.slice(0, sepIdx))
    const lotKey = key.slice(sepIdx + 1)

    const source = await db.dyeingEntry.findUnique({
      where: { id: dyeId },
      select: { slipNo: true, lotNo: true, than: true, lots: { select: { lotNo: true, than: true } } },
    })
    if (!source) {
      errors.push(`Source dyeing slip id ${dyeId} not found.`)
      continue
    }

    // A slip can carry multiple DyeingEntryLot rows with the SAME lotNo
    // (split fold allocations). The stock route merges them before showing
    // remaining-than, so the validator must sum them too — matching only the
    // first row under-counts the source and rejects a legitimate claim.
    const matchingRows = source.lots.filter(
      (l: { lotNo: string; than: number }) => l.lotNo.toLowerCase().trim() === lotKey,
    )
    let srcLot = matchingRows.length
      ? { lotNo: matchingRows[0].lotNo, than: matchingRows.reduce((s: number, l: { than: number }) => s + l.than, 0) }
      : (source.lotNo && source.lotNo.toLowerCase().trim() === lotKey
            ? { lotNo: source.lotNo, than: source.than }
            : null)
    // A PC-rework dye slip carries the lot code "PC-RP-n"; the finish stock
    // route expands it into the ORIGINAL lot numbers, so a merge-back finish
    // row claims e.g. SAM-282-RAVI against that slip. Resolve the claim
    // through the PC-RP's sources — the ceiling is what that original lot
    // contributed to the rework.
    if (!srcLot) {
      const rpCodes = (source.lots.length ? source.lots.map((l: any) => l.lotNo) : [source.lotNo])
        .filter((c: string | null) => c && /^PC-RP-\d+$/i.test(c.trim()))
      if (rpCodes.length) {
        const rps = await db.pcPaliReprocessLot.findMany({
          where: { reproNo: { in: rpCodes.map((c: string) => c.trim().toUpperCase()), mode: 'insensitive' } },
          select: { sources: { select: { originalLotNo: true, than: true } } },
        })
        let contributed = 0
        for (const rp of rps) for (const s of rp.sources) {
          if (s.originalLotNo.toLowerCase().trim() === lotKey) contributed += s.than
        }
        if (contributed > 0) srcLot = { lotNo: lotKey.toUpperCase(), than: contributed }
      }
    }
    if (!srcLot) {
      errors.push(`Dye slip ${source.slipNo} has no lot matching "${lotKey.toUpperCase()}".`)
      continue
    }

    const whereExisting: any = {
      dyeingEntryId: dyeId,
      lotNo: { equals: lotKey, mode: 'insensitive' },
    }
    if (currentEntryId != null) whereExisting.entryId = { not: currentEntryId }
    const existing = await db.finishEntryLot.findMany({
      where: whereExisting,
      select: { than: true },
    })
    const existingSum = existing.reduce((s: number, f: { than: number }) => s + f.than, 0)
    // Pieces pulled off this slip into a PC Pali rework are gone for good —
    // they come back as finish stock on the rework slip — so they count
    // against the source exactly like finished than (same as the stock route).
    const reclaimed = await db.pcPaliReprocessSource.aggregate({
      where: { sourceDyeingEntryId: dyeId, originalLotNo: { equals: lotKey, mode: 'insensitive' } },
      _sum: { than: true },
    })
    const reclaimedSum: number = reclaimed._sum.than ?? 0
    const total = existingSum + reclaimedSum + requestThan

    if (total > srcLot.than) {
      errors.push(
        `Over-claim on dye slip ${source.slipNo} (${lotKey.toUpperCase()}): ` +
        `source dyed ${srcLot.than}T, already finished ${existingSum}T elsewhere` +
        (reclaimedSum ? `, ${reclaimedSum}T sent to PC rework` : '') +
        `, this request adds ${requestThan}T → total ${total}T exceeds source.`,
      )
    }
  }
  return errors.length ? errors : null
}
