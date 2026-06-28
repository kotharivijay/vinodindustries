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

    const srcLot =
      source.lots.find((l: { lotNo: string; than: number }) => l.lotNo.toLowerCase().trim() === lotKey)
      ?? (source.lotNo && source.lotNo.toLowerCase().trim() === lotKey
            ? { lotNo: source.lotNo, than: source.than }
            : null)
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
    const total = existingSum + requestThan

    if (total > srcLot.than) {
      errors.push(
        `Over-claim on dye slip ${source.slipNo} (${lotKey.toUpperCase()}): ` +
        `source dyed ${srcLot.than}T, already finished ${existingSum}T elsewhere, ` +
        `this request adds ${requestThan}T → total ${total}T exceeds source.`,
      )
    }
  }
  return errors.length ? errors : null
}
