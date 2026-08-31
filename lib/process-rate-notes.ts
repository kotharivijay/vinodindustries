// Process-rate contract notes are typed as one run-on line with the point
// numbers embedded, e.g.
//
//   "2.If chemicals are not available, charge Rs.8 Than 4.Direct Balotra ki Lr
//    Per 5/- Fright Extra Hoga 5.Direct Balotra Ki Lr pe marks & TP Silae
//    Rs.8.50 Extra Hoga 7.Standerd Batch 22 than wt 200 kg.20 than Batch
//    10/-,18 than Batch 20/- Extra"
//
// which is unreadable on screen and worse in a shared image. This splits it
// back into points and RENUMBERS them 1..n, so the typed run (2,4,5,5,7 above
// — gaps and a repeat) comes out clean and sequential.

export type NotePoint = { n: string | null; text: string }

// A point starts at a 1-2 digit number + '.' that begins a word. The
// begins-a-word rule is what stops "Rs.8.50" splitting at "8." and
// "200 kg.20 than" splitting at all — in both, the digits sit mid-token.
const POINT_RE = /(^|\s)(\d{1,2})\.\s*(?=\S)/g

export function notesToPoints(notes: string | null | undefined): NotePoint[] {
  const raw = (notes ?? '').trim()
  if (!raw) return []

  let texts: string[]

  if (/[\r\n]/.test(raw)) {
    // Already laid out by hand (newlines / bullets) — respect the breaks, but
    // drop any typed numbering so the renumbering below is the only source.
    texts = raw
      .split(/[\r\n]+/)
      .map(l => l.replace(/^[•\-*]\s*/, '').replace(/^\d{1,2}\.\s*/, '').trim())
      .filter(Boolean)
  } else {
    const starts: Array<{ at: number; after: number }> = []
    for (const m of raw.matchAll(POINT_RE)) {
      const lead = m[1] ?? ''
      starts.push({ at: m.index! + lead.length, after: m.index! + m[0].length })
    }
    if (starts.length === 0) return [{ n: '1', text: raw }]

    texts = []
    // Anything before the first number is a preamble — kept as its own point.
    const preamble = raw.slice(0, starts[0].at).trim()
    if (preamble) texts.push(preamble)
    for (let i = 0; i < starts.length; i++) {
      const end = i + 1 < starts.length ? starts[i + 1].at : raw.length
      const t = raw.slice(starts[i].after, end).trim().replace(/[,;]\s*$/, '')
      if (t) texts.push(t)
    }
  }

  return texts.map((text, i) => ({ n: String(i + 1), text }))
}

/** Plain-text rendering used by the WhatsApp caption and the share image. */
export function notesToLines(notes: string | null | undefined): string[] {
  return notesToPoints(notes).map(p => (p.n ? `${p.n}. ${p.text}` : p.text))
}
