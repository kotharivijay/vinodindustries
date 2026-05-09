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

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface LinkedInvoice {
  vchType: string
  vchNumber: string
  allocatedAmount: number
  tdsAmount: number
  discountAmount: number
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
  linkedCount: number
  linkedCash: number
  linkedTds: number
  linkedDiscount: number
  linkedInvoices: LinkedInvoice[]
}
type LinkFilter = 'all' | 'linked' | 'unlinked'

interface DryRunReceipt { id: number; vchType: string; vchNumber: string; date: string; amount: number; partyName: string }
interface DryRunInvoice { id: number; vchType: string; vchNumber: string; date: string; totalAmount: number; taxableAmount: number | null; partyGstin: string | null; pending: number }
interface DryRunSplit { receiptId: number; allocatedAmount: number }
interface DryRunPlanRow { invoiceId: number; allocations: DryRunSplit[] }
interface DryRunResponse {
  dryRun: true
  plan: DryRunPlanRow[]
  totals: { receipts: number; linked: number; delta: number; leftoverReceipt: number; leftoverInvoice: number }
  receipts: DryRunReceipt[]
  invoices: DryRunInvoice[]
  includeAdvance: boolean
}
interface EditableRow extends DryRunPlanRow {
  tdsRatePct: number | null
  tdsAmount: number
  discountPct: number | null
  discountAmount: number
}
const DEFAULT_TDS_RATE = 2
interface FyTotal { fy: string; count: number; total: number }

