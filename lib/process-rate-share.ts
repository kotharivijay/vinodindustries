// WhatsApp-shareable image of an approved process-rate contract.
//
// Canvas-drawn rather than html2canvas: the technique is ported from
// app/(dashboard)/grey/GreyCheckingModal.tsx handleShareProgram() — compute
// every section's height BEFORE sizing the canvas, cap DPR at 2, dark header
// band + accent rule, then blob -> navigator.share with a wa.me fallback.
//
// The effective-from DATE is deliberately the loudest thing after the party
// name: it is what the party is being asked to confirm.

import { notesToPoints } from '@/lib/process-rate-notes'

export type ShareLine = {
  processTypeName: string
  rateMode: string
  unit: string
  rate: string | null
  rateLight: string | null
  rateMedium: string | null
  rateDark: string | null
}
export type ShareContract = {
  partyName: string
  version: number
  status: string
  effectiveFrom: string | Date
  validityQty: string | null
  validityUnit: string | null
  notes: string | null
  lines: ShareLine[]
  linkedLots: number
  linkedThan: number
}

const enIN = (n: number | string) => new Intl.NumberFormat('en-IN').format(Number(n))
const money = (v: string | null) => (v == null ? '—' : '₹ ' + Number(v).toFixed(2))
const fmtDate = (d: string | Date) =>
  new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

