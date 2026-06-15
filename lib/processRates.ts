// Shared helpers for the Process Rate Contract API routes. Kept out of the
// route.ts files because Next.js App Router only allows HTTP-handler exports
// from a route module.

// Lines + their process type, in display order. Reused by every read.
export const lineInclude = {
  lines: {
    include: { processType: { select: { id: true, code: true, name: true, rateMode: true } } },
    orderBy: { processType: { sortOrder: 'asc' as const } },
  },
}

// Money/decimal fields arrive as strings (wire convention) — keep them as
// strings for Prisma's Decimal columns; collapse blanks to null.
export function dec(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

export type LineInput = {
  processTypeId: number
  unit?: string
  rate?: string | number | null
  rateLight?: string | number | null
  rateMedium?: string | number | null
  rateDark?: string | number | null
}

// Validate each rate line against its process type's rateMode. Returns an
// error string, or null when every line is well-formed. `tx` is a Prisma
// client or transaction client.
export async function validateLines(tx: any, lines: LineInput[]): Promise<string | null> {
  if (!Array.isArray(lines) || lines.length === 0) return 'At least one rate line is required'
  const ids = lines.map(l => l.processTypeId)
  if (ids.some(id => !id)) return 'Every line needs a process type'
  if (new Set(ids).size !== ids.length) return 'Duplicate process type in lines'
  const types = await tx.processType.findMany({ where: { id: { in: ids } } })
  const modeById = new Map<number, string>(types.map((t: any) => [t.id, t.rateMode]))
  for (const l of lines) {
    const mode = modeById.get(l.processTypeId)
    if (!mode) return `Unknown process type ${l.processTypeId}`
    if (mode === 'FLAT' && dec(l.rate) === null) return 'Flat-rate line needs a rate'
    if (mode === 'BY_COLOR_CATEGORY' &&
        (dec(l.rateLight) === null || dec(l.rateMedium) === null || dec(l.rateDark) === null)) {
      return 'By-colour line needs Light, Medium and Dark rates'
    }
  }
  return null
}

// Shape one incoming line into the columns Prisma writes.
export function lineData(l: LineInput) {
  return {
    processTypeId: l.processTypeId,
    unit: (l.unit && String(l.unit).trim()) || 'kg',
    rate: dec(l.rate),
    rateLight: dec(l.rateLight),
    rateMedium: dec(l.rateMedium),
    rateDark: dec(l.rateDark),
  }
}

export const VALIDITY_UNITS = ['than', 'kg', 'mtr'] as const