const fmtDate = (iso: string) => {
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}-${d.toLocaleString('en-IN', { month: 'short' })}-${String(d.getFullYear()).slice(2)}`
}
const fmtMoney = (n: number) =>
  n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function ReceiptsPage() {
  const router = useRouter()
  const [activeFy, setActiveFy] = useState<string>('26-27')
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

  const { data, mutate, isLoading } = useSWR<{ rows: Receipt[]; fyTotals: FyTotal[]; hiddenCount: number }>(
    `/api/accounts/receipts?fy=${activeFy}&direction=in${showHidden ? '&showHidden=1' : ''}`,
    fetcher,
  )

  // Clear selection when FY tab or filter changes; also when select mode toggles off
  useEffect(() => { setSelected(new Set()) }, [activeFy, showHidden])
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

  // Compute the 12 months covered by the active FY for the picker.
  const monthOptions = useMemo(() => {
    const startYear = 2000 + parseInt(activeFy.split('-')[0])
    const months = []
    for (let i = 0; i < 12; i++) {
      const y = i < 9 ? startYear : startYear + 1
      const m = ((i + 3) % 12) + 1 // April=4, May=5, …, March=3
      const value = `${y}-${String(m).padStart(2, '0')}`
      const label = `${new Date(y, m - 1).toLocaleString('en-IN', { month: 'short' })} ${String(y).slice(2)}`
      months.push({ value, label })
    }
    return months
  }, [activeFy])

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
      filtered = filtered.filter(r => r.linkedCount > 0)
      if (hideMatched) {
        filtered = filtered.filter(r => Math.abs(r.amount - r.linkedCash) > 1)
      }
    } else if (linkFilter === 'unlinked') {
      filtered = filtered.filter(r => r.linkedCount === 0)
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
    { fy: '25-26', label: 'FY 25-26' },
    { fy: '26-27', label: 'FY 26-27' },
  ]

  async function syncFy(fy: string) {
    setSyncing(true); setSyncMsg('')
    const startYear = 2000 + parseInt(fy.split('-')[0])
    const endYear = startYear + 1
    const fromIso = `${startYear}-04-01`
    // Cap at today when FY isn't over yet — no point asking Tally for
    // future dates (it returns nothing) and it makes the fetch faster.
    const fyEndIso = `${endYear}-03-31`
    const todayIso = new Date().toISOString().slice(0, 10)
    const toIso = fyEndIso > todayIso ? todayIso : fyEndIso
    try {
      const r = await fetch('/api/tally/ksi-hdfc-sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: fromIso, to: toIso }),
      })
      const d = await r.json()
      if (!r.ok) { setSyncMsg(d.error || 'Sync failed'); return }
      setSyncMsg(`Synced ${d.saved}/${d.fetched} rows · IN ₹${fmtMoney(d.inflow)} · OUT ₹${fmtMoney(d.outflow)}`)
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

      {/* FY tabs */}
      <div className="flex gap-2 mb-3">
        {tabs.map(t => {
          const total = fyMap.get(t.fy)
          const isActive = activeFy === t.fy
          return (
            <button key={t.fy} onClick={() => setActiveFy(t.fy)}
              className={`flex-1 px-3 py-2 rounded-xl text-xs font-semibold border transition ${
                isActive
                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                  : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300'
              }`}>
              <div>{t.label}</div>
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
        <button onClick={() => syncFy(activeFy)} disabled={syncing}
          className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold">
          {syncing ? 'Syncing…' : `Sync FY ${activeFy} from Tally`}
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
            title="Hide receipts whose cash linked equals the receipt amount within ±₹1"
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
          No receipts in FY {activeFy}. Tap “Sync FY” to fetch from Tally.
        </div>
      )}

      <div className="space-y-2">
        {rows.map(r => {
          const isSelected = selected.has(r.id)
          const onCardClick = () => {
            if (selectMode) toggleSelect(r.id)
            else router.push(`/accounts/receipts/${r.id}${r.linkedCount > 0 ? '?view=linked' : ''}`)
          }
          const diff = r.amount - r.linkedCash
          const matched = r.linkedCount > 0 && Math.abs(diff) <= 1
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
                        title={`${r.linkedCount} invoice(s) linked · cash ₹${fmtMoney(r.linkedCash)}${r.linkedTds > 0 ? ` · TDS ₹${fmtMoney(r.linkedTds)}` : ''}${r.linkedDiscount > 0 ? ` · disc ₹${fmtMoney(r.linkedDiscount)}` : ''}`}>
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
                        <div key={i} className="flex items-center gap-1.5">
                          <span className="font-mono text-indigo-600 dark:text-indigo-300">{inv.vchType} {inv.vchNumber}</span>
                          <span className="tabular-nums">₹{fmtMoney(inv.allocatedAmount)}</span>
                          {inv.tdsAmount > 0 && <span className="text-amber-600 dark:text-amber-400">+TDS ₹{fmtMoney(inv.tdsAmount)}</span>}
                          {inv.discountAmount > 0 && <span className="text-rose-600 dark:text-rose-400">+disc ₹{fmtMoney(inv.discountAmount)}</span>}
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
                  {r.linkedCount > 0 && (
                    <>
                      <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 tabular-nums">
                        linked ₹{fmtMoney(r.linkedCash)}
                      </div>
                      <div className={`text-[10px] font-semibold tabular-nums ${
                        matched ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
                      }`}>
                        Δ ₹{fmtMoney(diff)}
                      </div>
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
  const [data, setData] = useState<DryRunResponse | null>(null)
  const [rows, setRows] = useState<EditableRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [conflicts, setConflicts] = useState<{ receiptId: number; vchNumber: string; existingLinks: number }[] | null>(null)
  const [committing, setCommitting] = useState(false)

  // Re-run dry-run on mount + whenever the advance toggle flips. Server
  // returns the FIFO plan; we then seed editable TDS/discount fields.
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
        setRows(d.plan.map((p: DryRunPlanRow): EditableRow => {
          const inv = invById[p.invoiceId]
          const cash = p.allocations.reduce((s, a) => s + a.allocatedAmount, 0)
          const taxableShare = inv?.taxableAmount && inv.taxableAmount > 0 && inv.totalAmount > 0
            ? (inv.taxableAmount * cash) / inv.totalAmount
            : 0
          const tdsAmount = Math.round((taxableShare * DEFAULT_TDS_RATE) / 100)
          return {
            ...p,
            tdsRatePct: DEFAULT_TDS_RATE,
            tdsAmount,
            discountPct: null,
            discountAmount: 0,
          }
        }))
      })
      .catch(e => { if (alive) setError(e?.message || 'Network error') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [receiptIds, partyName, includeAdvance])

  function updateRow(idx: number, patch: Partial<EditableRow>) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r))
  }
  function applyTdsRate(idx: number) {
    const row = rows[idx]
    const inv = data?.invoices.find(i => i.id === row.invoiceId)
    if (!inv) return
    const cash = row.allocations.reduce((s, a) => s + a.allocatedAmount, 0)
    const taxableShare = inv.taxableAmount && inv.taxableAmount > 0 && inv.totalAmount > 0
      ? (inv.taxableAmount * cash) / inv.totalAmount
      : 0
    const rate = row.tdsRatePct ?? DEFAULT_TDS_RATE
    updateRow(idx, { tdsAmount: Math.round((taxableShare * rate) / 100) })
  }
  function applyDiscPct(idx: number) {
    const row = rows[idx]
    const inv = data?.invoices.find(i => i.id === row.invoiceId)
    if (!inv) return
    const cash = row.allocations.reduce((s, a) => s + a.allocatedAmount, 0)
    const taxableShare = inv.taxableAmount && inv.taxableAmount > 0 && inv.totalAmount > 0
      ? (inv.taxableAmount * cash) / inv.totalAmount
      : 0
    const pct = row.discountPct ?? 0
    if (pct <= 0) return
    updateRow(idx, { discountAmount: Math.round((taxableShare * pct) / 100) })
  }

  // Live totals derived from the editable rows
  const totals = useMemo(() => {
    const sumReceipts = data?.totals.receipts ?? 0
    let cash = 0, tds = 0, disc = 0
    for (const row of rows) {
      cash += row.allocations.reduce((s, a) => s + a.allocatedAmount, 0)
      tds += row.tdsAmount || 0
      disc += row.discountAmount || 0
    }
    return { sumReceipts, cash, tds, disc, delta: sumReceipts - cash }
  }, [data, rows])

  // Per-row over-allocation guard: cash + tds + disc must be ≤ pending.
  const overAllocated = useMemo(() => {
    if (!data) return [] as number[]
    const idxs: number[] = []
    rows.forEach((row, i) => {
      const inv = data.invoices.find(x => x.id === row.invoiceId)
      if (!inv) return
      const cash = row.allocations.reduce((s, a) => s + a.allocatedAmount, 0)
      if (cash + (row.tdsAmount || 0) + (row.discountAmount || 0) > inv.pending + 1) idxs.push(i)
    })
    return idxs
  }, [data, rows])

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
        rows: rows.map(r => ({
          invoiceId: r.invoiceId,
          allocations: r.allocations,
          tdsRatePct: r.tdsRatePct ?? null,
          tdsAmount: r.tdsAmount || 0,
          discountAmount: r.discountAmount || 0,
        })),
      }
      const res = await fetch('/api/accounts/receipts/bulk-allocate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await res.json()
      if (!res.ok) { setError(d.error || 'Commit failed'); return }
      onDone(d.saved ?? rows.length)
    } catch (e: any) { setError(e?.message || 'Network error') }
    finally { setCommitting(false) }
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
                    <div>− Linked cash <span className="font-semibold text-indigo-700 dark:text-indigo-300 tabular-nums">₹{fmtMoney(totals.cash)}</span></div>
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
          <div className="flex items-center gap-1.5 mt-2 text-[11px]">
            <button onClick={() => setIncludeAdvance(v => !v)}
              className={`px-2 py-0.5 rounded-full border transition ${
                includeAdvance
                  ? 'bg-amber-100 dark:bg-amber-900/40 border-amber-400 dark:border-amber-700 text-amber-800 dark:text-amber-200'
                  : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'
              }`}>
              {includeAdvance ? '✓ Including advance invoices' : '+ Advance invoices'}
            </button>
            <span className="text-gray-400 text-[10px]">
              {includeAdvance ? 'all pending bills' : `bills dated ≤ newest receipt`}
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

          {/* Receipts (read-only) */}
          {data && (
            <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-2.5 text-[11px] bg-gray-50 dark:bg-gray-800/40">
              <div className="font-semibold text-gray-700 dark:text-gray-200 mb-1">Receipts ({data.receipts.length}) · oldest first</div>
              {data.receipts.map(r => {
                const used = rows.reduce((s, row) => s + row.allocations.filter(a => a.receiptId === r.id).reduce((ss, a) => ss + a.allocatedAmount, 0), 0)
                const left = Math.max(0, r.amount - used)
                return (
                  <div key={r.id} className="flex items-center justify-between gap-2 py-0.5">
                    <span className="font-mono text-emerald-700 dark:text-emerald-300">#{r.vchNumber}</span>
                    <span className="text-gray-500">{fmtDate(r.date)}</span>
                    <span className="text-gray-700 dark:text-gray-200 tabular-nums">₹{fmtMoney(r.amount)}</span>
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
            const cash = row.allocations.reduce((s, a) => s + a.allocatedAmount, 0)
            const consumed = cash + (row.tdsAmount || 0) + (row.discountAmount || 0)
            const isOver = overAllocated.includes(idx)
            const taxableShare = inv.taxableAmount && inv.taxableAmount > 0 && inv.totalAmount > 0
              ? (inv.taxableAmount * cash) / inv.totalAmount
              : 0
            return (
              <div key={inv.id} className={`border rounded-xl p-3 ${
                isOver
                  ? 'border-rose-300 dark:border-rose-700/40 bg-rose-50 dark:bg-rose-900/10'
                  : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
              }`}>
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="min-w-0">
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

                {/* Cash splits (read-only, FIFO from server) */}
                <div className="text-[10px] text-gray-600 dark:text-gray-300 space-y-0.5 mt-1">
                  {row.allocations.map((s, i) => {
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
                  <span className="text-gray-400 text-[10px] whitespace-nowrap">on ₹{fmtMoney(taxableShare)}</span>
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

                {/* Consumed line */}
                <div className={`mt-1.5 text-[10px] flex justify-between ${isOver ? 'text-rose-600 dark:text-rose-400' : 'text-gray-500 dark:text-gray-400'}`}>
                  <span>cash ₹{fmtMoney(cash)} + TDS ₹{fmtMoney(row.tdsAmount || 0)} + disc ₹{fmtMoney(row.discountAmount || 0)}</span>
                  <span className="font-semibold">= ₹{fmtMoney(consumed)} {isOver && '⚠ over'}</span>
                </div>
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={committing}
            className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 text-xs">
            Cancel
          </button>
          <button onClick={commit} disabled={committing || loading || rows.length === 0 || overAllocated.length > 0 || !!conflicts}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-semibold">
            {committing ? 'Linking…' : `Confirm ${rows.length} link${rows.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