/** Greedy wrap against real measured text width. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w
    if (ctx.measureText(next).width > maxW && cur) { lines.push(cur); cur = w }
    else cur = next
  }
  if (cur) lines.push(cur)
  return lines
}

export async function buildProcessRateImage(c: ShareContract): Promise<Blob> {
  const W = 820, PAD = 18
  const points = notesToPoints(c.notes)

  // Measure the wrapped note lines first — the canvas height depends on them.
  const meas = document.createElement('canvas').getContext('2d')!
  meas.font = '13px Arial'
  const noteBodyW = W - PAD * 2 - 26
  const wrapped = points.map(p => ({ n: p.n, lines: wrap(meas, p.text, noteBodyW) }))
  const noteLineCount = wrapped.reduce((s, p) => s + p.lines.length, 0)

  const headerH = 132, secH = 26, rateRowH = 34, usageH = 34, footerH = 66
  const notesH = points.length ? secH + 8 + noteLineCount * 19 + points.length * 4 + 8 : 0
  const H = headerH + 3 + 8
    + secH + c.lines.length * rateRowH + 10
    + usageH + 10
    + notesH
    + footerH

  const cv = document.createElement('canvas')
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  cv.width = W * dpr; cv.height = H * dpr
  cv.style.width = W + 'px'; cv.style.height = H + 'px'
  const ctx = cv.getContext('2d')!
  ctx.scale(dpr, dpr)

  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H)

  // ── header ──
  ctx.fillStyle = '#1e293b'; ctx.fillRect(0, 0, W, headerH)
  ctx.fillStyle = '#e94560'; ctx.fillRect(0, headerH, W, 3)
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 20px Arial'
  ctx.fillText('KSI — APPROVED PROCESS RATE', PAD, 32)
  ctx.font = 'bold 25px Arial'
  ctx.fillText(c.partyName.length > 34 ? c.partyName.slice(0, 33) + '…' : c.partyName, PAD, 64)

  // Highlighted effective date — the thing being confirmed.
  const dateLabel = 'EFFECTIVE ' + fmtDate(c.effectiveFrom).toUpperCase()
  ctx.font = 'bold 15px Arial'
  const dw = ctx.measureText(dateLabel).width
  ctx.fillStyle = '#fbbf24'
  ctx.fillRect(PAD, 80, dw + 20, 30)
  ctx.fillStyle = '#1e293b'
  ctx.fillText(dateLabel, PAD + 10, 100)

  ctx.font = '13px Arial'; ctx.fillStyle = '#cbd5e1'
  ctx.textAlign = 'right'
  ctx.fillText(`v${c.version} · ${c.status}`, W - PAD, 100)
  ctx.textAlign = 'left'

  let y = headerH + 3 + 8
  const section = (label: string) => {
    ctx.fillStyle = '#f1f5f9'; ctx.fillRect(0, y, W, secH)
    ctx.fillStyle = '#475569'; ctx.font = 'bold 11px Arial'
    ctx.fillText(label, PAD, y + 17); y += secH
  }

  // ── rates ──
  section('RATES')
  c.lines.forEach((l, i) => {
    if (i % 2 === 0) { ctx.fillStyle = '#fafafa'; ctx.fillRect(0, y, W, rateRowH) }
    const by = l.rateMode === 'BY_COLOR_CATEGORY'
    ctx.fillStyle = '#0f172a'; ctx.font = 'bold 14px Arial'
    ctx.fillText(l.processTypeName, PAD, y + 22)
    ctx.textAlign = 'right'
    if (!by) {
      // Rate first, then tuck the mode label directly to its left — the two
      // belong together, and the old fixed x left a dead gap across the row.
      // "/than" already carries the unit, so the label is just the mode.
      const rateTxt = `${money(l.rate)} /${l.unit}`
      ctx.fillStyle = '#0f172a'; ctx.font = 'bold 17px Arial'
      ctx.fillText(rateTxt, W - PAD, y + 23)
      const rw = ctx.measureText(rateTxt).width
      ctx.fillStyle = '#94a3b8'; ctx.font = '11px Arial'
      ctx.fillText('flat', W - PAD - rw - 12, y + 23)
    } else {
      // The three colour chips fill the right; sit the label just left of them.
      ctx.fillStyle = '#94a3b8'; ctx.font = '11px Arial'
      ctx.fillText(`by colour · per ${l.unit}`, W - PAD - 3 * 108 - 12, y + 23)
      const cats: Array<[string, string | null, string]> = [
        ['LIGHT', l.rateLight, '#b45309'], ['MEDIUM', l.rateMedium, '#c2410c'], ['DARK', l.rateDark, '#6d28d9'],
      ]
      let x = W - PAD
      for (const [k, v, col] of cats.reverse()) {
        ctx.fillStyle = '#0f172a'; ctx.font = 'bold 15px Arial'; ctx.fillText(money(v), x, y + 18)
        ctx.fillStyle = col; ctx.font = '9px Arial'; ctx.fillText(k, x, y + 29)
        x -= 108
      }
    }
    ctx.textAlign = 'left'; y += rateRowH
  })
  y += 10

  // ── validity / linked (no % or over-cap — that stays internal) ──
  ctx.fillStyle = '#0f172a'; ctx.font = '13px Arial'
  const cap = c.validityQty != null ? `Valid till ${enIN(c.validityQty)} ${c.validityUnit}` : 'No quantity cap'
  ctx.fillText(`${cap}   ·   Linked ${c.linkedLots} lot${c.linkedLots === 1 ? '' : 's'} · ${enIN(c.linkedThan)} than`, PAD, y + 20)
  y += usageH + 10

  // ── notes, point-wise ──
  if (points.length) {
    section('TERMS & NOTES')
    y += 8
    ctx.font = '13px Arial'
    for (const p of wrapped) {
      ctx.fillStyle = '#4338ca'; ctx.font = 'bold 13px Arial'
      ctx.fillText(`${p.n}.`, PAD, y + 13)
      ctx.fillStyle = '#1e293b'; ctx.font = '13px Arial'
      p.lines.forEach((ln, i) => ctx.fillText(ln, PAD + 26, y + 13 + i * 19))
      y += p.lines.length * 19 + 4
    }
    y += 8
  }

  // ── footer ──
  const fy = H - footerH
  ctx.fillStyle = '#1e293b'; ctx.fillRect(0, fy, W, footerH)
  ctx.fillStyle = '#e94560'; ctx.fillRect(0, fy, W, 2)
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 14px Arial'
  ctx.fillText('Kothari Synthetic Industries', PAD, fy + 26)
  ctx.font = '12px Arial'; ctx.fillStyle = '#cbd5e1'
  ctx.fillText('Please confirm these rates and terms.', PAD, fy + 48)

  return new Promise<Blob>(resolve => cv.toBlob(b => resolve(b!), 'image/png'))
}

/** WhatsApp caption — mirrors the image so the text alone is still useful. */
export function shareCaption(c: ShareContract): string {
  const head = `*KSI — Approved Process Rate*\n${c.partyName}\n*Effective ${fmtDate(c.effectiveFrom)}*  (v${c.version})`
  const rates = c.lines.map(l =>
    l.rateMode === 'BY_COLOR_CATEGORY'
      ? `${l.processTypeName}: Light ${l.rateLight} / Medium ${l.rateMedium} / Dark ${l.rateDark} per ${l.unit}`
      : `${l.processTypeName}: ${l.rate} per ${l.unit}`).join('\n')
  const pts = notesToPoints(c.notes).map(p => `${p.n}. ${p.text}`).join('\n')
  return [head, rates, pts && `\n*Terms & notes*\n${pts}`].filter(Boolean).join('\n')
}

export async function shareProcessRateImage(c: ShareContract): Promise<void> {
  const blob = await buildProcessRateImage(c)
  const fname = `process-rate-${c.partyName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-v${c.version}.png`
  const file = new File([blob], fname, { type: 'image/png' })
  const nav = navigator as any

  if (nav.share && nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], title: `Process Rate — ${c.partyName}` }); return }
    catch (err: any) { if (err?.name === 'AbortError') return }
  }
  // Desktop: download the PNG and open WhatsApp Web with the caption.
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = fname
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  window.open(`https://wa.me/?text=${encodeURIComponent(shareCaption(c))}`, '_blank')
}
