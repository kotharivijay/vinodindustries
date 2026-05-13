'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import BackButton from '../../BackButton'

type SortBy = 'date-desc' | 'date-asc' | 'party-asc' | 'party-desc' | 'amount-desc' | 'amount-asc'
const SORT_OPTIONS: [SortBy, string][] = [
  ['date-desc', 'Date ↓'],
  ['date-asc', 'Date ↑'],
  ['party-asc', 'Party A→Z'],
  ['party-desc', 'Party Z→A'],
  ['amount-desc', 'Amount ↓'],
  ['amount-asc', 'Amount ↑'],
]
const SORT_KEY = 'ksi:accounts-receipts:sortBy'
// Tab-session-scoped store for the filter / selection state. Survives
// back navigation and intra-tab reloads; lost when the tab closes,
// which is the right scope for "show me what I was just looking at".
const STATE_KEY = 'ksi:accounts-receipts:state'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface LinkedInvoice {
  vchType: string
  vchNumber: string
  date?: string | null
  allocatedAmount: number
  tdsAmount: number
  discountAmount: number
  pending: number
  invoiceTotalAmount?: number
  invoiceNetAmount?: number
}
interface Receipt {
  id: number
  fy: string
  date: string
  vchNumber: string
  vchType: string
  partyName: string
  amount: number
  direction: 'in' | 'out'
  narration: string | null
  instrumentNo: string | null
  bankRef: string | null
  hidden: boolean
  hiddenReason: string | null
  carryOverPriorFy: number
  tallyPushedAt: string | null
  linkedCount: number
  linkedCash: number
  linkedTds: number
  linkedDiscount: number
  linkedInvoices: LinkedInvoice[]
}
type LinkFilter = 'all' | 'linked' | 'unlinked'

interface DryRunReceipt { id: number; vchType: string; vchNumber: string; date: string; amount: number; partyName: string; carryOverPriorFy?: number; additionalCarryOver?: number }
interface DryRunInvoice { id: number; vchType: string; vchNumber: string; date: string; totalAmount: number; taxableAmount: number | null; partyGstin: string | null; pending: number; isCN?: boolean; skipAutoLink?: boolean; skipAutoLinkReason?: string | null }
interface DryRunSplit { receiptId: number; allocatedAmount: number }
interface DryRunPlanRow { invoiceId: number; allocations: DryRunSplit[] }
interface DryRunResponse {
  dryRun: true
  plan: DryRunPlanRow[]
  totals: { receipts: number; linked: number; carryOver?: number; delta: number; leftoverReceipt: number; leftoverInvoice: number }
  receipts: DryRunReceipt[]
  invoices: DryRunInvoice[]
  includeAdvance: boolean
  advanceCount?: number
}
// Per-invoice editable state. Cash splits are NOT stored here — they
// are derived via re-FIFO whenever TDS / discount change, so that the
// cash actually flowing from receipts to this invoice always equals
//   cash = pending − TDS − discount
// and any leftover from a receipt automatically rolls to the next
// invoice.
interface RowState {
  invoiceId: number
  selected: boolean       // false → invoice is skipped in manual mode
  // Auto FIFO only allocates to invoices that can be fully closed
  // (cash >= targetCash). When a row would be short, it's skipped
  // unless the user explicitly opts in by setting allowPartial=true.
  // Manual mode ignores this flag (user is being explicit).
  allowPartial: boolean
  tdsRatePct: number | null
  tdsAmount: number
  discountPct: number | null
  discountAmount: number
  // For CN rows only — how much of the CN to knock off in this bulk
  // operation. Defaults to inv.pending so the full CN is consumed.
  // Always attributed to the oldest selected receipt at commit time;
  // the server flips the sign so it FREES cash on that receipt.
  cnKnockoffAmount?: number
}
type BulkMode = 'auto' | 'manual'
const DEFAULT_TDS_RATE = 2
const round2 = (n: number) => Math.round(n * 100) / 100
interface FyTotal { fy: string; count: number; total: number }

