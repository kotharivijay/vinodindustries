'use client'

import { useState, useMemo, useEffect } from 'react'
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
  allocatedAmount: number
  tdsAmount: number
  discountAmount: number
  pending: number
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
  linkedCount: number
  linkedCash: number
  linkedTds: number
  linkedDiscount: number
  linkedInvoices: LinkedInvoice[]
}
type LinkFilter = 'all' | 'linked' | 'unlinked'

interface DryRunReceipt { id: number; vchType: string; vchNumber: string; date: string; amount: number; partyName: string; carryOverPriorFy?: number; additionalCarryOver?: number }
interface DryRunInvoice { id: number; vchType: string; vchNumber: string; date: string; totalAmount: number; taxableAmount: number | null; partyGstin: string | null; pending: number }
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
  tdsRatePct: number | null
  tdsAmount: number
  discountPct: number | null
  discountAmount: number
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

  function toggleSelect(id: number) {
    setSelected(prev => {
      const s = new Set(prev)
      s.has(id) ? s.delete(id) : s.add(id)
      return s
    })
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

  async function syncFys(fys: string[]) {
    setSyncing(true); setSyncMsg('')
    let totalSaved = 0, totalFetched = 0, totalIn = 0, totalOut = 0
    const todayIso = new Date().toISOString().slice(0, 10)
    try {
      for (const fy of fys) {
        const startYear = 2000 + parseInt(fy.split('-')[0])
        const endYear = startYear + 1
        const fromIso = `${startYear}-04-01`
        const fyEndIso = `${endYear}-03-31`
        const toIso = fyEndIso > todayIso ? todayIso : fyEndIso
        setSyncMsg(`Syncing FY ${fy}…`)
        const r = await fetch('/api/tally/ksi-hdfc-sync', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: fromIso, to: toIso }),
        })
        const d = await r.json()
        if (!r.ok) { setSyncMsg(d.error || `Sync failed for FY ${fy}`); return }
        totalSaved += d.saved || 0
        totalFetched += d.fetched || 0
        totalIn += d.inflow || 0
        totalOut += d.outflow || 0
      }
      setSyncMsg(`Synced ${totalSaved}/${totalFetched} rows across ${fys.length} FY · IN ₹${fmtMoney(totalIn)} · OUT ₹${fmtMoney(totalOut)}`)
      mutate()
    } catch (e: any) {
      setSyncMsg(e?.message || 'Network error')
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
            else router.push(`/accounts/receipts/${r.id}${r.linkedCount > 0 ? '?view=linked' : ''}`)
          }
          const carryOver = r.carryOverPriorFy || 0
          const diff = r.amount - r.linkedCash - carryOver
          const matched = (r.linkedCount > 0 || carryOver > 0) && Math.abs(diff) <= 1
          return (
            <div key={r.id} role="button" tabIndex={0}
              onClick={onCardClick}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCardClick() } }}
              className={`flex items-start gap-2 bg-white dark:bg-gray-800 border rounded-xl p-3 shadow-sm cursor-pointer transition hover:border-emerald-300 dark:hover:border-emerald-600/40 ${
                r.hidden ? 'opacity-60 border-amber-200 dark:border-amber-700/40' : 'border-gray-100 dark:border-gray-700'
              } ${isSelected ? 'ring-2 ring-emerald-500 border-emerald-500' : ''}`}>
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
                      {r.linkedInvoices.slice(0, 4).map((inv, i) => (
                        <div key={i}>
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-indigo-600 dark:text-indigo-300">{inv.vchType} {inv.vchNumber}</span>
                            <span className="tabular-nums">₹{fmtMoney(inv.allocatedAmount)}</span>
                            {inv.tdsAmount > 0 && <span className="text-amber-600 dark:text-amber-400">+TDS ₹{fmtMoney(inv.tdsAmount)}</span>}
                            {inv.discountAmount > 0 && <span className="text-rose-600 dark:text-rose-400">+disc ₹{fmtMoney(inv.discountAmount)}</span>}
                          </div>
                        </div>
                      ))}
                      {r.linkedInvoices.length > 4 && (
                        <div className="text-gray-400">+{r.linkedInvoices.length - 4} more…</div>
                      )}
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
  const [batchNote, setBatchNote] = useState('')
  // Total prior-FY carry-over to deduct from the receipts pool before
  // FIFO. Distributed FIFO across selected receipts oldest-first;
  // displayed as a separate "carry-over" line in the totals banner.
  const [carryOver, setCarryOver] = useState('')
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
        const invById: Record<number, DryRunInvoice> = {}
        for (const inv of d.invoices) invById[inv.id] = inv
        setRows(d.plan.map((p: DryRunPlanRow): RowState => {
          const inv = invById[p.invoiceId]
          const taxable = inv?.taxableAmount && inv.taxableAmount > 0 ? inv.taxableAmount : 0
          return {
            invoiceId: p.invoiceId,
            selected: true,
            tdsRatePct: DEFAULT_TDS_RATE,
            tdsAmount: Math.round((taxable * DEFAULT_TDS_RATE) / 100),
            discountPct: null,
            discountAmount: 0,
          }
        }))
      })
      .catch(e => { if (alive) setError(e?.message || 'Network error') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [receiptIds, partyName, includeAdvance])

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
    const rate = row.tdsRatePct ?? DEFAULT_TDS_RATE
    updateRow(idx, { tdsAmount: Math.round((inv.taxableAmount * rate) / 100) })
  }
  function applyDiscPct(idx: number) {
    const row = rows[idx]
    const inv = data?.invoices.find(i => i.id === row.invoiceId)
    if (!inv || !inv.taxableAmount || inv.taxableAmount <= 0) return
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
  const splitsByInvoice = useMemo(() => {
    const map = new Map<number, DryRunSplit[]>()
    if (!data) return map
    const remaining: Record<number, number> = {}
    for (const r of data.receipts) {
      const existing = r.carryOverPriorFy || 0
      const additional = additionalCarryOverByReceipt[r.id] || 0
      remaining[r.id] = round2(Math.max(0, r.amount - existing - additional))
    }
    let i = 0
    for (const row of rows) {
      if (!row.selected) { map.set(row.invoiceId, []); continue }
      const inv = data.invoices.find(x => x.id === row.invoiceId)
      if (!inv) { map.set(row.invoiceId, []); continue }
      const targetCash = Math.max(0, round2(inv.pending - (row.tdsAmount || 0) - (row.discountAmount || 0)))
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
        need = round2(need - take)
        if (remaining[r.id] <= 0.0001) i++
      }
      map.set(row.invoiceId, splits)
    }
    return map
  }, [data, rows, additionalCarryOverByReceipt])

  // Live totals derived from selected rows + computed splits.
  const totals = useMemo(() => {
    const sumReceipts = data?.totals.receipts ?? 0
    const existingCarryOver = (data?.receipts || []).reduce((s, r) => s + (r.carryOverPriorFy || 0), 0)
    let cash = 0, tds = 0, disc = 0
    for (const row of rows) {
      if (!row.selected) continue
      const splits = splitsByInvoice.get(row.invoiceId) || []
      cash += splits.reduce((s, a) => s + a.allocatedAmount, 0)
      tds += row.tdsAmount || 0
      disc += row.discountAmount || 0
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
      if (!inv) return
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
      <div className="bg-white dark:bg-gray-900 w-full max-w-3xl max-h-[92vh] rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col"
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
            const targetCash = Math.max(0, inv.pending - (row.tdsAmount || 0) - (row.discountAmount || 0))
            const cashShort = round2(targetCash - cash) // > 0 → receipts ran out before this invoice closed
            const cardCls = !row.selected
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
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300">
                        {inv.vchType} {inv.vchNumber}
                      </span>
                      <span className="text-[10px] text-gray-500">{fmtDate(inv.date)}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold text-gray-800 dark:text-gray-100 tabular-nums">₹{fmtMoney(inv.totalAmount)}</div>
                    <div className="text-[10px] text-rose-600 dark:text-rose-400">pending ₹{fmtMoney(inv.pending)}</div>
                  </div>
                </div>

                {/* Cash splits — auto-rebuilt by re-FIFO whenever TDS / Disc change */}
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

                {/* TDS row */}
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

                {/* Discount row */}
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

                {/* Cash formula line: cash = pending − TDS − discount */}
                <div className={`mt-1.5 text-[10px] flex justify-between ${
                  !row.selected ? 'text-gray-400'
                  : isOver ? 'text-rose-600 dark:text-rose-400'
                  : 'text-gray-500 dark:text-gray-400'
                }`}>
                  {row.selected ? (
                    <>
                      <span>
                        Bank Recpt <span className="font-semibold tabular-nums">₹{fmtMoney(cash)}</span>
                        {' = '}pending ₹{fmtMoney(inv.pending)}
                        {(row.tdsAmount || 0) > 0 && <> − TDS ₹{fmtMoney(row.tdsAmount || 0)}</>}
                        {(row.discountAmount || 0) > 0 && <> − disc ₹{fmtMoney(row.discountAmount || 0)}</>}
                      </span>
                      <span className={`font-semibold ${cashShort > 1 ? 'text-amber-600 dark:text-amber-400' : ''}`}>
                        {cashShort > 1 ? `short ₹${fmtMoney(cashShort)}` : isOver ? '⚠ over' : '✓ closes'}
                      </span>
                    </>
                  ) : (
                    <span className="italic">— skipped (manual mode)</span>
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
              <button onClick={commit} disabled={committing || loading || (selectedCount === 0 && carryOverNum === 0) || overAllocated.length > 0 || !!conflicts || carryOverExceeds}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-semibold">
                {committing ? 'Linking…' : `Confirm ${selectedCount} link${selectedCount === 1 ? '' : 's'}${carryOverNum > 0 ? ` + carry-over` : ''}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
