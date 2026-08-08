// Effective (final) shade of a dyeing slip.
//
// A slip starts at its own shadeName/shadeDescription. If an addition round
// later shifts the colour to a genuinely different shade, that round records
// resultShadeName/resultShadeDescription. The slip's EFFECTIVE shade is the
// latest such round, else the slip's own shade. The original is never lost —
// callers that want history read the additions directly.

interface AdditionShade {
  roundNo: number
  resultShadeName?: string | null
  resultShadeDescription?: string | null
}

interface EntryShade {
  shadeName?: string | null
  shadeDescription?: string | null
  additions?: AdditionShade[] | null
}

export interface EffectiveShade {
  name: string | null
  description: string | null
  changed: boolean          // true when an addition round overrode the shade
  originalName: string | null
  changedInRound: number | null
}

export function effectiveShade(entry: EntryShade): EffectiveShade {
  const originalName = entry.shadeName ?? null
  const originalDesc = entry.shadeDescription ?? null

  // Latest round (highest roundNo) that set a result shade wins.
  const withShade = (entry.additions ?? [])
    .filter(a => a.resultShadeName && a.resultShadeName.trim())
    .sort((a, b) => b.roundNo - a.roundNo)

  if (withShade.length > 0) {
    const a = withShade[0]
    return {
      name: a.resultShadeName!.trim(),
      description: a.resultShadeDescription?.trim() || null,
      changed: true,
      originalName,
      changedInRound: a.roundNo,
    }
  }
  return { name: originalName, description: originalDesc, changed: false, originalName, changedInRound: null }
}
