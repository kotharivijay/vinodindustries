// Parse the fabric width (inches) out of a quality NAME — used ONLY to
// pre-fill the one-time Quality.widthInch backfill for human review, never at
// billing time. Billing reads the column.
//
// Names carry two grammars:
//   construction : "PC 62*58 44", "62*50 34", "70*58"   (reed*pick [width])
//   brand + inch : 'Magic 47"', 'Top Dyed 38"'          (width, inch-marked)
//
// Traps this must not fall into:
//   - "70*58" has NO width — a naive "last number" would read 58 (the pick
//     count) as a perfectly plausible 58" width. Must return null.
//   - The masters API strips the '"' inch mark on save, so "Magic 47" (no
//     mark) must still parse — but only AFTER the construction check, or the
//     bare pick count would win.
//   - "Rs.8.50"-style decimals never appear in quality names, but avgCut-ish
//     decimals might ("PC 38''", "Magic  47"): tolerate doubled quotes and
//     stray spacing.

const INCH_RE = /(\d{2})\s*(?:"|″|''|”|’’)/          // 2-digit number + an inch mark
// reed*pick token. NOTE: no `g` flag on the test regex — a global regex is
// stateful across .test() calls (lastIndex) and would make results alternate.
const CONSTRUCTION_RE = /\d{2,3}\s*\*\s*\d{2,3}/
const CONSTRUCTION_ALL_RE = /\d{2,3}\s*\*\s*\d{2,3}/g

/** Plausible loom widths. Outside this band we return null rather than guess. */
const MIN_W = 30
const MAX_W = 72

export function parseWidthInch(name: string | null | undefined): number | null {
  const raw = String(name ?? '').trim()
  if (!raw) return null

  // 1. Explicit inch mark wins — highest confidence.
  const inch = INCH_RE.exec(raw)
  if (inch) {
    const w = parseInt(inch[1], 10)
    return w >= MIN_W && w <= MAX_W ? w : null
  }

  // 2. Construction grammar: strip every reed*pick token, then a remaining
  //    trailing integer is the width. If nothing remains ("70*58"), no width.
  if (CONSTRUCTION_RE.test(raw)) {
    const rest = raw.replace(CONSTRUCTION_ALL_RE, ' ')
    const tail = /(\d{2})\s*$/.exec(rest.trim())
    if (!tail) return null
    const w = parseInt(tail[1], 10)
    return w >= MIN_W && w <= MAX_W ? w : null
  }

  // 3. Brand grammar with the inch mark stripped by the masters API:
  //    a trailing 2-digit number ("Magic 47", "Top Dyed 38").
  const tail = /(\d{2})\s*$/.exec(raw)
  if (tail) {
    const w = parseInt(tail[1], 10)
    return w >= MIN_W && w <= MAX_W ? w : null
  }

  return null
}
