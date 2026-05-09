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
        <div className="fixed bottom-3 left-3 right-3 z-40 max-w-3xl mx-auto bg-gray-900 text-gray-100 rounded-xl shadow-2xl border border-emerald-500/40 px-3 py-2.5 flex items-center gap-2">
          <div className="flex-1 min-w-0 text-xs">
            <span className="font-semibold">{selected.size} selected</span>
          </div>
          <button onClick={() => setSelected(new Set())}
            className="text-xs text-gray-300 hover:text-white px-2.5 py-1.5 rounded-lg border border-gray-600">
            Clear
          </button>
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
    </div>
  )
}
