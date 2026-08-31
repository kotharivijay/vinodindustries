// Guard against the LR number being typed into the Gray Mtr field.
//
// Real incident (NM-758-HARI, grey id 6655, challan 251): the row carried
// `grayMtr 22561` and `transportLrNo 22561` — byte-identical. That produced a
// plausible-looking 470 m/than against a true ~222, which silently inflated the
// fold-batch weight (B5 239.3 kg / B6 261.0 kg instead of ~217) and went
// unnoticed until someone questioned an odd batch weight.
//
// An exact match between metres and an LR number is almost never legitimate,
// so it is worth stopping. It is technically possible (a 5-digit LR that
// happens to equal the metres), hence an explicit confirm rather than a hard
// block.

/** Digits-only comparison — LR numbers are free text and may carry spaces or a prefix. */
const digits = (v: unknown) => String(v ?? '').replace(/\D+/g, '')

export function lrEqualsMtr(grayMtr: unknown, transportLrNo: unknown, lrNo?: unknown): string | null {
  const m = digits(grayMtr)
  if (!m || Number(m) === 0) return null
  for (const [label, lr] of [['Transport LR', transportLrNo], ['LR No', lrNo]] as const) {
    const l = digits(lr)
    if (l && l === m) return label
  }
  return null
}

/** Message shown in the form and returned by the API. */
export function lrMtrMessage(which: string, grayMtr: unknown): string {
  return `Gray Mtr (${grayMtr}) is exactly the same number as the ${which}. ` +
    `That usually means the LR number was typed into the metres field — it silently ` +
    `distorts fold-batch weights. Check the challan; confirm only if the metres really are this value.`
}

// ── Cut (metres per than) ──────────────────────────────────────────────────
// The single most useful sanity figure at data-entry time: every lot in this
// mill runs ~215-235 m/than, so a wrong metres value is obvious the moment the
// cut is on screen (NM-758-HARI read 470 and nobody noticed for weeks).

// Deliberately WIDE. The live spread is bimodal — shirting qualities (Top
// Dyed, Magic, Citra, Raymond…) run ~100-140 m/than while the PC 62*58 range
// runs ~220-230 — so a tight global band would cry wolf on a fifth of all
// entries. These bounds only catch the absurd (a 16-than lot recorded as 16 m,
// or the 470 that started this). The real signal is the cut being ON SCREEN:
// the operator knows what their own quality should read.
export const CUT_MIN = 50
export const CUT_MAX = 320

export function cutPerThan(grayMtr: unknown, than: unknown): number | null {
  const m = Number(grayMtr)
  const t = Number(than)
  if (!Number.isFinite(m) || !Number.isFinite(t) || m <= 0 || t <= 0) return null
  return m / t
}

/** 'ok' inside the usual band, 'odd' outside it — drives the colour. */
export function cutStatus(cut: number | null): 'none' | 'ok' | 'odd' {
  if (cut == null) return 'none'
  return cut < CUT_MIN || cut > CUT_MAX ? 'odd' : 'ok'
}
