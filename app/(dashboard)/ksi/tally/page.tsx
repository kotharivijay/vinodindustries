'use client'

import { useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import BackButton from '../../BackButton'

const fetcher = (url: string) => fetch(url).then(r => { if (!r.ok) throw new Error('Failed'); return r.json() })

interface TallyCompany { name: string; startDate?: string | null; books?: string | null }

function formatINR(n: number) {
  const abs = Math.abs(n)
  const str = abs.toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
  return (n < 0 ? '-' : '') + '₹\u00A0' + str
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
}

// FY starts 1 Apr, ends 31 Mar
function currentFY() {
  const now = new Date()
  const yr = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  return {
    from: `${yr}-04-01`,
    to: `${yr + 1}-03-31`,
    label: `01 Apr ${yr} - 31 Mar ${yr + 1}`,
  }
}

interface TxSummaryItem { amount: number; count: number }
interface TopOverdue { partyName: string; closingBalance: number; overdueDays: number }
interface RecentTx { date: string; vchNumber: string; partyName: string; amount: number; vchType: string; narration: string | null }
interface CashLedger { name: string; parent: string; closingBalance: number }

interface DashData {
  totalReceivable: number
  totalPayable: number
  cashBankBalance: number
  cashBankLedgers: CashLedger[]
  txSummary: Record<string, TxSummaryItem>
  recentTx: RecentTx[]
  topOverdue: TopOverdue[]
}

// vchType display config
const VCH_CONFIG: Record<string, { label: string; icon: string; color: string; bg: string }> = {
  'Sales':         { label: 'Sales',          icon: '📈', color: 'text-green-400',  bg: 'bg-green-900/20 border-green-800' },
  'Credit Note':   { label: 'Credit Note',    icon: '📋', color: 'text-teal-400',   bg: 'bg-teal-900/20 border-teal-800' },
  'Purchase':      { label: 'Purchase',       icon: '🛒', color: 'text-blue-400',   bg: 'bg-blue-900/20 border-blue-800' },
  'Debit Note':    { label: 'Debit Note',     icon: '📄', color: 'text-orange-400', bg: 'bg-orange-900/20 border-orange-800' },
  'Receipt':       { label: 'Receipt',        icon: '💵', color: 'text-emerald-400',bg: 'bg-emerald-900/20 border-emerald-800' },
  'Payment':       { label: 'Payment',        icon: '💳', color: 'text-rose-400',   bg: 'bg-rose-900/20 border-rose-800' },
  'Journal':       { label: 'Journal',        icon: '📓', color: 'text-purple-400', bg: 'bg-purple-900/20 border-purple-800' },
  'Contra':        { label: 'Contra',         icon: '🔄', color: 'text-indigo-400', bg: 'bg-indigo-900/20 border-indigo-800' },
}

type SyncPhase = 'idle' | 'syncing' | 'done' | 'error'

export default function KSITallyDashboard() {
  const fy = currentFY()
  const [dateFrom, setDateFrom] = useState(fy.from)
  const [dateTo, setDateTo] = useState(fy.to)
  // SWR: caches dashboard data per date range — instant re-render on revisit
  const swrKey = `/api/tally/ksi-dashboard?dateFrom=${dateFrom}&dateTo=${dateTo}`
  const { data, error: swrError, isLoading: loading, mutate } = useSWR<DashData>(swrKey, fetcher, {
    revalidateOnFocus: false,       // don't refetch just because tab regains focus
    dedupingInterval: 60_000,       // dedupe identical requests within 60s
    keepPreviousData: true,         // show old data while fetching new date range
  })
  const error = swrError?.message || ''

  // Sync state
  const [syncPhase, setSyncPhase] = useState<SyncPhase>('idle')
  const [syncLog, setSyncLog] = useState<string[]>([])
  const [showSyncLog, setShowSyncLog] = useState(false)
  const [showCashBreakdown, setShowCashBreakdown] = useState(false)
  const [showCompanies, setShowCompanies] = useState(false)
  const { data: companiesData, isLoading: companiesLoading, error: companiesError, mutate: refetchCompanies } =
    useSWR<{ companies: TallyCompany[]; error?: string }>(
      showCompanies ? '/api/tally/companies' : null,
      fetcher,
      { revalidateOnFocus: false, dedupingInterval: 30_000 }
    )

  async function handleSync(type: 'ledgers' | 'outstanding' | 'sales' | 'all') {
    setSyncPhase('syncing')
    setSyncLog([])
    setShowSyncLog(true)

    const routes: Record<string, string> = {
      ledgers: '/api/tally/ledger-sync',
      outstanding: '/api/tally/outstanding-sync?firm=KSI',
      sales: '/api/tally/sales-sync?firm=KSI',
      all: '',
    }

    const toSync = type === 'all' ? ['ledgers', 'outstanding', 'sales'] : [type]

    try {
      for (const t of toSync) {
        const url = routes[t]
        setSyncLog(prev => [...prev, `▶ Starting ${t} sync for KSI...`])
        const res = await fetch(url)
        const reader = res.body?.getReader()
        if (!reader) continue
        const decoder = new TextDecoder()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const text = decoder.decode(value)
          const lines = text.split('\n').filter(l => l.startsWith('data:'))
          for (const line of lines) {
            try {
              const json = JSON.parse(line.replace('data:', '').trim())
              if (json.message) setSyncLog(prev => [...prev, json.message])
              if (json.done) setSyncLog(prev => [...prev, `✓ ${t} sync complete`])
            } catch {}
          }
        }
      }
      setSyncPhase('done')
      // Invalidate SWR cache so dashboard reloads fresh data
      mutate()
    } catch (e: any) {
      setSyncLog(prev => [...prev, `✗ Error: ${e.message}`])
      setSyncPhase('error')
    }
  }

  const txOrder = ['Sales', 'Credit Note', 'Purchase', 'Debit Note', 'Receipt', 'Payment', 'Journal', 'Contra']

  return (
    <div className="p-4 md:p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-5 gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <BackButton />
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              🏭 Kothari Synthetic Industries
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">Tally Prime — Financial Dashboard</p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => handleSync('all')}
            disabled={syncPhase === 'syncing'}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition"
          >
            {syncPhase === 'syncing' ? (
              <><span className="animate-spin">⟳</span> Syncing...</>
            ) : (
              <><span>🔄</span> Sync All</>
            )}
          </button>
          <button
            onClick={() => { setSyncPhase('idle'); setShowSyncLog(false) }}
            className="text-xs text-gray-400 border border-gray-600 rounded-lg px-3 py-1.5 hover:bg-gray-700"
          >
            Individual Sync ▾
          </button>
        </div>
      </div>

      {/* Individual sync dropdown */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {['ledgers', 'outstanding', 'sales'].map(t => (
          <button
            key={t}
            onClick={() => handleSync(t as any)}
            disabled={syncPhase === 'syncing'}
            className="text-xs text-gray-300 border border-gray-700 bg-gray-800 hover:bg-gray-700 rounded-lg px-3 py-1 disabled:opacity-40 capitalize"
          >
            Sync {t}
          </button>
        ))}
      </div>

      {/* Tally Companies Panel */}
      <div className="mb-4">
        <button
          onClick={() => setShowCompanies(v => !v)}
          className="text-xs text-gray-400 hover:text-gray-200 flex items-center gap-1.5 transition"
        >
          <span className={`transition-transform ${showCompanies ? 'rotate-90' : ''}`}>▶</span>
          Tally Companies
        </button>
        {showCompanies && (
          <div className="mt-2 bg-gray-900 border border-gray-700 rounded-xl p-3">
            {companiesLoading && <p className="text-xs text-gray-500 animate-pulse">Fetching from Tally...</p>}
            {companiesError && (
              <p className="text-xs text-red-400">
                Failed to connect — {companiesError.message}
                <button onClick={() => refetchCompanies()} className="ml-2 underline">Retry</button>
              </p>
            )}
            {companiesData?.error && (
              <p className="text-xs text-red-400">{companiesData.error}</p>
            )}
            {companiesData?.companies && companiesData.companies.length === 0 && (
              <p className="text-xs text-gray-500">No companies returned from Tally.</p>
            )}
            {companiesData?.companies && companiesData.companies.length > 0 && (() => {
              const configured = 'Kothari Synthetic Industries'
              const exactMatch = companiesData.companies.find(c => c.name === configured)
              const fuzzyMatch = !exactMatch && companiesData.companies.find(c =>
                c.name.toLowerCase().includes('kothari') || c.name.toLowerCase().includes('synthetic')
              )
              return (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] text-gray-500 uppercase font-semibold tracking-wide">
                      {companiesData.companies.length} companies in Tally
                    </p>
                    <p className="text-[10px] text-gray-600">
                      Configured: <span className="font-mono text-gray-400">{configured}</span>
                    </p>
                  </div>
                  {!exactMatch && fuzzyMatch && (
                    <div className="bg-amber-900/30 border border-amber-700 rounded-lg px-3 py-2 mb-2">
                      <p className="text-xs text-amber-300 font-semibold">⚠ Name mismatch detected</p>
                      <p className="text-[10px] text-amber-400 mt-0.5">
                        Configured: <span className="font-mono">&quot;{configured}&quot;</span>
                      </p>
                      <p className="text-[10px] text-amber-400">
                        Tally has: <span className="font-mono font-bold">&quot;{fuzzyMatch.name}&quot;</span>
                      </p>
                      <p className="text-[10px] text-amber-500 mt-1">
                        Update <span className="font-mono">lib/tally.ts</span> and all sync routes with the exact Tally name.
                      </p>
                    </div>
                  )}
                  {exactMatch && (
                    <div className="bg-green-900/20 border border-green-800 rounded-lg px-3 py-2 mb-2">
                      <p className="text-xs text-green-400">✓ Company name matches Tally exactly</p>
                    </div>
                  )}
                  {companiesData.companies.map((c, i) => {
                    const isKsi = c.name === configured
                    const isFuzzy = !isKsi && (c.name.toLowerCase().includes('kothari') || c.name.toLowerCase().includes('synthetic'))
                    return (
                      <div key={i} className={`flex items-center justify-between rounded-lg px-3 py-2 border text-xs ${
                        isKsi ? 'bg-green-900/20 border-green-800' :
                        isFuzzy ? 'bg-amber-900/20 border-amber-800' :
                        'bg-gray-800 border-gray-700'
                      }`}>
                        <span className={`font-mono ${isKsi ? 'text-green-300' : isFuzzy ? 'text-amber-300 font-bold' : 'text-gray-300'}`}>
                          {c.name}
                          {isKsi && <span className="ml-2 text-green-500 font-sans">← configured</span>}
                          {isFuzzy && <span className="ml-2 text-amber-500 font-sans font-normal">← use this</span>}
                        </span>
                        {c.startDate && <span className="text-gray-600 text-[10px]">{c.startDate}</span>}
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        )}
      </div>

      {/* Sync log */}
      {showSyncLog && syncLog.length > 0 && (
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-3 mb-4 max-h-36 overflow-y-auto">
          {syncLog.map((l, i) => (
            <p key={i} className={`text-xs font-mono ${l.startsWith('✓') ? 'text-green-400' : l.startsWith('✗') ? 'text-red-400' : 'text-gray-400'}`}>{l}</p>
          ))}
        </div>
      )}

      {/* Date Range */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-3 mb-4 flex items-center gap-3 flex-wrap">
        <span className="text-xs text-gray-400">📅 Period:</span>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="bg-gray-700 border border-gray-600 text-gray-100 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
        <span className="text-gray-500 text-xs">to</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="bg-gray-700 border border-gray-600 text-gray-100 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
        <button onClick={() => { setDateFrom(fy.from); setDateTo(fy.to) }}
          className="text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-800 rounded-lg px-2.5 py-1">
          FY Reset
        </button>
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <Link href="/ksi/outstanding"
          className="bg-gray-800 border border-gray-700 rounded-xl p-4 flex items-center gap-3 hover:bg-gray-700 transition group">
          <span className="text-2xl">👥</span>
          <div>
            <p className="text-sm font-semibold text-white group-hover:text-indigo-300 transition">Parties</p>
            <p className="text-[10px] text-gray-400">Outstanding ledger</p>
          </div>
        </Link>
        <Link href="/ksi/sales"
          className="bg-gray-800 border border-gray-700 rounded-xl p-4 flex items-center gap-3 hover:bg-gray-700 transition group">
          <span className="text-2xl">📦</span>
          <div>
            <p className="text-sm font-semibold text-white group-hover:text-indigo-300 transition">Items</p>
            <p className="text-[10px] text-gray-400">Sales register</p>
          </div>
        </Link>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700 text-red-300 rounded-xl px-4 py-3 mb-4 text-sm">
          {error} — <button onClick={() => mutate()} className="underline">Retry</button>
        </div>
      )}

      {loading && !data && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-gray-800 border border-gray-700 rounded-xl h-20 animate-pulse" />
          ))}
        </div>
      )}

      {data && (
        <>
          {/* Key Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            {/* Outstanding Receivable */}
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xl">🤝</span>
                <span className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Outstanding Receivable</span>
              </div>
              <p className="text-xl font-bold text-green-400">{formatINR(data.totalReceivable)}</p>
              <Link href="/ksi/outstanding?type=receivable" className="text-[10px] text-indigo-400 hover:text-indigo-300 mt-0.5 block">
                View bills →
              </Link>
            </div>

            {/* Outstanding Payable */}
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xl">💸</span>
                <span className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Outstanding Payable</span>
              </div>
              <p className="text-xl font-bold text-rose-400">{formatINR(data.totalPayable)}</p>
              <Link href="/ksi/outstanding?type=payable" className="text-[10px] text-indigo-400 hover:text-indigo-300 mt-0.5 block">
                View bills →
              </Link>
            </div>

            {/* Cash / Bank Balance */}
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xl">🏦</span>
                <span className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Cash / Bank Balance</span>
              </div>
              <p className={`text-xl font-bold ${data.cashBankBalance >= 0 ? 'text-blue-400' : 'text-red-400'}`}>
                {formatINR(data.cashBankBalance)}
              </p>
              <button
                onClick={() => setShowCashBreakdown(v => !v)}
                className="text-[10px] text-indigo-400 hover:text-indigo-300 mt-0.5 block"
              >
                {showCashBreakdown ? 'Hide' : 'Show'} breakdown ▾
              </button>
              {showCashBreakdown && data.cashBankLedgers.length > 0 && (
                <div className="mt-2 space-y-0.5">
                  {data.cashBankLedgers.map((l, i) => (
                    <div key={i} className="flex justify-between text-[10px]">
                      <span className="text-gray-400 truncate max-w-[120px]">{l.name}</span>
                      <span className={l.closingBalance >= 0 ? 'text-blue-300' : 'text-red-300'}>
                        {formatINR(l.closingBalance)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Transaction Totals */}
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 mb-4">
            <h2 className="text-sm font-semibold text-white mb-3">
              Transaction Summary
              <span className="ml-2 text-xs text-gray-400 font-normal">{fy.label}</span>
            </h2>
            <div className="space-y-2">
              {txOrder.map(vchType => {
                const item = data.txSummary[vchType]
                if (!item) return null
                const cfg = VCH_CONFIG[vchType] || { label: vchType, icon: '📋', color: 'text-gray-300', bg: 'bg-gray-700/40 border-gray-600' }
                return (
                  <div key={vchType} className={`flex items-center justify-between border rounded-lg px-3 py-2.5 ${cfg.bg}`}>
                    <div className="flex items-center gap-2.5">
                      <span className="text-base leading-none">{cfg.icon}</span>
                      <div>
                        <p className={`text-sm font-semibold ${cfg.color}`}>{cfg.label}</p>
                        <p className="text-[10px] text-gray-500">{item.count} vouchers</p>
                      </div>
                    </div>
                    <p className={`text-sm font-bold ${cfg.color}`}>{formatINR(item.amount)}</p>
                  </div>
                )
              })}
              {/* Any other vchTypes not in the predefined order */}
              {Object.entries(data.txSummary)
                .filter(([k]) => !txOrder.includes(k))
                .map(([vchType, item]) => (
                  <div key={vchType} className="flex items-center justify-between border border-gray-700 rounded-lg px-3 py-2.5 bg-gray-700/30">
                    <div className="flex items-center gap-2.5">
                      <span className="text-base leading-none">📋</span>
                      <div>
                        <p className="text-sm font-semibold text-gray-300">{vchType}</p>
                        <p className="text-[10px] text-gray-500">{item.count} vouchers</p>
                      </div>
                    </div>
                    <p className="text-sm font-bold text-gray-300">{formatINR(item.amount)}</p>
                  </div>
                ))}
              {Object.keys(data.txSummary).length === 0 && (
                <p className="text-xs text-gray-500 text-center py-4">No transaction data. Click &quot;Sync All&quot; to pull from Tally.</p>
              )}
            </div>
          </div>

          {/* Top Overdue Parties */}
          {data.topOverdue.length > 0 && (
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-white">⚠ Top Overdue Receivables</h2>
                <Link href="/ksi/outstanding?type=receivable" className="text-xs text-indigo-400 hover:text-indigo-300">View all →</Link>
              </div>
              <div className="space-y-2">
                {data.topOverdue.map((p, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-200 truncate">{p.partyName}</p>
                      <p className="text-[10px] text-red-400">{p.overdueDays} days overdue</p>
                    </div>
                    <p className="font-semibold text-rose-400 shrink-0 ml-3">{formatINR(p.closingBalance)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent Transactions */}
          {data.recentTx.length > 0 && (
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-white">Recent Transactions</h2>
                <Link href="/ksi/sales" className="text-xs text-indigo-400 hover:text-indigo-300">View all →</Link>
              </div>
              <div className="space-y-0 divide-y divide-gray-700">
                {data.recentTx.map((tx, i) => {
                  const cfg = VCH_CONFIG[tx.vchType]
                  return (
                    <div key={i} className="py-2 flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs">{cfg?.icon || '📋'}</span>
                          <p className="text-xs font-medium text-gray-200 truncate">{tx.partyName || tx.narration || '—'}</p>
                        </div>
                        <p className="text-[10px] text-gray-500">{fmtDate(tx.date)} · {tx.vchType} #{tx.vchNumber}</p>
                      </div>
                      <p className={`text-xs font-semibold shrink-0 ${cfg?.color || 'text-gray-300'}`}>
                        {formatINR(tx.amount)}
                      </p>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
