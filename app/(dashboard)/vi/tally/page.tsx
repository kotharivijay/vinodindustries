'use client'

import { useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => { if (!r.ok) throw new Error('Failed'); return r.json() })

const FIRM_NAMES: Record<string, string> = { VI: 'Vinod Industries', VCF: 'Vimal Cotton Fabrics', VF: 'Vijay Fabrics' }
const FIRM_COLORS: Record<string, { bg: string; text: string }> = {
  VI:  { bg: 'bg-blue-900/30 border-blue-700', text: 'text-blue-400' },
  VCF: { bg: 'bg-teal-900/30 border-teal-700', text: 'text-teal-400' },
  VF:  { bg: 'bg-orange-900/30 border-orange-700', text: 'text-orange-400' },
}

function formatINR(n: number) {
  const abs = Math.abs(n)
  const str = abs.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  return (n < 0 ? '-' : '') + '\u20B9\u00A0' + str
}

function fmtDate(d: string | null) {
  if (!d) return '\u2014'
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
}

function currentFY() {
  const now = new Date()
  const yr = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  return {
    from: `${yr}-04-01`,
    to: `${yr + 1}-03-31`,
    label: `01 Apr ${yr} - 31 Mar ${yr + 1}`,
  }
}

const VCH_CONFIG: Record<string, { label: string; icon: string; color: string; bg: string }> = {
  'Sales':       { label: 'Sales',       icon: '\uD83D\uDCC8', color: 'text-green-400',   bg: 'bg-green-900/20 border-green-800' },
  'Credit Note': { label: 'Credit Note', icon: '\uD83D\uDCCB', color: 'text-teal-400',    bg: 'bg-teal-900/20 border-teal-800' },
  'Purchase':    { label: 'Purchase',    icon: '\uD83D\uDED2', color: 'text-blue-400',    bg: 'bg-blue-900/20 border-blue-800' },
  'Debit Note':  { label: 'Debit Note',  icon: '\uD83D\uDCC4', color: 'text-orange-400',  bg: 'bg-orange-900/20 border-orange-800' },
  'Receipt':     { label: 'Receipt',     icon: '\uD83D\uDCB5', color: 'text-emerald-400', bg: 'bg-emerald-900/20 border-emerald-800' },
  'Payment':     { label: 'Payment',     icon: '\uD83D\uDCB3', color: 'text-rose-400',    bg: 'bg-rose-900/20 border-rose-800' },
  'Journal':     { label: 'Journal',     icon: '\uD83D\uDCD3', color: 'text-purple-400',  bg: 'bg-purple-900/20 border-purple-800' },
  'Contra':      { label: 'Contra',      icon: '\uD83D\uDD04', color: 'text-indigo-400',  bg: 'bg-indigo-900/20 border-indigo-800' },
}

interface TopOverdue { partyName: string; closingBalance: number; overdueDays: number; firmCode: string }
interface RecentSale { date: string; vchNumber: string; partyName: string; amount: number; vchType: string; narration: string | null; firmCode: string }
interface TxSummaryItem { amount: number; count: number }

interface DashData {
  totalReceivable: number
  totalPayable: number
  totalSalesAmount: number
  totalSalesCount: number
  ledgerCount: number
  txSummary: Record<string, TxSummaryItem>
  topOverdue: TopOverdue[]
  recentSales: RecentSale[]
  firmBreakdown: Record<string, { receivable: number; payable: number; billCount: number }>
}

type SyncPhase = 'idle' | 'syncing' | 'done' | 'error'

