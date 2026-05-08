'use client'

import { useState, useMemo } from 'react'
import useSWR from 'swr'
import BackButton from '../../BackButton'

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
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string>('')

  const { data, mutate, isLoading } = useSWR<{ rows: Receipt[]; fyTotals: FyTotal[] }>(
    `/api/accounts/receipts?fy=${activeFy}&direction=in`,
    fetcher,
  )

  const rows = data?.rows ?? []
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
    const toIso = `${endYear}-03-31`
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

      {/* Sync button */}
      <div className="flex items-center gap-2 mb-3">
        <button onClick={() => syncFy(activeFy)} disabled={syncing}
          className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold">
          {syncing ? 'Syncing…' : `Sync FY ${activeFy} from Tally`}
        </button>
        {syncMsg && <span className="text-[11px] text-gray-600 dark:text-gray-400 truncate">{syncMsg}</span>}
      </div>

      {/* Card list */}
      {isLoading && <div className="text-center py-8 text-gray-400 text-sm">Loading…</div>}
      {!isLoading && rows.length === 0 && (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400 text-sm">
          No receipts in FY {activeFy}. Tap “Sync FY” to fetch from Tally.
        </div>
      )}

      <div className="space-y-2">
        {rows.map(r => (
          <div key={r.id} className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl p-3 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                    {r.vchType} #{r.vchNumber}
                  </span>
                  <span className="text-[10px] text-gray-500 dark:text-gray-400">{fmtDate(r.date)}</span>
                </div>
                <div className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">{r.partyName}</div>
                {r.narration && (
                  <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2 break-words">{r.narration}</div>
                )}
              </div>
              <div className="text-right shrink-0">
                <div className="text-base font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                  ₹{fmtMoney(r.amount)}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