const fmtDate = (iso: string) => {
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}-${d.toLocaleString('en-IN', { month: 'short' })}-${String(d.getFullYear()).slice(2)}`
}
const fmtMoney = (n: number) =>
  n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function ReceiptsPage() {
  const router = useRouter()
  // Multiple FYs can be active at once — clicking a tab toggles it. Must
  // keep at least one selected (no empty state).
  const [activeFys, setActiveFys] = useState<Set<string>>(new Set(['26-27']))
  const [sortBy, setSortBy] = useState<SortBy>('date-desc')
  const [showHidden, setShowHidden] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string>('')
  // Highlight + scroll-restore for back-nav: the detail page sets a
  // `receipts.lastViewedId` cookie on outbound click; on return we read
  // it once, scroll that card into view, and pulse a violet ring.
  const [lastViewedId, setLastViewedId] = useState<number | null>(null)
  const lastViewedRef = useRef<HTMLDivElement | null>(null)
  const [syncLog, setSyncLog] = useState<string[]>([])
  // Date filter — 'fy' (whole FY tab), 'month' (specific month), 'range'
  const [filterMode, setFilterMode] = useState<'fy' | 'month' | 'range'>('fy')
  const [pickedMonth, setPickedMonth] = useState<string>('')  // "2026-05"
  const [rangeFrom, setRangeFrom] = useState<string>('')      // "2026-05-01"
  const [rangeTo, setRangeTo] = useState<string>('')          // "2026-05-31"
  // Link-status filter: All / Linked / Unlinked. When 'linked' is active,
  // the "Hide matched (±1)" pill also becomes available — a fully-matched
  // receipt has |amount − Σ allocatedAmount| ≤ ₹1.
  const [linkFilter, setLinkFilter] = useState<LinkFilter>('all')
  const [hideMatched, setHideMatched] = useState(false)
  const [partyQuery, setPartyQuery] = useState<string>('')
  const [bulkOpen, setBulkOpen] = useState(false)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SORT_KEY)
      if (saved && SORT_OPTIONS.some(([k]) => k === saved)) setSortBy(saved as SortBy)
    } catch {}
  }, [])
  useEffect(() => {
    try { localStorage.setItem(SORT_KEY, sortBy) } catch {}
  }, [sortBy])

  // Hydrate filter / selection state from sessionStorage on mount so
  // back-navigation lands the user back exactly where they were
  // (selected FYs, party search, select mode + selection, etc).
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STATE_KEY)
      if (!raw) return
      const s = JSON.parse(raw)
      if (Array.isArray(s.activeFys) && s.activeFys.length > 0) setActiveFys(new Set(s.activeFys))
      if (typeof s.partyQuery === 'string') setPartyQuery(s.partyQuery)
      if (s.linkFilter === 'all' || s.linkFilter === 'linked' || s.linkFilter === 'unlinked') setLinkFilter(s.linkFilter)
      if (typeof s.hideMatched === 'boolean') setHideMatched(s.hideMatched)
      if (s.filterMode === 'fy' || s.filterMode === 'month' || s.filterMode === 'range') setFilterMode(s.filterMode)
      if (typeof s.pickedMonth === 'string') setPickedMonth(s.pickedMonth)
      if (typeof s.rangeFrom === 'string') setRangeFrom(s.rangeFrom)
      if (typeof s.rangeTo === 'string') setRangeTo(s.rangeTo)
      if (typeof s.showHidden === 'boolean') setShowHidden(s.showHidden)
      if (typeof s.selectMode === 'boolean') setSelectMode(s.selectMode)
      if (Array.isArray(s.selected)) setSelected(new Set(s.selected.filter((n: any) => Number.isFinite(n))))
    } catch {}
  }, [])
  useEffect(() => {
    try {
      sessionStorage.setItem(STATE_KEY, JSON.stringify({
        activeFys: [...activeFys],
        partyQuery,
        linkFilter,
        hideMatched,
        filterMode,
        pickedMonth,
        rangeFrom,
        rangeTo,
        showHidden,
        selectMode,
        selected: [...selected],
      }))
    } catch {}
  }, [activeFys, partyQuery, linkFilter, hideMatched, filterMode, pickedMonth, rangeFrom, rangeTo, showHidden, selectMode, selected])

  const { data, mutate, isLoading } = useSWR<{ rows: Receipt[]; fyTotals: FyTotal[]; hiddenCount: number }>(
    `/api/accounts/receipts?fy=${[...activeFys].join(',')}&direction=in${showHidden ? '&showHidden=1' : ''}`,
    fetcher,
  )

  // Clear selection when select mode toggles off. FY / showHidden
  // changes used to clear selection too, but that fought against
  // sessionStorage restoration; selections now persist across filter
  // changes (use Clear or exit Select mode to reset).
  useEffect(() => { if (!selectMode) setSelected(new Set()) }, [selectMode])

  // Read the last-viewed receipt id once on mount (set by an outbound
  // card click). The card-rendering pass below adds the violet ring
  // and assigns lastViewedRef; once data has loaded, scroll the marked
  // card into view and clear the stored id so we don't pin forever.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('receipts.lastViewedId')
      if (raw) {
        const n = parseInt(raw)
        if (Number.isFinite(n)) setLastViewedId(n)
      }
    } catch {}
  }, [])
  useEffect(() => {
    if (lastViewedId == null || isLoading) return
    if (!lastViewedRef.current) return
    lastViewedRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    // Highlight stays until the user clicks another card — that click
    // writes a new id to sessionStorage and the next back-nav remount
    // reads it. No auto-clear.
  }, [lastViewedId, isLoading, data])

  function toggleSelect(id: number) {
    setSelected(prev => {
      const s = new Set(prev)
      s.has(id) ? s.delete(id) : s.add(id)
      return s
    })
  }

  const [sharingLinkedPdf, setSharingLinkedPdf] = useState(false)
  async function shareLinkedReceiptsPdf() {
    if (sharingLinkedPdf) return
    const picked = rows.filter(r => selected.has(r.id) && r.linkedCount > 0)
    if (picked.length === 0) { alert('Pick at least one LINKED receipt to share.'); return }
    setSharingLinkedPdf(true)
    try {
      const [jsPDFMod, html2canvasMod] = await Promise.all([import('jspdf'), import('html2canvas')])
      const jsPDF = jsPDFMod.default
      const html2canvas = html2canvasMod.default

      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      const PAGE_W = doc.internal.pageSize.getWidth()
      const PAGE_H = doc.internal.pageSize.getHeight()
      const MARGIN = 8
      const SPACING = 4 // mm between captured cards
      const CONTENT_W = PAGE_W - MARGIN * 2

      // Title
      doc.setFontSize(14)
      doc.setFont('helvetica', 'bold')
      doc.text('Linked Receipts Report', MARGIN, MARGIN + 5)
      doc.setFontSize(9)
      doc.setFont('helvetica', 'normal')
      const totalReceived = picked.reduce((s, r) => s + r.amount, 0)
      doc.text(`${picked.length} receipts · received ₹${fmtMoney(totalReceived)} · as of ${new Date().toLocaleDateString('en-IN')}`, MARGIN, MARGIN + 10)

      let y = MARGIN + 14
      const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')

      // Sort oldest-first for a stable order
      const sorted = [...picked].sort((a, b) =>
        new Date(a.date).getTime() - new Date(b.date).getTime() || a.id - b.id)

      for (const r of sorted) {
        const el = document.querySelector<HTMLElement>(`[data-receipt-id="${r.id}"]`)
        if (!el) continue
        // Snapshot the live React-rendered card so the PDF matches the UI
        // exactly (badges, party name, narration, every linked-invoice line).
        const canvas = await html2canvas(el, {
          backgroundColor: isDark ? '#111827' : '#ffffff',
          scale: 2,
          useCORS: true,
          logging: false,
        })
        const imgData = canvas.toDataURL('image/png')
        const imgW = CONTENT_W
        const imgH = (canvas.height / canvas.width) * imgW
        // Page break if the next card won't fit
        if (y + imgH > PAGE_H - MARGIN) {
          doc.addPage()
          y = MARGIN
        }
        doc.addImage(imgData, 'PNG', MARGIN, y, imgW, imgH)
        y += imgH + SPACING
      }

      // Grand totals at the end
      const totalCash = picked.reduce((s, r) => s + r.linkedCash, 0)
      const totalTds = picked.reduce((s, r) => s + r.linkedTds, 0)
      const totalDisc = picked.reduce((s, r) => s + r.linkedDiscount, 0)
      const totalCarry = picked.reduce((s, r) => s + r.carryOverPriorFy, 0)
      const totalOnAcc = picked.reduce((s, r) => s + Math.max(0, r.amount - r.linkedCash - r.carryOverPriorFy), 0)
      if (y + 35 > PAGE_H - MARGIN) { doc.addPage(); y = MARGIN }
      doc.setFontSize(11)
      doc.setFont('helvetica', 'bold')
      doc.text('Grand Totals', MARGIN, y + 4)
      doc.setFontSize(9)
      doc.setFont('helvetica', 'normal')
      const rows2 = [
        ['Receipts', `${sorted.length}`],
        ['Σ Received', `₹${fmtMoney(totalReceived)}`],
        ['Σ Cash allocated', `₹${fmtMoney(totalCash)}`],
        ['Σ TDS', `₹${fmtMoney(totalTds)}`],
        ['Σ Discount', `₹${fmtMoney(totalDisc)}`],
        ['Σ Carry-over (prior FY)', `₹${fmtMoney(totalCarry)}`],
        ['Σ On-account', `₹${fmtMoney(totalOnAcc)}`],
      ]
      let ty = y + 9
      for (const [k, v] of rows2) {
        doc.text(k, MARGIN, ty)
        doc.text(v, PAGE_W - MARGIN, ty, { align: 'right' })
        ty += 5
      }

      const blob = doc.output('blob') as Blob
      const fname = `LinkedReceipts-${new Date().toISOString().slice(0, 10)}.pdf`
      const file = new File([blob], fname, { type: 'application/pdf' })
      if (typeof navigator !== 'undefined' && (navigator as any).canShare?.({ files: [file] })) {
        try { await (navigator as any).share({ files: [file], title: 'Linked Receipts Report' }); return } catch {}
      }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = fname; a.click()
      URL.revokeObjectURL(url)
      window.open(`https://wa.me/?text=${encodeURIComponent('Linked Receipts Report (PDF attached)')}`, '_blank')
    } finally { setSharingLinkedPdf(false) }
  }

  // View 2: structured table per receipt. Bank header text + a 7-column
  // allocation table (Date · Invoice · Original · TDS · Disc · Pending ·
  // Due Days). Due Days = invoice.date − receipt.date in whole days.
  const [sharingLinkedV2, setSharingLinkedV2] = useState(false)
  async function shareLinkedReceiptsPdfV2() {
    if (sharingLinkedV2) return
    const picked = rows.filter(r => selected.has(r.id) && r.linkedCount > 0)
    if (picked.length === 0) { alert('Pick at least one LINKED receipt to share.'); return }
    setSharingLinkedV2(true)
    try {
      const { default: jsPDF } = await import('jspdf')
      const { default: autoTable } = await import('jspdf-autotable')
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      const MARGIN = 12

      const fmtD = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
      const sorted = [...picked].sort((a, b) =>
        new Date(a.date).getTime() - new Date(b.date).getTime() || a.id - b.id)

      doc.setFontSize(14)
      doc.setFont('helvetica', 'bold')
      doc.text('Linked Receipts — View 2', MARGIN, MARGIN + 2)
      doc.setFontSize(9)
      doc.setFont('helvetica', 'normal')
      const totalReceived = sorted.reduce((s, r) => s + r.amount, 0)
      doc.text(`${sorted.length} receipts · received ₹${fmtMoney(totalReceived)} · as of ${new Date().toLocaleDateString('en-IN')}`, MARGIN, MARGIN + 7)

      let y = MARGIN + 12
      let gTotalCash = 0, gTotalTds = 0, gTotalDisc = 0

      for (const r of sorted) {
        if (y > 250) { doc.addPage(); y = MARGIN }
        // ── Per-receipt bank/header block ──
        doc.setFontSize(11)
        doc.setFont('helvetica', 'bold')
        doc.text(`#${r.vchNumber} — ${r.partyName}`, MARGIN, y)
        y += 5
        doc.setFontSize(9)
        doc.setFont('helvetica', 'normal')
        const headerLine = [
          fmtD(r.date),
          `₹${fmtMoney(r.amount)}`,
          r.instrumentNo ? `Ref ${r.instrumentNo}` : '',
          r.bankRef ? `UTR ${r.bankRef}` : '',
          r.tallyPushedAt ? '✓ Pushed' : '',
        ].filter(Boolean).join('  ·  ')
        doc.text(headerLine, MARGIN, y)
        y += 2

        const receiptMs = new Date(r.date).getTime()

        autoTable(doc, {
          head: [[
            'Date',
            'Invoice',
            { content: 'Original', styles: { halign: 'right' } },
            { content: 'TDS', styles: { halign: 'right' } },
            { content: 'Discount', styles: { halign: 'right' } },
            { content: 'Pending', styles: { halign: 'right' } },
            { content: 'Due Days', styles: { halign: 'right' } },
          ]],
          body: r.linkedInvoices.map(inv => {
            const isCN = inv.allocatedAmount < 0
            const orig = inv.invoiceTotalAmount ?? Math.abs(inv.allocatedAmount)
            const invDate = (inv as any).date
              ? new Date((inv as any).date)
              : null
            const dueDays = invDate ? Math.round((invDate.getTime() - receiptMs) / 86400000) : null
            return [
              invDate ? fmtD(invDate.toISOString()) : '—',
              `${inv.vchType} ${inv.vchNumber}${isCN ? ' (CN)' : ''}`,
              `${isCN ? '−' : ''}₹${fmtMoney(orig)}`,
              inv.tdsAmount > 0 ? `₹${fmtMoney(inv.tdsAmount)}` : '—',
              inv.discountAmount > 0 ? `₹${fmtMoney(inv.discountAmount)}` : '—',
              `₹${fmtMoney(inv.pending)}`,
              dueDays != null ? `${dueDays > 0 ? '+' : ''}${dueDays}` : '—',
            ]
          }),
          startY: y,
          styles: { fontSize: 8, cellPadding: 1.5 },
          headStyles: { fillColor: [99, 102, 241], textColor: 255, fontStyle: 'bold' },
          columnStyles: {
            1: { fontStyle: 'bold' },
            2: { halign: 'right' },
            3: { halign: 'right' },
            4: { halign: 'right' },
            5: { halign: 'right' },
            6: { halign: 'right' },
          },
          margin: { left: MARGIN, right: MARGIN },
        })
        y = (doc as any).lastAutoTable.finalY + 2

        // Per-receipt summary line
        doc.setFontSize(9)
        doc.setFont('helvetica', 'italic')
        const onAcc = Math.max(0, r.amount - r.linkedCash - r.carryOverPriorFy)
        gTotalCash += r.linkedCash
        gTotalTds += r.linkedTds
        gTotalDisc += r.linkedDiscount
        doc.text(
          `Linked cash ₹${fmtMoney(r.linkedCash)}  ·  TDS ₹${fmtMoney(r.linkedTds)}  ·  disc ₹${fmtMoney(r.linkedDiscount)}` +
          (onAcc > 0.5 ? `  ·  on-account ₹${fmtMoney(onAcc)}` : '  ·  ✓ fully matched'),
          MARGIN, y + 4,
        )
        doc.setFont('helvetica', 'normal')
        y += 11
      }

      // Grand totals
      if (y > 240) { doc.addPage(); y = MARGIN }
      doc.setFontSize(11)
      doc.setFont('helvetica', 'bold')
      doc.text('Grand Totals', MARGIN, y + 4)
      const totalsRows: [string, string][] = [
        ['Receipts', `${sorted.length}`],
        ['Σ Received', `₹${fmtMoney(totalReceived)}`],
        ['Σ Cash allocated', `₹${fmtMoney(gTotalCash)}`],
        ['Σ TDS', `₹${fmtMoney(gTotalTds)}`],
        ['Σ Discount', `₹${fmtMoney(gTotalDisc)}`],
      ]
      doc.setFontSize(9)
      doc.setFont('helvetica', 'normal')
      let ty = y + 9
      for (const [k, v] of totalsRows) {
        doc.text(k, MARGIN, ty)
        doc.text(v, doc.internal.pageSize.getWidth() - MARGIN, ty, { align: 'right' })
        ty += 5
      }

      const blob = doc.output('blob') as Blob
      const fname = `LinkedReceipts-V2-${new Date().toISOString().slice(0, 10)}.pdf`
      const file = new File([blob], fname, { type: 'application/pdf' })
      if (typeof navigator !== 'undefined' && (navigator as any).canShare?.({ files: [file] })) {
        try { await (navigator as any).share({ files: [file], title: 'Linked Receipts — View 2' }); return } catch {}
      }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = fname; a.click()
      URL.revokeObjectURL(url)
      window.open(`https://wa.me/?text=${encodeURIComponent('Linked Receipts — View 2 (PDF attached)')}`, '_blank')
    } finally { setSharingLinkedV2(false) }
  }

  async function bulkHide(hidden: boolean) {
    if (selected.size === 0) return
    let reason: string | null = null
    if (hidden) {
      const r = window.prompt('Reason (optional, e.g. "loan", "refund", "internal transfer"):') ?? ''
      reason = r.trim() || null
      if (!confirm(`Hide ${selected.size} receipt(s) as not-related-to-sales?`)) return
    }
    try {
      const res = await fetch('/api/accounts/receipts/bulk-hide', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...selected], hidden, reason }),
      })
      const d = await res.json()
      if (!res.ok) { alert(d.error || 'Failed'); return }
      setSelected(new Set())
      mutate()
    } catch (e: any) { alert(e?.message || 'Network error') }
  }

  const apiRows = data?.rows ?? []

  // Months for the picker — union across every selected FY, deduped and
  // sorted ascending (Apr of earliest FY → Mar of latest FY).
  const monthOptions = useMemo(() => {
    const seen = new Set<string>()
    const months: { value: string; label: string }[] = []
    const sortedFys = [...activeFys].sort()
    for (const fy of sortedFys) {
      const startYear = 2000 + parseInt(fy.split('-')[0])
      for (let i = 0; i < 12; i++) {
        const y = i < 9 ? startYear : startYear + 1
        const m = ((i + 3) % 12) + 1
        const value = `${y}-${String(m).padStart(2, '0')}`
        if (seen.has(value)) continue
        seen.add(value)
        const label = `${new Date(y, m - 1).toLocaleString('en-IN', { month: 'short' })} ${String(y).slice(2)}`
        months.push({ value, label })
      }
    }
    return months
  }, [activeFys])

  const rows = useMemo(() => {
    const dateKey = (r: Receipt) => new Date(r.date).getTime()
    const partyKey = (r: Receipt) => (r.partyName || '').toLowerCase()

    // Apply month / range filter on top of the FY-scoped API result.
    let filtered = apiRows
    if (filterMode === 'month' && pickedMonth) {
      const [y, m] = pickedMonth.split('-').map(Number)
      const start = new Date(y, m - 1, 1).getTime()
      const end = new Date(y, m, 0, 23, 59, 59).getTime()
      filtered = filtered.filter(r => {
        const t = new Date(r.date).getTime()
        return t >= start && t <= end
      })
    } else if (filterMode === 'range' && rangeFrom && rangeTo) {
      const start = new Date(rangeFrom + 'T00:00:00').getTime()
      const end = new Date(rangeTo + 'T23:59:59').getTime()
      filtered = filtered.filter(r => {
        const t = new Date(r.date).getTime()
        return t >= start && t <= end
      })
    }

    if (linkFilter === 'linked') {
      filtered = filtered.filter(r => r.linkedCount > 0 || r.carryOverPriorFy > 0)
      if (hideMatched) {
        filtered = filtered.filter(r => Math.abs(r.amount - r.linkedCash - (r.carryOverPriorFy || 0)) > 1)
      }
    } else if (linkFilter === 'unlinked') {
      filtered = filtered.filter(r => r.linkedCount === 0 && (r.carryOverPriorFy || 0) === 0)
    }

    const q = partyQuery.trim().toLowerCase()
    if (q) filtered = filtered.filter(r => (r.partyName || '').toLowerCase().includes(q))

    const sorted = [...filtered]
    switch (sortBy) {
      case 'date-desc':   sorted.sort((a, b) => dateKey(b) - dateKey(a) || b.id - a.id); break
      case 'date-asc':    sorted.sort((a, b) => dateKey(a) - dateKey(b) || a.id - b.id); break
      case 'party-asc':   sorted.sort((a, b) => partyKey(a).localeCompare(partyKey(b)) || dateKey(b) - dateKey(a)); break
      case 'party-desc':  sorted.sort((a, b) => partyKey(b).localeCompare(partyKey(a)) || dateKey(b) - dateKey(a)); break
      case 'amount-desc': sorted.sort((a, b) => b.amount - a.amount || dateKey(b) - dateKey(a)); break
      case 'amount-asc':  sorted.sort((a, b) => a.amount - b.amount || dateKey(b) - dateKey(a)); break
    }
    return sorted
  }, [apiRows, sortBy, filterMode, pickedMonth, rangeFrom, rangeTo, linkFilter, hideMatched, partyQuery])

  const filteredTotal = useMemo(() => rows.reduce((s, r) => s + r.amount, 0), [rows])
  // Counts for the link-filter pills — based on the FY-scoped api result
  // (ignores month/range so users see the global count when picking).
  const linkCounts = useMemo(() => {
    let linked = 0, unlinked = 0
    for (const r of apiRows) {
      if (r.linkedCount > 0) linked++; else unlinked++
    }
    return { all: apiRows.length, linked, unlinked }
  }, [apiRows])
  const fyTotals = data?.fyTotals ?? []
  const fyMap = useMemo(() => new Map(fyTotals.map(f => [f.fy, f])), [fyTotals])
  const tabs: { fy: string; label: string }[] = [
    { fy: '24-25', label: 'FY 24-25' },
    { fy: '25-26', label: 'FY 25-26' },
    { fy: '26-27', label: 'FY 26-27' },
  ]

  async function syncTallyAllocations() {
    const from = window.prompt('Sync from date (YYYY-MM-DD)?', '2025-04-01')
    if (!from) return
    const to = window.prompt('Sync to date (YYYY-MM-DD)?', new Date().toISOString().slice(0, 10))
    if (!to) return
    if (!confirm(`Read every Receipt voucher from Tally between ${from} and ${to} and auto-stamp the ones already linked bill-wise (Agst Ref) as "pushed"?\n\nReceipts sitting On Account in Tally are left alone.`)) return
    setSyncing(true); setSyncMsg('Reading Receipt vouchers from Tally…')
    try {
      const res = await fetch('/api/accounts/receipts/sync-tally-allocations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to }),
      })
      const d = await res.json()
      if (!res.ok) { setSyncMsg(d.error || 'Failed'); return }
      setSyncMsg(`Tally: ${d.tally.total} receipts · ${d.tally.billWise} bill-wise · ${d.tally.onAccountOnly} on-account. Stamped ${d.stamped.updated} (already ${d.stamped.alreadyStamped}, not in DB ${d.stamped.notFound}).`)
      mutate()
    } catch (e: any) { setSyncMsg(e?.message || 'Network error') }
    finally { setSyncing(false) }
  }

  async function syncFys(fys: string[]) {
    setSyncing(true); setSyncMsg(''); setSyncLog([])
    let totalSaved = 0, totalFetched = 0, totalIn = 0, totalOut = 0
    const todayMs = Date.now()
    const log = (line: string) => setSyncLog(prev => [...prev, line])

    // Build per-month chunks across every selected FY so each call to
    // /ksi-hdfc-sync handles a single month — stays well under the
    // Vercel function timeout.
    const chunks: { from: string; to: string; label: string; fy: string }[] = []
    for (const fy of fys) {
      const startYear = 2000 + parseInt(fy.split('-')[0])
      const endYear = startYear + 1
      const fyEnd = new Date(endYear, 2, 31)
      const endDate = fyEnd.getTime() < todayMs ? fyEnd : new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00')
      let cur = new Date(startYear, 3, 1)
      while (cur.getTime() <= endDate.getTime()) {
        const monthEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0)
        const chunkEnd = monthEnd.getTime() > endDate.getTime() ? endDate : monthEnd
        const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        const label = `${cur.toLocaleString('en-IN', { month: 'short' })} ${String(cur.getFullYear()).slice(2)}`
        chunks.push({ from: iso(cur), to: iso(chunkEnd), label, fy })
        cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
      }
    }
    log(`▶ FY ${fys.join(', ')} · ${chunks.length} months to sync`)

    try {
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i]
        const startedAt = Date.now()
        setSyncMsg(`Syncing ${c.label} (${i + 1}/${chunks.length})…`)
        const r = await fetch('/api/tally/ksi-hdfc-sync', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: c.from, to: c.to }),
        })
        const d = await r.json()
        const sec = ((Date.now() - startedAt) / 1000).toFixed(1)
        if (!r.ok) {
          log(`✗ ${c.label}  ${sec}s  ${d.error || r.statusText}`)
          setSyncMsg(`Failed at ${c.label}: ${d.error || r.statusText}. Partial: ${totalSaved}/${totalFetched}.`)
          mutate()
          return
        }
        log(`✓ ${c.label}  ${sec}s  ${d.saved}/${d.fetched} rows · IN ₹${fmtMoney(d.inflow || 0)} · OUT ₹${fmtMoney(d.outflow || 0)}`)
        totalSaved += d.saved || 0
        totalFetched += d.fetched || 0
        totalIn += d.inflow || 0
        totalOut += d.outflow || 0
      }
      log(`✅ Done · ${totalSaved}/${totalFetched} rows · IN ₹${fmtMoney(totalIn)} · OUT ₹${fmtMoney(totalOut)}`)
      setSyncMsg(`Synced ${totalSaved}/${totalFetched} rows across ${chunks.length} months · IN ₹${fmtMoney(totalIn)} · OUT ₹${fmtMoney(totalOut)}`)
      mutate()
    } catch (e: any) {
      log(`✗ Network error: ${e?.message || 'unknown'}`)
      setSyncMsg(`${e?.message || 'Network error'}. Partial: ${totalSaved}/${totalFetched}.`)
      mutate()
    } finally { setSyncing(false) }
  }

  return (
    <div className="max-w-3xl mx-auto p-3 pb-20">
      <div className="flex items-center gap-2 mb-3">
        <BackButton />
        <h1 className="text-base sm:text-lg font-bold text-gray-800 dark:text-gray-100">Receipts · HDFC BANK</h1>
      </div>

      {/* FY tabs — multi-select. Click a tab to toggle; at least one
         must remain active so the list always has a year scope. */}
      <div className="flex gap-2 mb-3">
        {tabs.map(t => {
          const total = fyMap.get(t.fy)
          const isActive = activeFys.has(t.fy)
          const onClick = () => {
            setActiveFys(prev => {
              const next = new Set(prev)
              if (next.has(t.fy)) {
                if (next.size === 1) return next  // keep at least one
                next.delete(t.fy)
              } else {
                next.add(t.fy)
              }
              return next
            })
          }
          return (
            <button key={t.fy} onClick={onClick}
              title={isActive ? 'Click to deselect' : 'Click to add this FY'}
              className={`flex-1 px-3 py-2 rounded-xl text-xs font-semibold border transition ${
                isActive
                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                  : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300'
              }`}>
              <div>{isActive && '✓ '}{t.label}</div>
              {total && (
                <div className={`text-[10px] mt-0.5 ${isActive ? 'text-emerald-50' : 'text-gray-500 dark:text-gray-400'}`}>
                  {total.count} · ₹{fmtMoney(total.total)}
                </div>
              )}
            </button>
          )
        })}
      </div>

      {/* Date filter — Whole FY / Month / Range */}
      <div className="flex items-center gap-1.5 mb-2 flex-wrap text-[11px]">
        <span className="text-gray-500 dark:text-gray-400 mr-0.5">Show:</span>
        {([['fy', 'Whole FY'], ['month', 'Month'], ['range', 'Range']] as const).map(([k, lbl]) => (
          <button key={k} onClick={() => setFilterMode(k)}
            className={`px-2.5 py-1 rounded-full border transition ${
              filterMode === k
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'
            }`}>
            {lbl}
          </button>
        ))}
        {filterMode === 'month' && (
          <select value={pickedMonth} onChange={e => setPickedMonth(e.target.value)}
            className="px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-[11px]">
            <option value="">Select month…</option>
            {monthOptions.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        )}
        {filterMode === 'range' && (
          <>
            <input type="date" value={rangeFrom} onChange={e => setRangeFrom(e.target.value)}
              className="px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-[11px]" />
            <span className="text-gray-400">→</span>
            <input type="date" value={rangeTo} onChange={e => setRangeTo(e.target.value)}
              className="px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-[11px]" />
          </>
        )}
        {filterMode !== 'fy' && (
          <span className="ml-auto text-gray-600 dark:text-gray-400 font-semibold">
            {rows.length} · ₹{fmtMoney(filteredTotal)}
          </span>
        )}
      </div>

      {/* Sync button + Show Hidden toggle */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <button onClick={() => syncFys([...activeFys].sort())} disabled={syncing}
          className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold">
          {syncing ? 'Syncing…' : `Sync FY ${[...activeFys].sort().join(', ')} from Tally`}
        </button>
        <button onClick={syncTallyAllocations} disabled={syncing}
          title="Read every Receipt voucher from Tally and auto-mark bill-wise (Agst Ref) ones as already pushed — prevents accidental duplicate journals."
          className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-xs font-semibold">
          📤 Detect Pushed
        </button>
        <button onClick={() => setSelectMode(v => !v)}
          title={selectMode ? 'Tap a card to toggle selection. Tap Select again to exit.' : 'Enable multiselect (cards become clickable for actions when off)'}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
            selectMode
              ? 'bg-emerald-600 text-white border-emerald-600'
              : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'
          }`}>
          {selectMode ? '✓ Select: ON' : '☐ Select'}
        </button>
        <button onClick={() => setShowHidden(v => !v)}
          title="Hidden = manually marked as not related to sales/process party"
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
            showHidden
              ? 'bg-amber-100 dark:bg-amber-900/40 border-amber-400 dark:border-amber-700 text-amber-800 dark:text-amber-200'
              : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'
          }`}>
          {showHidden ? '👁 Showing Hidden' : `Show Hidden${(data?.hiddenCount ?? 0) > 0 ? ` (${data?.hiddenCount})` : ''}`}
        </button>
        {syncMsg && <span className="text-[11px] text-gray-600 dark:text-gray-400 truncate">{syncMsg}</span>}
      </div>

      {syncLog.length > 0 && (
        <div className="mb-3 max-h-44 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-2 font-mono text-[10px] leading-tight space-y-0.5">
          {syncLog.map((line, i) => {
            const color = line.startsWith('✗') ? 'text-rose-600 dark:text-rose-400'
              : line.startsWith('✓') ? 'text-emerald-700 dark:text-emerald-400'
              : line.startsWith('✅') ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
              : line.startsWith('▶') ? 'text-indigo-600 dark:text-indigo-400 font-semibold'
              : 'text-gray-600 dark:text-gray-400'
            return <div key={i} className={color}>{line}</div>
          })}
        </div>
      )}

      {/* Party search */}
      <div className="flex items-center gap-1.5 mb-2">
        <input type="search" value={partyQuery} onChange={e => setPartyQuery(e.target.value)}
          placeholder="🔍 Search party…"
          className="flex-1 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-[12px] placeholder-gray-400" />
        {partyQuery && (
          <button onClick={() => setPartyQuery('')}
            className="text-[11px] px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400">
            ✕ Clear
          </button>
        )}
      </div>

      {/* Link-status filter pills */}
      <div className="flex items-center gap-1.5 mb-2 flex-wrap text-[11px]">
        <span className="text-gray-500 dark:text-gray-400 mr-0.5">Link:</span>
        {([['all', `All (${linkCounts.all})`], ['linked', `🔗 Linked (${linkCounts.linked})`], ['unlinked', `Unlinked (${linkCounts.unlinked})`]] as const).map(([k, lbl]) => (
          <button key={k} onClick={() => setLinkFilter(k as LinkFilter)}
            className={`px-2.5 py-1 rounded-full border transition ${
              linkFilter === k
                ? 'bg-emerald-600 text-white border-emerald-600'
                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'
            }`}>
            {lbl}
          </button>
        ))}
        {linkFilter === 'linked' && (
          <button onClick={() => setHideMatched(v => !v)}
            title="Hide receipts whose linked Bank Recpt equals the receipt amount within ±₹1"
            className={`px-2.5 py-1 rounded-full border transition ${
              hideMatched
                ? 'bg-amber-100 dark:bg-amber-900/40 border-amber-400 dark:border-amber-700 text-amber-800 dark:text-amber-200'
                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'
            }`}>
            {hideMatched ? '✓ Hide matched (±1)' : 'Hide matched (±1)'}
          </button>
        )}
      </div>

      {/* Sort pills */}
      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        <span className="text-[10px] text-gray-500 dark:text-gray-400 mr-1">Sort:</span>
        {SORT_OPTIONS.map(([key, label]) => (
          <button key={key} onClick={() => setSortBy(key)}
            className={`text-[11px] px-2.5 py-1 rounded-full border transition ${
              sortBy === key
                ? 'bg-emerald-600 text-white border-emerald-600'
                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* Card list */}
      {isLoading && <div className="text-center py-8 text-gray-400 text-sm">Loading…</div>}
      {!isLoading && rows.length === 0 && (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400 text-sm">
          No receipts in FY {[...activeFys].sort().join(', ')}. Tap “Sync FY” to fetch from Tally.
        </div>
      )}

      <div className="space-y-2">
        {rows.map(r => {
          const isSelected = selected.has(r.id)
          const onCardClick = () => {
            if (selectMode) toggleSelect(r.id)
            else {
              try { sessionStorage.setItem('receipts.lastViewedId', String(r.id)) } catch {}
              router.push(`/accounts/receipts/${r.id}${r.linkedCount > 0 ? '?view=linked' : ''}`)
            }
          }
          const carryOver = r.carryOverPriorFy || 0
          const diff = r.amount - r.linkedCash - carryOver
          const matched = (r.linkedCount > 0 || carryOver > 0) && Math.abs(diff) <= 1
          const isLastViewed = r.id === lastViewedId
          return (
            <div key={r.id} role="button" tabIndex={0}
              ref={el => { if (isLastViewed) lastViewedRef.current = el }}
              data-receipt-id={r.id}
              onClick={onCardClick}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCardClick() } }}
              className={`flex items-start gap-2 bg-white dark:bg-gray-800 border rounded-xl p-3 shadow-sm cursor-pointer transition hover:border-emerald-300 dark:hover:border-emerald-600/40 ${
                r.hidden ? 'opacity-60 border-amber-200 dark:border-amber-700/40' : 'border-gray-100 dark:border-gray-700'
              } ${isSelected ? 'ring-2 ring-emerald-500 border-emerald-500' : ''} ${isLastViewed ? 'ring-2 ring-violet-500 border-violet-500' : ''}`}>
              {selectMode && (
                <input type="checkbox" checked={isSelected} readOnly
                  className="mt-1.5 w-4 h-4 accent-emerald-600 shrink-0 pointer-events-none" />
              )}
              <div className="flex items-start justify-between gap-2 flex-1 min-w-0">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                      {r.vchType} #{r.vchNumber}
                    </span>
                    <span className="text-[10px] text-gray-500 dark:text-gray-400">{fmtDate(r.date)}</span>
                    {r.linkedCount > 0 && (
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        matched
                          ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
                          : 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200'
                      }`}
                        title={`${r.linkedCount} invoice(s) linked · Bank Recpt ₹${fmtMoney(r.linkedCash)}${r.linkedTds > 0 ? ` · TDS ₹${fmtMoney(r.linkedTds)}` : ''}${r.linkedDiscount > 0 ? ` · disc ₹${fmtMoney(r.linkedDiscount)}` : ''}`}>
                        🔗 {r.linkedCount}{matched ? ' ✓' : ''}
                      </span>
                    )}
                    {r.tallyPushedAt && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300"
                        title={`Pushed to Tally · ${new Date(r.tallyPushedAt).toLocaleString('en-IN')}`}>
                        📤 Pushed
                      </span>
                    )}
                    {r.hidden && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200"
                        title={r.hiddenReason || 'hidden'}>
                        Hidden{r.hiddenReason ? ` · ${r.hiddenReason}` : ''}
                      </span>
                    )}
                  </div>
                  <div className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">{r.partyName}</div>
                  {(r.bankRef || r.instrumentNo) && (
                    <div className="text-[10px] text-indigo-600 dark:text-indigo-400 mt-0.5 font-mono">
                      {r.instrumentNo && <span>ref: {r.instrumentNo}</span>}
                      {r.instrumentNo && r.bankRef && <span> · </span>}
                      {r.bankRef && <span>uniq: {r.bankRef}</span>}
                    </div>
                  )}
                  {r.narration && (
                    <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 break-words">{r.narration}</div>
                  )}
                  {r.linkedCount > 0 && (
                    <div className="mt-1 text-[10px] text-gray-600 dark:text-gray-300 space-y-0.5">
                      {r.linkedInvoices.map((inv, i) => (
                        <div key={i}>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-mono text-indigo-600 dark:text-indigo-300">{inv.vchType} {inv.vchNumber}</span>
                            <span className="tabular-nums"
                              title={`Original invoice amount (before TDS/discount). Cash allocated on this receipt: ₹${fmtMoney(Math.abs(inv.allocatedAmount))}`}>
                              {inv.allocatedAmount < 0 ? '−' : ''}₹{fmtMoney(inv.invoiceTotalAmount ?? Math.abs(inv.allocatedAmount))}
                            </span>
                            {inv.tdsAmount > 0 && <span className="text-amber-600 dark:text-amber-400">−TDS ₹{fmtMoney(inv.tdsAmount)}</span>}
                            {inv.discountAmount > 0 && <span className="text-rose-600 dark:text-rose-400">−disc ₹{fmtMoney(inv.discountAmount)}</span>}
                            {typeof inv.invoiceNetAmount === 'number' && inv.invoiceNetAmount !== 0 && (
                              <span className="text-pink-500 dark:text-pink-400 tabular-nums font-semibold"
                                title={`Invoice net = total ₹${fmtMoney(inv.invoiceTotalAmount || 0)} − Σ TDS − Σ settlement disc (across all allocations on this invoice)`}>
                                NET ₹{fmtMoney(inv.invoiceNetAmount)}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className={`text-base font-bold tabular-nums ${r.hidden ? 'text-gray-500 dark:text-gray-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                    ₹{fmtMoney(r.amount)}
                  </div>
                  {(r.linkedCount > 0 || carryOver > 0) && (
                    <>
                      {r.linkedCount > 0 && (
                        <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 tabular-nums">
                          linked ₹{fmtMoney(r.linkedCash)}
                        </div>
                      )}
                      {r.linkedTds > 0 && (
                        <div className="text-[10px] text-amber-600 dark:text-amber-400 tabular-nums" title="Total TDS across linked invoices">
                          + TDS ₹{fmtMoney(r.linkedTds)}
                        </div>
                      )}
                      {r.linkedDiscount > 0 && (
                        <div className="text-[10px] text-rose-600 dark:text-rose-400 tabular-nums" title="Total discount across linked invoices">
                          + disc ₹{fmtMoney(r.linkedDiscount)}
                        </div>
                      )}
                      {carryOver > 0 && (
                        <div className="text-[10px] text-gray-500 dark:text-gray-400 italic tabular-nums" title="Carry-over to prior FY (e.g. FY 24-25)">
                          carry-over ₹{fmtMoney(carryOver)}
                        </div>
                      )}
                      <div className={`text-[10px] font-semibold tabular-nums ${
                        matched ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
                      }`}>
                        Δ ₹{fmtMoney(diff)}
                      </div>
                      {/* Per-invoice pending — only invoices not yet
                         fully settled. Two lines: the −pending amount
                         in rose, then the invoice voucher number below
                         in smaller mono. Disappears when settled. */}
                      {r.linkedInvoices.filter(inv => inv.pending > 0.5).map((inv, i) => (
                        <div key={i} className="mt-0.5">
                          <div className="text-[10px] font-semibold text-rose-600 dark:text-rose-400 tabular-nums">
                            −pending ₹{fmtMoney(inv.pending)}
                          </div>
                          <div className="text-[9px] font-mono text-rose-500 dark:text-rose-400/80">
                            {inv.vchType} {inv.vchNumber}
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Bottom action bar — appears only when something is selected */}
      {selected.size > 0 && (
        <div className="fixed bottom-3 left-3 right-3 z-40 max-w-3xl mx-auto bg-gray-900 text-gray-100 rounded-xl shadow-2xl border border-emerald-500/40 px-3 py-2.5 flex items-center gap-2 flex-wrap">
          <div className="flex-1 min-w-0 text-xs">
            <span className="font-semibold">{selected.size} selected</span>
            {partyQuery.trim() && (
              <span className="ml-1.5 text-gray-300">· {partyQuery.trim()}</span>
            )}
          </div>
          <button onClick={() => setSelected(new Set(rows.map(r => r.id)))}
            disabled={rows.length === 0 || selected.size === rows.length}
            title="Select every receipt currently visible (after filters / search)"
            className="text-xs text-gray-300 hover:text-white px-2.5 py-1.5 rounded-lg border border-gray-600 disabled:opacity-40">
            ☑ All ({rows.length})
          </button>
          <button onClick={() => setSelected(new Set())}
            className="text-xs text-gray-300 hover:text-white px-2.5 py-1.5 rounded-lg border border-gray-600">
            Clear
          </button>
          {partyQuery.trim() && !showHidden && (
            <button onClick={() => setBulkOpen(true)}
              title="Auto-link selected receipts to this party's pending invoices (oldest first)"
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold">
              🔗 Bulk Link
            </button>
          )}
          {(() => {
            const linkedCount = rows.filter(r => selected.has(r.id) && r.linkedCount > 0).length
            if (linkedCount === 0) return null
            return (
              <>
                <button onClick={shareLinkedReceiptsPdf} disabled={sharingLinkedPdf}
                  title="View 1 — snapshot each receipt CARD as it shows on screen"
                  className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-semibold">
                  {sharingLinkedPdf ? 'Building…' : `📤 V1 (${linkedCount})`}
                </button>
                <button onClick={shareLinkedReceiptsPdfV2} disabled={sharingLinkedV2}
                  title="View 2 — bank header + tabular allocations (Date · Invoice · Original · TDS · Disc · Pending · Due Days)"
                  className="bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-semibold">
                  {sharingLinkedV2 ? 'Building…' : `📤 V2 (${linkedCount})`}
                </button>
              </>
            )
          })()}
          {showHidden ? (
            <button onClick={() => bulkHide(false)}
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold">
              ↩ Restore
            </button>
          ) : (
            <button onClick={() => bulkHide(true)}
              className="bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold">
              🚫 Mark Not Sales
            </button>
          )}
        </div>
      )}

      {bulkOpen && (
        <BulkLinkSheet
          receiptIds={[...selected]}
          partyName={partyQuery.trim()}
          onClose={() => setBulkOpen(false)}
          onDone={(saved) => {
            setBulkOpen(false)
            setSelected(new Set())
            setSelectMode(false)
            mutate()
            setSyncMsg(`Linked ${saved} allocation(s).`)
          }}
        />
      )}
    </div>
  )
}

function BulkLinkSheet({
  receiptIds, partyName, onClose, onDone,
}: { receiptIds: number[]; partyName: string; onClose: () => void; onDone: (saved: number) => void }) {
  const [includeAdvance, setIncludeAdvance] = useState(false)
  const [mode, setMode] = useState<BulkMode>('auto')
  const [data, setData] = useState<DryRunResponse | null>(null)
  const [rows, setRows] = useState<RowState[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [conflicts, setConflicts] = useState<{ receiptId: number; vchNumber: string; existingLinks: number }[] | null>(null)
  const [committing, setCommitting] = useState(false)
  // Two-step commit: clicking "Preview" opens a read-only review modal
  // listing every selected row's cash / TDS / discount math + totals.
  // Only after "Save All" inside that modal does /bulk-allocate run.
  const [reviewingDraft, setReviewingDraft] = useState(false)
  const [batchNote, setBatchNote] = useState('')
  // Total prior-FY carry-over to deduct from the receipts pool before
  // FIFO. Distributed FIFO across selected receipts oldest-first;
  // displayed as a separate "carry-over" line in the totals banner.
  const [carryOver, setCarryOver] = useState('')
  // Bumped after every Skip / Allow-to-link toggle so the dry-run
  // re-fetches with fresh skip flags.
  const [refetchTick, setRefetchTick] = useState(0)
  // Set after a successful commit. While non-null, the sheet shows a
  // success card with the WhatsApp share button instead of the editor.
  const [committed, setCommitted] = useState<{ saved: number } | null>(null)

  // Run dry-run on mount + whenever the advance toggle flips. The
  // server's plan tells us which invoices are candidates and in what
  // order; the cash splits themselves are recomputed client-side via
  // re-FIFO whenever TDS / discount change.
  useEffect(() => {
    let alive = true
    setLoading(true); setError(null); setConflicts(null)
    fetch('/api/accounts/receipts/bulk-allocate?dryRun=1', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ receiptIds, partyName, includeAdvance }),
    })
      .then(async r => {
        const d = await r.json()
        if (!alive) return
        if (r.status === 409 && d.conflicts) { setConflicts(d.conflicts); return }
        if (!r.ok) { setError(d.error || 'Failed to plan'); return }
        setData(d)
        // Seed rows from the full candidate invoice list (every pending
        // bill in scope), NOT from d.plan. The server's plan is pre-TDS
        // FIFO and may stop short of the last few invoices when the
        // receipts run out before TDS can reduce the cash needed —
        // those invoices belong in the editable list anyway, since the
        // client's TDS-aware re-FIFO will reach them.
        setRows(d.invoices.map((inv: DryRunInvoice): RowState => {
          const isCN = inv.vchType === 'Credit Note' || inv.isCN
          const taxable = inv.taxableAmount && inv.taxableAmount > 0 ? inv.taxableAmount : 0
          return {
            invoiceId: inv.id,
            // Default CN rows to UNticked so the user opts in
            // explicitly — most bulk-link ops don't include CNs.
            selected: !isCN,
            allowPartial: false,
            // CN rows never carry TDS or settlement discount — Tally
            // adjusts the party ledger directly via bill-wise knock-off.
            tdsRatePct: isCN ? null : DEFAULT_TDS_RATE,
            tdsAmount: isCN ? 0 : Math.round((taxable * DEFAULT_TDS_RATE) / 100),
            discountPct: null,
            discountAmount: 0,
            cnKnockoffAmount: isCN ? inv.pending : 0,
          }
        }))
      })
      .catch(e => { if (alive) setError(e?.message || 'Network error') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [receiptIds, partyName, includeAdvance, refetchTick])

  // Toggle the persistent skip-from-auto-link flag on an invoice and
  // re-fetch the dry-run so FIFO replans without (or with) it.
  async function toggleSkip(invoiceId: number, skip: boolean, reason: string | null) {
    try {
      const res = await fetch(`/api/accounts/sales/${invoiceId}/skip`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skip, reason }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        alert(d.error || 'Failed to update skip flag')
        return
      }
      setRefetchTick(t => t + 1)
    } catch (e: any) { alert(e?.message || 'Network error') }
  }

  function updateRow(idx: number, patch: Partial<RowState>) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r))
  }
  // Switching to Auto forces every row back to selected so FIFO covers
  // all candidate invoices. Switching to Manual leaves the current
  // selection intact (user usually unchecks a few from the full list).
  function switchMode(next: BulkMode) {
    setMode(next)
    if (next === 'auto') setRows(prev => prev.map(r => ({ ...r, selected: true })))
  }
  function selectAll(value: boolean) {
    setRows(prev => prev.map(r => ({ ...r, selected: value })))
  }
  function applyTdsRate(idx: number) {
    const row = rows[idx]
    const inv = data?.invoices.find(i => i.id === row.invoiceId)
    if (!inv || !inv.taxableAmount || inv.taxableAmount <= 0) return
    if (inv.isCN || inv.vchType === 'Credit Note') return  // no TDS on CN
    const rate = row.tdsRatePct ?? DEFAULT_TDS_RATE
    updateRow(idx, { tdsAmount: Math.round((inv.taxableAmount * rate) / 100) })
  }
  function applyDiscPct(idx: number) {
    const row = rows[idx]
    const inv = data?.invoices.find(i => i.id === row.invoiceId)
    if (!inv || !inv.taxableAmount || inv.taxableAmount <= 0) return
    if (inv.isCN || inv.vchType === 'Credit Note') return  // no settlement discount on CN
    const pct = row.discountPct ?? 0
    if (pct <= 0) return
    updateRow(idx, { discountAmount: Math.round((inv.taxableAmount * pct) / 100) })
  }

  // Distribute the prior-FY carry-over input FIFO across receipts
  // (oldest first), respecting any previously-set carryOverPriorFy.
  // Returns per-receipt amounts that should be reserved before FIFO.
  const additionalCarryOverByReceipt = useMemo(() => {
    const out: Record<number, number> = {}
    if (!data) return out
    const total = round2(parseFloat(carryOver) || 0)
    if (total <= 0) return out
    let need = total
    for (const r of data.receipts) {
      if (need <= 0.0001) break
      const existing = r.carryOverPriorFy || 0
      const headroom = Math.max(0, round2(r.amount - existing))
      if (headroom <= 0.0001) continue
      const take = round2(Math.min(headroom, need))
      out[r.id] = take
      need = round2(need - take)
    }
    return out
  }, [data, carryOver])
  const carryOverNum = round2(parseFloat(carryOver) || 0)
  const carryOverApplied = useMemo(
    () => Object.values(additionalCarryOverByReceipt).reduce((s, v) => s + v, 0),
    [additionalCarryOverByReceipt],
  )
  const carryOverExceeds = carryOverNum > carryOverApplied + 0.5

  // Re-FIFO derived cash splits: walk receipts oldest-first, drain
  // each into the current invoice until its targetCash (= pending −
  // TDS − discount) is met, then move to the next invoice. Leftover
  // from a receipt naturally rolls forward to the next invoice.
  // In Auto mode, an invoice that the remaining receipts can't fully
  // close is skipped entirely (no partial allocation) — its row gets
  // a "Link partial" toggle the user can enable to override.
  const splitsByInvoice = useMemo(() => {
    const map = new Map<number, DryRunSplit[]>()
    if (!data) return map
    const remaining: Record<number, number> = {}
    for (const r of data.receipts) {
      const existing = r.carryOverPriorFy || 0
      const additional = additionalCarryOverByReceipt[r.id] || 0
      remaining[r.id] = round2(Math.max(0, r.amount - existing - additional))
    }
    let totalRemaining = round2(Object.values(remaining).reduce((s, v) => s + v, 0))
    let i = 0
    // Phase 1 — handle CN rows first. Each ticked CN gets a single
    // split to the oldest selected receipt for the user-typed knock-off
    // amount. The server flips the sign at commit time so the receipt's
    // cash pool effectively GROWS by that amount, freeing it for the
    // invoice rows we FIFO below.
    const firstReceipt = data.receipts[0]
    for (const row of rows) {
      const inv = data.invoices.find(x => x.id === row.invoiceId)
      if (!inv?.isCN) continue
      if (!row.selected || inv.skipAutoLink) { map.set(row.invoiceId, []); continue }
      const ko = Math.max(0, Math.min(row.cnKnockoffAmount || 0, inv.pending))
      if (ko <= 0 || !firstReceipt) { map.set(row.invoiceId, []); continue }
      map.set(row.invoiceId, [{ receiptId: firstReceipt.id, allocatedAmount: ko }])
      remaining[firstReceipt.id] = round2((remaining[firstReceipt.id] || 0) + ko)
      totalRemaining = round2(totalRemaining + ko)
    }
    for (const row of rows) {
      if (!row.selected) { map.set(row.invoiceId, []); continue }
      const inv = data.invoices.find(x => x.id === row.invoiceId)
      if (!inv) { map.set(row.invoiceId, []); continue }
      // Persistent skip flag — FIFO doesn't allocate cash to these.
      if (inv.skipAutoLink) { map.set(row.invoiceId, []); continue }
      // CN handled in Phase 1 above; FIFO skips it entirely.
      if (inv.isCN) continue
      const targetCash = Math.max(0, round2(inv.pending - (row.tdsAmount || 0) - (row.discountAmount || 0)))
      // Auto mode: skip invoices that can't be fully closed unless the
      // user explicitly opted into partial linking on this row. Manual
      // mode is already explicit — user picked the row, allocate what
      // we can.
      if (mode === 'auto' && !row.allowPartial && targetCash > totalRemaining + 0.5) {
        map.set(row.invoiceId, [])
        continue
      }
      let need = targetCash
      const splits: DryRunSplit[] = []
      while (need > 0 && i < data.receipts.length) {
        const r = data.receipts[i]
        const have = remaining[r.id]
        if (have <= 0.0001) { i++; continue }
        const take = round2(Math.min(have, need))
        if (take <= 0) { i++; continue }
        splits.push({ receiptId: r.id, allocatedAmount: take })
        remaining[r.id] = round2(have - take)
        totalRemaining = round2(totalRemaining - take)
        need = round2(need - take)
        if (remaining[r.id] <= 0.0001) i++
      }
      map.set(row.invoiceId, splits)
    }
    return map
  }, [data, rows, mode, additionalCarryOverByReceipt])

  // Live totals derived from selected rows + computed splits.
  const totals = useMemo(() => {
    const sumReceipts = data?.totals.receipts ?? 0
    const existingCarryOver = (data?.receipts || []).reduce((s, r) => s + (r.carryOverPriorFy || 0), 0)
    let cash = 0, tds = 0, disc = 0
    for (const row of rows) {
      if (!row.selected) continue
      const inv = data?.invoices.find(i => i.id === row.invoiceId)
      if (inv?.skipAutoLink) continue
      const splits = splitsByInvoice.get(row.invoiceId) || []
      // Auto-skipped rows (no cash assigned) contribute 0 to all
      // totals — we don't claim TDS / discount on a bill that's not
      // being settled.
      if (splits.length === 0) continue
      // CN allocations REDUCE net cash receipts will spend (server
      // commits them as negative-sign Agst Ref to free up receipt
      // cash on Tally's bill-wise side).
      const sign = inv?.isCN ? -1 : 1
      cash += sign * splits.reduce((s, a) => s + a.allocatedAmount, 0)
      if (!inv?.isCN) {
        tds += row.tdsAmount || 0
        disc += row.discountAmount || 0
      }
    }
    const carryTotal = round2(existingCarryOver + carryOverApplied)
    return { sumReceipts, cash, tds, disc, carryOver: carryTotal, delta: round2(sumReceipts - cash - carryTotal) }
  }, [data, rows, splitsByInvoice, carryOverApplied])
  const selectedCount = useMemo(() => rows.filter(r => r.selected).length, [rows])

  // After re-FIFO the math always satisfies cash + TDS + disc ≤ pending,
  // so this guard is mostly defensive (e.g. user typed a TDS larger
  // than the invoice's pending).
  const overAllocated = useMemo(() => {
    if (!data) return [] as number[]
    const idxs: number[] = []
    rows.forEach((row, i) => {
      if (!row.selected) return
      const inv = data.invoices.find(x => x.id === row.invoiceId)
      if (!inv || inv.skipAutoLink) return
      const splits = splitsByInvoice.get(row.invoiceId) || []
      const cash = splits.reduce((s, a) => s + a.allocatedAmount, 0)
      if (cash + (row.tdsAmount || 0) + (row.discountAmount || 0) > inv.pending + 1) idxs.push(i)
    })
    return idxs
  }, [data, rows, splitsByInvoice])

  async function commit() {
    if (!data || rows.length === 0) return
    if (overAllocated.length > 0) {
      alert(`${overAllocated.length} invoice(s) over-allocated — reduce TDS/Discount first.`)
      return
    }
    setCommitting(true); setError(null)
    try {
      const body = {
        receiptIds, partyName, includeAdvance,
        batchNote: batchNote.trim() || null,
        carryOver: carryOverNum > 0 ? carryOverNum : 0,
        rows: rows
          .filter(r => r.selected)
          .filter(r => {
            const inv = data?.invoices.find(i => i.id === r.invoiceId)
            return !inv?.skipAutoLink
          })
          .map(r => ({
            invoiceId: r.invoiceId,
            allocations: splitsByInvoice.get(r.invoiceId) || [],
            tdsRatePct: r.tdsRatePct ?? null,
            tdsAmount: r.tdsAmount || 0,
            discountAmount: r.discountAmount || 0,
          }))
          .filter(r => r.allocations.length > 0 || r.tdsAmount > 0 || r.discountAmount > 0),
      }
      const res = await fetch('/api/accounts/receipts/bulk-allocate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await res.json()
      if (!res.ok) { setError(d.error || 'Commit failed'); return }
      // Switch sheet into success state — user will explicitly click
      // Done (or share + Done) so they have time to fire the share.
      setCommitted({ saved: d.saved ?? rows.length })
    } catch (e: any) { setError(e?.message || 'Network error') }
    finally { setCommitting(false) }
  }

  // Build the WhatsApp / share message from the committed plan.
  function buildShareText(): string {
    const lines: string[] = []
    lines.push(`🧾 *Bulk Receipt Link* — ${partyName}`)
    lines.push(fmtDate(new Date().toISOString()))
    lines.push('')
    if (batchNote.trim()) {
      lines.push(`📌 *Notes:* ${batchNote.trim()}`)
      lines.push('')
    }
    if (data) {
      lines.push(`*Receipts (${data.receipts.length}):*`)
      for (const r of data.receipts) {
        lines.push(`• #${r.vchNumber} (${fmtDate(r.date)}) ₹${fmtMoney(r.amount)}`)
      }
      lines.push(`*Total Bank Recpt:* ₹${fmtMoney(totals.sumReceipts)}`)
      lines.push('')
      lines.push(`*Linked invoices (${selectedCount}):*`)
      for (const row of rows.filter(r => r.selected)) {
        const inv = data.invoices.find(i => i.id === row.invoiceId)
        if (!inv) continue
        const splits = splitsByInvoice.get(row.invoiceId) || []
        const cash = splits.reduce((s, a) => s + a.allocatedAmount, 0)
        const extras: string[] = []
        if ((row.tdsAmount || 0) > 0) extras.push(`TDS ₹${fmtMoney(row.tdsAmount)}`)
        if ((row.discountAmount || 0) > 0) extras.push(`Disc ₹${fmtMoney(row.discountAmount)}`)
        lines.push(`• ${inv.vchType} ${inv.vchNumber} (${fmtDate(inv.date)}) ₹${fmtMoney(cash)}${extras.length ? ' · ' + extras.join(' · ') : ''}`)
      }
      lines.push(`*Total settled:* ₹${fmtMoney(totals.cash)}${totals.tds > 0 ? ` (+ TDS ₹${fmtMoney(totals.tds)})` : ''}${totals.disc > 0 ? ` (+ Disc ₹${fmtMoney(totals.disc)})` : ''}`)
      if (totals.carryOver > 0) lines.push(`⏪ *Carry-over (prior FY):* ₹${fmtMoney(totals.carryOver)}`)
      lines.push('')
      lines.push(`Δ *Remaining:* ₹${fmtMoney(totals.delta)}`)
    }
    return lines.join('\n')
  }
  async function shareWhatsApp() {
    const text = buildShareText()
    if (typeof navigator !== 'undefined' && (navigator as any).share) {
      try {
        await (navigator as any).share({ title: `Bulk Receipt Link — ${partyName}`, text })
        return
      } catch { /* user cancelled or unavailable — fall through */ }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="relative bg-white dark:bg-gray-900 w-full max-w-3xl max-h-[92vh] rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col"
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-sm font-bold text-gray-800 dark:text-gray-100">Bulk Link · {partyName}</div>
              <div className="text-[11px] text-gray-500 dark:text-gray-400">{receiptIds.length} receipts → FIFO into oldest pending invoices</div>
            </div>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-800 dark:hover:text-gray-100 text-xl leading-none">×</button>
          </div>
          {/* Remaining-unallocated banner — the headline number for the
             user. Green within ±₹1 (fully matched), rose otherwise. */}
          {(() => {
            const matched = Math.abs(totals.delta) <= 1
            const overMatched = totals.delta < -1  // linked > receipts
            return (
              <div className={`rounded-xl border-2 mt-2 px-3 py-2.5 ${
                matched
                  ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700/60'
                  : 'bg-rose-50 dark:bg-rose-900/20 border-rose-300 dark:border-rose-700/60'
              }`}>
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <div className={`text-[10px] uppercase tracking-wide font-semibold ${
                      matched ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'
                    }`}>
                      {matched ? '✓ Fully matched' : overMatched ? 'Over-allocated' : 'Remaining unallocated'}
                    </div>
                    <div className={`text-2xl sm:text-3xl font-extrabold tabular-nums ${
                      matched ? 'text-emerald-700 dark:text-emerald-200' : 'text-rose-700 dark:text-rose-200'
                    }`}>
                      ₹{fmtMoney(Math.abs(totals.delta))}
                    </div>
                  </div>
                  <div className="text-right text-[10px] text-gray-600 dark:text-gray-300 leading-tight">
                    <div>Σ Receipts <span className="font-semibold text-gray-800 dark:text-gray-100 tabular-nums">₹{fmtMoney(totals.sumReceipts)}</span></div>
                    <div>− Linked Bank Recpt <span className="font-semibold text-indigo-700 dark:text-indigo-300 tabular-nums">₹{fmtMoney(totals.cash)}</span></div>
                    {totals.carryOver > 0 && (
                      <div className="text-gray-500 italic">− Carry-over <span className="tabular-nums">₹{fmtMoney(totals.carryOver)}</span></div>
                    )}
                    {(totals.tds > 0 || totals.disc > 0) && (
                      <div className="text-amber-700 dark:text-amber-300">
                        + TDS <span className="tabular-nums">₹{fmtMoney(totals.tds)}</span>
                        {totals.disc > 0 && <> · Disc <span className="tabular-nums">₹{fmtMoney(totals.disc)}</span></>}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })()}
          <div className="flex items-center gap-1.5 mt-2 text-[11px] flex-wrap">
            {/* Auto / Manual mode */}
            <div className="flex items-center gap-0.5 rounded-full border border-gray-200 dark:border-gray-600 p-0.5">
              {(['auto', 'manual'] as BulkMode[]).map(m => (
                <button key={m} onClick={() => switchMode(m)}
                  className={`px-2 py-0.5 rounded-full text-[11px] font-semibold transition ${
                    mode === m
                      ? 'bg-emerald-600 text-white'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
                  }`}>
                  {m === 'auto' ? '⚙ Auto' : '✋ Manual'}
                </button>
              ))}
            </div>
            {mode === 'manual' && (
              <>
                <span className="text-gray-400 text-[10px]">{selectedCount}/{rows.length} picked</span>
                <button onClick={() => selectAll(true)}
                  className="px-1.5 py-0.5 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 text-[10px]">
                  All
                </button>
                <button onClick={() => selectAll(false)}
                  className="px-1.5 py-0.5 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 text-[10px]">
                  None
                </button>
              </>
            )}
            <button onClick={() => setIncludeAdvance(v => !v)}
              title="Advance invoices = pending bills dated AFTER the newest selected receipt (same-day bills are already in the default set)"
              className={`px-2 py-0.5 rounded-full border transition ${
                includeAdvance
                  ? 'bg-amber-100 dark:bg-amber-900/40 border-amber-400 dark:border-amber-700 text-amber-800 dark:text-amber-200'
                  : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'
              }`}>
              {includeAdvance
                ? '✓ Including advance invoices'
                : `+ Advance invoices${data?.advanceCount ? ` (${data.advanceCount})` : ''}`}
            </button>
            <span className="text-gray-400 text-[10px]">
              {includeAdvance ? 'incl. bills dated > newest receipt' : 'bills dated ≤ newest receipt'}
            </span>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
          {loading && <div className="text-center py-8 text-gray-400 text-sm">Planning…</div>}

          {conflicts && (
            <div className="border border-rose-300 dark:border-rose-700/40 bg-rose-50 dark:bg-rose-900/20 rounded-xl p-3 text-[11px]">
              <div className="font-bold text-rose-700 dark:text-rose-300 mb-1">Conflict — these receipts are already linked. Unlink them first.</div>
              <ul className="text-rose-600 dark:text-rose-400 space-y-0.5">
                {conflicts.map(c => (
                  <li key={c.receiptId}>• #{c.vchNumber} ({c.existingLinks} existing link{c.existingLinks > 1 ? 's' : ''})</li>
                ))}
              </ul>
            </div>
          )}

          {error && !conflicts && (
            <div className="border border-rose-300 dark:border-rose-700/40 bg-rose-50 dark:bg-rose-900/20 rounded-xl p-3 text-[12px] text-rose-700 dark:text-rose-300">{error}</div>
          )}

          {/* Prior-FY carry-over input */}
          {data && !committed && (
            <div className="border border-amber-200 dark:border-amber-700/40 bg-amber-50 dark:bg-amber-900/10 rounded-xl p-2.5 text-[11px]">
              <label className="block text-amber-800 dark:text-amber-200 font-semibold mb-1">
                ⏪ Prior-FY carry-over <span className="font-normal text-gray-500 dark:text-gray-400">(e.g. FY 24-25 bills you don&apos;t want to itemise)</span>
              </label>
              <div className="flex items-center gap-2">
                <span className="text-gray-400 text-[10px]">₹</span>
                <input type="number" value={carryOver} onChange={e => setCarryOver(e.target.value)}
                  placeholder="0"
                  className="w-32 px-1.5 py-1 rounded border border-amber-300 dark:border-amber-700 bg-white dark:bg-gray-700 tabular-nums" />
                <span className="text-[10px] text-gray-500 dark:text-gray-400">
                  Reduces the FIFO pool oldest-receipt-first.
                  {carryOverNum > 0 && (
                    <> Reserved: <span className="font-semibold tabular-nums">₹{fmtMoney(carryOverApplied)}</span></>
                  )}
                </span>
              </div>
              {carryOverExceeds && (
                <div className="mt-1 text-rose-600 dark:text-rose-400">
                  ⚠ Carry-over exceeds available pool by ₹{fmtMoney(carryOverNum - carryOverApplied)}
                </div>
              )}
            </div>
          )}

          {/* Receipts (read-only) */}
          {data && (
            <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-2.5 text-[11px] bg-gray-50 dark:bg-gray-800/40">
              <div className="font-semibold text-gray-700 dark:text-gray-200 mb-1">Receipts ({data.receipts.length}) · oldest first</div>
              {data.receipts.map(r => {
                let used = 0
                for (const splits of splitsByInvoice.values()) {
                  for (const s of splits) if (s.receiptId === r.id) used += s.allocatedAmount
                }
                const reserved = (r.carryOverPriorFy || 0) + (additionalCarryOverByReceipt[r.id] || 0)
                const left = Math.max(0, r.amount - used - reserved)
                return (
                  <div key={r.id} className="flex items-center justify-between gap-2 py-0.5">
                    <span className="font-mono text-emerald-700 dark:text-emerald-300">#{r.vchNumber}</span>
                    <span className="text-gray-500">{fmtDate(r.date)}</span>
                    <span className="text-gray-700 dark:text-gray-200 tabular-nums">₹{fmtMoney(r.amount)}</span>
                    {reserved > 0 && (
                      <span className="text-[10px] text-amber-700 dark:text-amber-300 italic tabular-nums" title="Reserved as prior-FY carry-over">
                        ⏪ ₹{fmtMoney(reserved)}
                      </span>
                    )}
                    <span className={`tabular-nums ${left <= 1 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                      {left <= 1 ? '✓ used' : `left ₹${fmtMoney(left)}`}
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          {/* Invoice cards */}
          {data && rows.length === 0 && (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400 text-sm border border-dashed rounded-xl">
              No pending invoices to link. {!includeAdvance && 'Try “Advance invoices” if this is an advance payment.'}
            </div>
          )}
          {data && rows.map((row, idx) => {
            const inv = data.invoices.find(i => i.id === row.invoiceId)
            if (!inv) return null
            const splits = splitsByInvoice.get(row.invoiceId) || []
            const cash = splits.reduce((s, a) => s + a.allocatedAmount, 0)
            const taxable = inv.taxableAmount && inv.taxableAmount > 0 ? inv.taxableAmount : 0
            const isOver = overAllocated.includes(idx)
            const isSkipped = !!inv.skipAutoLink
            const targetCash = Math.max(0, inv.pending - (row.tdsAmount || 0) - (row.discountAmount || 0))
            const cashShort = round2(targetCash - cash) // > 0 → receipts ran out before this invoice closed
            // Auto mode: this row was skipped because the remaining
            // receipts couldn't fully close it (and user hasn't opted
            // into partial linking).
            const isAutoShort = mode === 'auto' && row.selected && !isSkipped && !row.allowPartial
              && cash === 0 && targetCash > 0.5
            const cardCls = isSkipped
              ? 'border-rose-300 dark:border-rose-700/40 bg-rose-50/40 dark:bg-rose-900/5 opacity-60'
              : isAutoShort
                ? 'border-amber-300 dark:border-amber-700/40 bg-amber-50/60 dark:bg-amber-900/10'
                : !row.selected
                  ? 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 opacity-60'
                  : isOver
                    ? 'border-rose-300 dark:border-rose-700/40 bg-rose-50 dark:bg-rose-900/10'
                    : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
            return (
              <div key={inv.id} className={`border rounded-xl p-3 ${cardCls}`}>
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="min-w-0 flex items-start gap-2">
                    {mode === 'manual' && (
                      <input type="checkbox" checked={row.selected}
                        onChange={e => updateRow(idx, { selected: e.target.checked })}
                        className="mt-0.5 w-4 h-4 accent-emerald-600 cursor-pointer" />
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                        inv.isCN
                          ? 'bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300'
                          : 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                      }`}>
                        {inv.vchType} {inv.vchNumber}
                      </span>
                      <span className="text-[10px] text-gray-500">{fmtDate(inv.date)}</span>
                      {inv.isCN && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300"
                          title="Credit Note — knocking it off here REDUCES the cash a receipt consumes (negative-sign Agst Ref in Tally)">
                          ↙ CN knock-off
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`text-sm font-bold tabular-nums ${inv.isCN ? 'text-violet-700 dark:text-violet-300' : 'text-gray-800 dark:text-gray-100'}`}>
                      {inv.isCN ? '−' : ''}₹{fmtMoney(inv.totalAmount)}
                    </div>
                    <div className={`text-[10px] ${inv.isCN ? 'text-violet-600 dark:text-violet-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      pending {inv.isCN ? '−' : ''}₹{fmtMoney(inv.pending)}
                    </div>
                  </div>
                </div>

                {/* Cash splits — auto-rebuilt by re-FIFO whenever TDS / Disc change.
                   CN rows show a manual knock-off input that gets attributed
                   to the oldest selected receipt (freeing that much cash). */}
                {inv.isCN ? (
                  <div className="mt-1 space-y-1">
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <span className="text-violet-700 dark:text-violet-300 font-semibold whitespace-nowrap">↙ Knock-off ₹</span>
                      <input type="number" value={row.cnKnockoffAmount || 0}
                        onChange={e => updateRow(idx, { cnKnockoffAmount: Math.max(0, parseFloat(e.target.value) || 0) })}
                        className="flex-1 min-w-[60px] px-1.5 py-1 rounded border border-violet-300 dark:border-violet-700 bg-white dark:bg-gray-700 text-[11px] tabular-nums" />
                      <span className="text-[10px] text-gray-400 whitespace-nowrap">of ₹{fmtMoney(inv.pending)}</span>
                    </div>
                    {splits.length > 0 && (() => {
                      const r0 = data.receipts.find(x => x.id === splits[0].receiptId)
                      return (
                        <div className="text-[10px] text-violet-600 dark:text-violet-400">
                          → frees ₹{fmtMoney(splits[0].allocatedAmount)} on #{r0?.vchNumber} {fmtDate(r0?.date ?? '')}
                        </div>
                      )
                    })()}
                  </div>
                ) : (
                  <div className="text-[10px] text-gray-600 dark:text-gray-300 space-y-0.5 mt-1">
                    {splits.length === 0 && <div className="text-gray-400 italic">No Bank Recpt assigned (receipts exhausted)</div>}
                    {splits.map((s, i) => {
                      const rcpt = data.receipts.find(r => r.id === s.receiptId)
                      return (
                        <div key={i} className="flex justify-between">
                          <span className="font-mono text-emerald-700 dark:text-emerald-300">#{rcpt?.vchNumber} {fmtDate(rcpt?.date ?? '')}</span>
                          <span className="tabular-nums">₹{fmtMoney(s.allocatedAmount)}</span>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* TDS row — not applicable on CN rows. */}
                {!inv.isCN && (
                <div className="flex items-center gap-1.5 text-[11px] mt-1.5">
                  <button type="button" onClick={() => applyTdsRate(idx)}
                    className="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 font-semibold">
                    💰 TDS @{row.tdsRatePct ?? DEFAULT_TDS_RATE}%
                  </button>
                  <input type="number" value={row.tdsRatePct ?? ''} step="0.01"
                    onChange={e => updateRow(idx, { tdsRatePct: e.target.value === '' ? null : parseFloat(e.target.value) })}
                    onBlur={() => applyTdsRate(idx)}
                    placeholder="rate"
                    className="w-14 px-1.5 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-[11px]" />
                  <span className="text-gray-400 text-[10px]">%</span>
                  <input type="number" value={row.tdsAmount || ''}
                    onChange={e => updateRow(idx, { tdsAmount: parseFloat(e.target.value) || 0 })}
                    placeholder="₹"
                    className="flex-1 min-w-[60px] px-1.5 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-[11px] tabular-nums" />
                  <span className="text-gray-400 text-[10px] whitespace-nowrap">on ₹{fmtMoney(taxable)}</span>
                </div>
                )}

                {/* Discount row — not applicable on CN rows. */}
                {!inv.isCN && (
                <div className="flex items-center gap-1.5 text-[11px] mt-1">
                  <button type="button"
                    className="px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-900/40 border border-rose-300 dark:border-rose-700 text-rose-800 dark:text-rose-200 font-semibold">
                    🏷 Disc
                  </button>
                  <input type="number" value={row.discountPct ?? ''} step="0.01"
                    onChange={e => updateRow(idx, { discountPct: e.target.value === '' ? null : parseFloat(e.target.value) })}
                    onBlur={() => applyDiscPct(idx)}
                    placeholder="%"
                    className="w-14 px-1.5 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-[11px]" />
                  <span className="text-gray-400 text-[10px]">%</span>
                  <input type="number" value={row.discountAmount || ''}
                    onChange={e => updateRow(idx, { discountAmount: parseFloat(e.target.value) || 0 })}
                    placeholder="₹"
                    className="flex-1 min-w-[60px] px-1.5 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-[11px] tabular-nums" />
                </div>
                )}

                {/* Cash formula line: cash = pending − TDS − discount */}
                <div className={`mt-1.5 text-[10px] flex justify-between gap-2 ${
                  !row.selected ? 'text-gray-400'
                  : isAutoShort ? 'text-amber-700 dark:text-amber-300'
                  : isOver ? 'text-rose-600 dark:text-rose-400'
                  : 'text-gray-500 dark:text-gray-400'
                }`}>
                  {!row.selected ? (
                    <span className="italic">— skipped (manual mode)</span>
                  ) : isAutoShort ? (
                    <>
                      <span>
                        🔸 Auto-skipped — receipts cannot fully close this (target ₹{fmtMoney(targetCash)})
                      </span>
                      <button
                        onClick={() => updateRow(idx, { allowPartial: true })}
                        className="shrink-0 px-2 py-0.5 rounded-full bg-amber-600 hover:bg-amber-700 text-white font-semibold text-[10px]">
                        Link partial
                      </button>
                    </>
                  ) : (
                    <>
                      <span>
                        Bank Recpt <span className="font-semibold tabular-nums">₹{fmtMoney(cash)}</span>
                        {' = '}pending ₹{fmtMoney(inv.pending)}
                        {(row.tdsAmount || 0) > 0 && <> − TDS ₹{fmtMoney(row.tdsAmount || 0)}</>}
                        {(row.discountAmount || 0) > 0 && <> − disc ₹{fmtMoney(row.discountAmount || 0)}</>}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className={`font-semibold ${
                          cashShort > 1 ? 'text-amber-600 dark:text-amber-400'
                          : isOver ? 'text-rose-600 dark:text-rose-400'
                          : 'text-emerald-600 dark:text-emerald-400'
                        }`}>
                          {cashShort > 1 ? `short ₹${fmtMoney(cashShort)}` : isOver ? '⚠ over' : '✓ closes'}
                        </span>
                        {row.allowPartial && cashShort > 1 && (
                          <button
                            onClick={() => updateRow(idx, { allowPartial: false })}
                            title="Revert to auto-skip if can't fully close"
                            className="px-1.5 py-0.5 rounded-full border border-gray-300 dark:border-gray-600 text-gray-500 text-[9px] font-semibold">
                            ✕ undo partial
                          </button>
                        )}
                      </span>
                    </>
                  )}
                </div>

                {/* Persistent skip toggle — saves to KsiSalesInvoice
                   so the flag survives across bulk-link sessions and
                   Tally re-syncs. */}
                <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-dashed border-gray-200 dark:border-gray-700/60 text-[10px]">
                  {isSkipped ? (
                    <>
                      <div className="text-rose-700 dark:text-rose-300 italic min-w-0 truncate">
                        🚫 Skipped from auto-link
                        {inv.skipAutoLinkReason && <span className="text-gray-600 dark:text-gray-400"> · {inv.skipAutoLinkReason}</span>}
                      </div>
                      <button onClick={() => toggleSkip(inv.id, false, null)}
                        className="ml-2 px-2 py-0.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shrink-0">
                        ✓ Allow to link
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="text-gray-400 italic">FIFO will assign cash to this bill.</span>
                      <button onClick={() => {
                        const r = window.prompt('Skip reason (optional, e.g. "disputed quality, on hold"):') ?? ''
                        if (r === null) return
                        toggleSkip(inv.id, true, r.trim() || null)
                      }}
                        className="ml-2 px-2 py-0.5 rounded-full bg-white dark:bg-gray-700 border border-rose-300 dark:border-rose-700 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-900/20 shrink-0">
                        🚫 Skip
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })}

          {/* Batch notes — saved on every allocation in this batch and
             reused in the WhatsApp share text. */}
          {data && !committed && (
            <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-2.5">
              <label className="text-[11px] text-gray-500 dark:text-gray-400 font-semibold">
                📌 Notes <span className="font-normal">(saved on every link & shared)</span>
              </label>
              <textarea value={batchNote} onChange={e => setBatchNote(e.target.value)}
                placeholder="e.g. April advance, signed by Vijay, RTGS UTR …"
                rows={2}
                className="w-full mt-1 px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-[12px]" />
            </div>
          )}

          {/* Success card — shown after a successful commit */}
          {committed && (
            <div className="rounded-xl border-2 border-emerald-300 dark:border-emerald-700/60 bg-emerald-50 dark:bg-emerald-900/20 p-4 text-center">
              <div className="text-3xl">✓</div>
              <div className="text-sm font-bold text-emerald-700 dark:text-emerald-300 mt-1">
                Linked {committed.saved} allocation{committed.saved === 1 ? '' : 's'}
              </div>
              <div className="text-[11px] text-gray-600 dark:text-gray-300 mt-0.5">{partyName}</div>
              <div className="grid grid-cols-3 gap-2 mt-3 text-[10px]">
                <div><div className="text-gray-500">Bank Recpt</div><div className="font-bold text-emerald-700 dark:text-emerald-300 tabular-nums">₹{fmtMoney(totals.cash)}</div></div>
                <div><div className="text-gray-500">+ TDS / Disc</div><div className="font-bold text-amber-700 dark:text-amber-300 tabular-nums">₹{fmtMoney(totals.tds + totals.disc)}</div></div>
                <div><div className="text-gray-500">Δ Remaining</div><div className={`font-bold tabular-nums ${Math.abs(totals.delta) <= 1 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>₹{fmtMoney(totals.delta)}</div></div>
              </div>
              {batchNote.trim() && (
                <div className="mt-3 text-[11px] text-left bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-2">
                  <span className="font-semibold">📌 Notes:</span> {batchNote.trim()}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-end gap-2">
          {committed ? (
            <>
              <button onClick={shareWhatsApp}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold">
                📤 Share on WhatsApp
              </button>
              <button onClick={() => onDone(committed.saved)}
                className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 text-xs">
                Done
              </button>
            </>
          ) : (
            <>
              <button onClick={onClose} disabled={committing}
                className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 text-xs">
                Cancel
              </button>
              <button onClick={() => setReviewingDraft(true)} disabled={committing || loading || rows.length === 0 || overAllocated.length > 0 || !!conflicts || carryOverExceeds}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-semibold">
                🔍 Preview ({rows.length} bills · {selectedCount} ticked{carryOverNum > 0 ? ` + carry-over` : ''})
              </button>
            </>
          )}
        </div>

        {/* Draft Review modal — final sanity check before /bulk-allocate */}
        {reviewingDraft && data && !committed && (
          <div className="absolute inset-0 z-10 bg-black/40 flex items-center justify-center p-3" onClick={() => !committing && setReviewingDraft(false)}>
            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                <div className="text-sm font-bold text-gray-800 dark:text-gray-100">🔍 Draft Review — {partyName}</div>
                <button onClick={() => setReviewingDraft(false)} disabled={committing}
                  className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-xs">✕</button>
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                <table className="w-full text-[11px] border-collapse">
                  <thead>
                    <tr className="border-b-2 border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                      <th className="px-1.5 py-1 text-center" style={{ width: 22 }}>✓</th>
                      <th className="px-1.5 py-1 text-left">Invoice</th>
                      <th className="px-1.5 py-1 text-right">Pending</th>
                      <th className="px-1.5 py-1 text-right">Cash</th>
                      <th className="px-1.5 py-1 text-right">TDS</th>
                      <th className="px-1.5 py-1 text-right">Disc</th>
                      <th className="px-1.5 py-1 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(row => {
                      const inv = data.invoices.find(i => i.id === row.invoiceId)
                      if (!inv) return null
                      const splits = splitsByInvoice.get(row.invoiceId) || []
                      const cash = row.selected ? splits.reduce((s, a) => s + a.allocatedAmount, 0) : 0
                      const tds = row.selected ? (row.tdsAmount || 0) : 0
                      const disc = row.selected ? (row.discountAmount || 0) : 0
                      const consumed = cash + tds + disc
                      const diff = round2(inv.pending - consumed)
                      const status = !row.selected
                        ? '— skipped'
                        : inv.isCN
                          ? (cash > 0.5 ? `↙ knock-off ₹${fmtMoney(cash)}` : 'no allocation')
                          : Math.abs(diff) <= 1 ? '✓ closes' : diff > 0 ? `short ₹${fmtMoney(diff)}` : `over ₹${fmtMoney(-diff)}`
                      const statusColor = !row.selected
                        ? 'text-gray-400'
                        : inv.isCN
                          ? 'text-violet-700 dark:text-violet-300'
                          : Math.abs(diff) <= 1 ? 'text-emerald-700 dark:text-emerald-300'
                          : diff > 0 ? 'text-amber-700 dark:text-amber-300'
                          : 'text-rose-700 dark:text-rose-300'
                      return (
                        <tr key={inv.id} className={`border-b border-gray-100 dark:border-gray-700/60 ${!row.selected ? 'opacity-50' : ''}`}>
                          <td className="px-1.5 py-1 text-center">{row.selected ? '✓' : '—'}</td>
                          <td className="px-1.5 py-1">
                            <div className="font-mono text-indigo-600 dark:text-indigo-300">{inv.vchNumber}</div>
                            <div className="text-[9px] text-gray-500">{inv.vchType} · {fmtDate(inv.date)}{inv.isCN ? ' · CN' : ''}</div>
                          </td>
                          <td className="px-1.5 py-1 text-right tabular-nums">₹{fmtMoney(inv.pending)}</td>
                          <td className="px-1.5 py-1 text-right tabular-nums">{cash > 0 ? `₹${fmtMoney(cash)}` : '—'}</td>
                          <td className="px-1.5 py-1 text-right tabular-nums">{tds > 0 ? `₹${fmtMoney(tds)}` : '—'}</td>
                          <td className="px-1.5 py-1 text-right tabular-nums">{disc > 0 ? `₹${fmtMoney(disc)}` : '—'}</td>
                          <td className={`px-1.5 py-1 text-right font-semibold ${statusColor}`}>{status}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot className="border-t-2 border-gray-300 dark:border-gray-600">
                    <tr className="font-bold text-gray-800 dark:text-gray-100">
                      <td className="px-1.5 py-2 text-center">{selectedCount}</td>
                      <td className="px-1.5 py-2 text-left">Totals ({selectedCount}/{rows.length} ticked)</td>
                      <td className="px-1.5 py-2 text-right tabular-nums">—</td>
                      <td className="px-1.5 py-2 text-right tabular-nums text-emerald-700 dark:text-emerald-300">₹{fmtMoney(totals.cash)}</td>
                      <td className="px-1.5 py-2 text-right tabular-nums text-amber-700 dark:text-amber-300">₹{fmtMoney(totals.tds)}</td>
                      <td className="px-1.5 py-2 text-right tabular-nums text-rose-700 dark:text-rose-300">₹{fmtMoney(totals.disc)}</td>
                      <td className="px-1.5 py-2 text-right tabular-nums">—</td>
                    </tr>
                  </tfoot>
                </table>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                  <div className="bg-gray-50 dark:bg-gray-800 rounded p-2">
                    <div className="text-[9px] text-gray-500 uppercase">Receipts pool</div>
                    <div className="font-bold tabular-nums">₹{fmtMoney(totals.sumReceipts)}</div>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-800 rounded p-2">
                    <div className="text-[9px] text-gray-500 uppercase">After bank recpt + carry-over · Δ</div>
                    <div className={`font-bold tabular-nums ${Math.abs(totals.delta) <= 1 ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>
                      ₹{fmtMoney(totals.delta)}
                      {Math.abs(totals.delta) <= 1 ? ' ✓' : ' — will sit on-account'}
                    </div>
                  </div>
                </div>
                {batchNote.trim() && (
                  <div className="mt-3 text-[11px] bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700/40 rounded p-2">
                    <span className="font-semibold">📌 Notes:</span> {batchNote.trim()}
                  </div>
                )}
              </div>
              <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-end gap-2">
                <button onClick={() => setReviewingDraft(false)} disabled={committing}
                  className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 text-xs">
                  ← Back to Edit
                </button>
                <button onClick={async () => { await commit(); setReviewingDraft(false) }} disabled={committing || (selectedCount === 0 && carryOverNum === 0)}
                  title={selectedCount === 0 && carryOverNum === 0 ? 'Tick at least one row in the editor before saving' : ''}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-semibold">
                  {committing ? 'Saving…' : selectedCount === 0 ? '✓ Save (none ticked)' : `✓ Save All ${selectedCount} link${selectedCount === 1 ? '' : 's'}`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