export default function VITallyDashboard() {
  const fy = currentFY()
  const [dateFrom, setDateFrom] = useState(fy.from)
  const [dateTo, setDateTo] = useState(fy.to)

  const swrKey = `/api/tally/vi-dashboard?dateFrom=${dateFrom}&dateTo=${dateTo}`
  const { data, error: swrError, isLoading: loading, mutate } = useSWR<DashData>(swrKey, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
    keepPreviousData: true,
  })
  const error = swrError?.message || ''

  const [syncPhase, setSyncPhase] = useState<SyncPhase>('idle')
  const [syncLog, setSyncLog] = useState<string[]>([])
  const [showSyncLog, setShowSyncLog] = useState(false)

  async function handleSync(type: 'ledgers' | 'outstanding' | 'sales' | 'bank' | 'all') {
    setSyncPhase('syncing')
    setSyncLog([])
    setShowSyncLog(true)

    const routes: Record<string, string> = {
      ledgers: '/api/tally/sync-stream?firm=',
      outstanding: '/api/tally/outstanding-sync?firm=',
      sales: '/api/tally/sales-sync?firm=',
      bank: '/api/tally/bank-sync',
      all: '',
    }

    const toSync = type === 'all' ? ['ledgers', 'outstanding', 'sales', 'bank'] : [type]

    try {
      for (const t of toSync) {
        const baseUrl = routes[t]
        setSyncLog(prev => [...prev, `\u25B6 Starting ${t} sync for VI firms...`])
        const res = await fetch(baseUrl)
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
              if (json.done) setSyncLog(prev => [...prev, `\u2713 ${t} sync complete`])
            } catch {}
          }
        }
      }
      setSyncPhase('done')
      mutate()
    } catch (e: any) {
      setSyncLog(prev => [...prev, `\u2717 Error: ${e.message}`])
      setSyncPhase('error')
    }
  }

  const txOrder = ['Sales', 'Credit Note', 'Purchase', 'Debit Note', 'Receipt', 'Payment', 'Journal', 'Contra']

  return (
    <div className="p-4 md:p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            🏢 Vinod Industries Group
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">Tally Prime — Financial Dashboard (VI + VCF + VF)</p>
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
        </div>
      </div>

      {/* Individual sync buttons */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {['ledgers', 'outstanding', 'sales', 'bank'].map(t => (
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

      {/* Sync log */}
      {showSyncLog && syncLog.length > 0 && (
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-3 mb-4 max-h-36 overflow-y-auto">
          {syncLog.map((l, i) => (
            <p key={i} className={`text-xs font-mono ${l.startsWith('\u2713') ? 'text-green-400' : l.startsWith('\u2717') ? 'text-red-400' : 'text-gray-400'}`}>{l}</p>
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
        <Link href="/vi/outstanding"
          className="bg-gray-800 border border-gray-700 rounded-xl p-4 flex items-center gap-3 hover:bg-gray-700 transition group">
          <span className="text-2xl">👥</span>
          <div>
            <p className="text-sm font-semibold text-white group-hover:text-indigo-300 transition">Parties</p>
            <p className="text-[10px] text-gray-400">Outstanding ledger</p>
          </div>
        </Link>
        <Link href="/vi/sales"
          className="bg-gray-800 border border-gray-700 rounded-xl p-4 flex items-center gap-3 hover:bg-gray-700 transition group">
          <span className="text-2xl">📦</span>
          <div>
            <p className="text-sm font-semibold text-white group-hover:text-indigo-300 transition">Sales</p>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xl">🤝</span>
                <span className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Receivable</span>
              </div>
              <p className="text-xl font-bold text-green-400">{formatINR(data.totalReceivable)}</p>
              <Link href="/vi/outstanding" className="text-[10px] text-indigo-400 hover:text-indigo-300 mt-0.5 block">
                View bills →
              </Link>
            </div>

            <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xl">💸</span>
                <span className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Payable</span>
              </div>
              <p className="text-xl font-bold text-rose-400">{formatINR(data.totalPayable)}</p>
              <Link href="/vi/outstanding" className="text-[10px] text-indigo-400 hover:text-indigo-300 mt-0.5 block">
                View bills →
              </Link>
            </div>

            <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xl">📈</span>
                <span className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Total Sales</span>
              </div>
              <p className="text-xl font-bold text-indigo-400">{formatINR(data.totalSalesAmount)}</p>
              <p className="text-[10px] text-gray-500">{data.totalSalesCount} vouchers</p>
            </div>

            <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xl">📒</span>
                <span className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Ledgers Synced</span>
              </div>
              <p className="text-xl font-bold text-gray-200">{data.ledgerCount}</p>
              <Link href="/vi/ledgers" className="text-[10px] text-indigo-400 hover:text-indigo-300 mt-0.5 block">
                View master →
              </Link>
            </div>
          </div>

          {/* Firm Breakdown */}
          {Object.keys(data.firmBreakdown).length > 0 && (
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 mb-4">
              <h2 className="text-sm font-semibold text-white mb-3">Outstanding by Firm</h2>
              <div className="space-y-2">
                {Object.entries(data.firmBreakdown).map(([code, fb]) => {
                  const fc = FIRM_COLORS[code] || { bg: 'bg-gray-700 border-gray-600', text: 'text-gray-300' }
                  return (
                    <div key={code} className={`flex items-center justify-between border rounded-lg px-3 py-2.5 ${fc.bg}`}>
                      <div className="flex items-center gap-2.5">
                        <span className={`text-xs font-bold ${fc.text}`}>{code}</span>
                        <span className="text-xs text-gray-400">{FIRM_NAMES[code]}</span>
                      </div>
                      <div className="flex gap-4 text-xs">
                        {fb.receivable > 0 && <span className="text-green-400 font-medium">{formatINR(fb.receivable)} Dr</span>}
                        {fb.payable > 0 && <span className="text-rose-400 font-medium">{formatINR(fb.payable)} Cr</span>}
                        <span className="text-gray-500">{fb.billCount} bills</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

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
                <h2 className="text-sm font-semibold text-white">Top Overdue Receivables</h2>
                <Link href="/vi/outstanding" className="text-xs text-indigo-400 hover:text-indigo-300">View all →</Link>
              </div>
              <div className="space-y-2">
                {data.topOverdue.map((p, i) => {
                  const fc = FIRM_COLORS[p.firmCode] || { bg: '', text: 'text-gray-300' }
                  return (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Link href={`/vi/party/${encodeURIComponent(p.partyName)}`} className="font-medium text-gray-200 truncate hover:text-indigo-400 transition">{p.partyName}</Link>
                          <span className={`text-[10px] font-bold ${fc.text}`}>{p.firmCode}</span>
                        </div>
                        <p className="text-[10px] text-red-400">{p.overdueDays} days overdue</p>
                      </div>
                      <p className="font-semibold text-rose-400 shrink-0 ml-3">{formatINR(p.closingBalance)}</p>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Recent Sales */}
          {data.recentSales.length > 0 && (
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-white">Recent Sales</h2>
                <Link href="/vi/sales" className="text-xs text-indigo-400 hover:text-indigo-300">View all →</Link>
              </div>
              <div className="space-y-0 divide-y divide-gray-700">
                {data.recentSales.map((tx, i) => {
                  const cfg = VCH_CONFIG[tx.vchType]
                  const fc = FIRM_COLORS[tx.firmCode] || { text: 'text-gray-300' }
                  return (
                    <div key={i} className="py-2 flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs">{cfg?.icon || '📋'}</span>
                          <p className="text-xs font-medium text-gray-200 truncate">{tx.partyName || tx.narration || '\u2014'}</p>
                          <span className={`text-[10px] font-bold ${fc.text}`}>{tx.firmCode}</span>
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
