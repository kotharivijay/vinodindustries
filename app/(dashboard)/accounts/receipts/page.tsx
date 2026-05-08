'use client'

import { useState, useMemo, useEffect } from 'react'
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
  hidden: boolean
  hiddenReason: string | null
}
interface FyTotal { fy: string; count: number; total: number }

const fmtDate = (iso: string) => {
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}-${d.toLocaleString('en-IN', { month: 'short' })}-${String(d.getFullYear()).slice(2)}`
}
const fmtMoney = (n: number) =>
  n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function ReceiptsPage() {
  const [activeFy, setActiveFy] = useState<string>('26-27')
  const [sortBy, setSortBy] = useState<SortBy>('date-desc')
  const [showHidden, setShowHidden] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string>('')

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

  // Clear selection when FY tab or filter changes
  useEffect(() => { setSelected(new Set()) }, [activeFy, showHidden])

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
  const rows = useMemo(() => {
    const dateKey = (r: Receipt) => new Date(r.date).getTime()
    const partyKey = (r: Receipt) => (r.partyName || '').toLowerCase()
    const sorted = [...apiRows]
    switch (sortBy) {
      case 'date-desc':   sorted.sort((a, b) => dateKey(b) - dateKey(a) || b.id - a.id); break
      case 'date-asc':    sorted.sort((a, b) => dateKey(a) - dateKey(b) || a.id - b.id); break
      case 'party-asc':   sorted.sort((a, b) => partyKey(a).localeCompare(partyKey(b)) || dateKey(b) - dateKey(a)); break
      case 'party-desc':  sorted.sort((a, b) => partyKey(b).localeCompare(partyKey(a)) || dateKey(b) - dateKey(a)); break
      case 'amount-desc': sorted.sort((a, b) => b.amount - a.amount || dateKey(b) - dateKey(a)); break
      case 'amount-asc':  sorted.sort((a, b) => a.amount - b.amount || dateKey(b) - dateKey(a)); break
    }
    return sorted
  }, [apiRows, sortBy])
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

      {/* Sync button + Show Hidden toggle */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <button onClick={() => syncFy(activeFy)} disabled={syncing}
          className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold">
          {syncing ? 'Syncing…' : `Sync FY ${activeFy} from Tally`}
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
          return (
            <label key={r.id}
              className={`flex items-start gap-2 bg-white dark:bg-gray-800 border rounded-xl p-3 shadow-sm cursor-pointer transition ${
                r.hidden ? 'opacity-60 border-amber-200 dark:border-amber-700/40' : 'border-gray-100 dark:border-gray-700'
              } ${isSelected ? 'ring-2 ring-emerald-500 border-emerald-500' : ''}`}>
              <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(r.id)}
                className="mt-1.5 w-4 h-4 accent-emerald-600 shrink-0" />
              <div className="flex items-start justify-between gap-2 flex-1 min-w-0">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                      {r.vchType} #{r.vchNumber}
                    </span>
                    <span className="text-[10px] text-gray-500 dark:text-gray-400">{fmtDate(r.date)}</span>
                    {r.hidden && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200"
                        title={r.hiddenReason || 'hidden'}>
                        Hidden{r.hiddenReason ? ` · ${r.hiddenReason}` : ''}
                      </span>
                    )}
                  </div>
                  <div className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">{r.partyName}</div>
                  {r.narration && (
                    <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2 break-words">{r.narration}</div>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className={`text-base font-bold tabular-nums ${r.hidden ? 'text-gray-500 dark:text-gray-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                    ₹{fmtMoney(r.amount)}
                  </div>
                </div>
              </div>
            </label>
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
