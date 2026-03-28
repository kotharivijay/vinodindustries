'use client'

import Link from 'next/link'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => { if (!r.ok) throw new Error('Failed'); return r.json() })

const FIRM_COLORS: Record<string, { bg: string; text: string }> = {
  VI:  { bg: 'bg-blue-900/30', text: 'text-blue-400' },
  VCF: { bg: 'bg-teal-900/30', text: 'text-teal-400' },
  VF:  { bg: 'bg-orange-900/30', text: 'text-orange-400' },
}

function formatINR(n: number) {
  return n.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 })
}
function fmtDate(d: string | null) {
  if (!d) return '\u2014'
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
}

function scoreColor(score: number) {
  if (score >= 75) return 'text-green-400'
  if (score >= 50) return 'text-amber-400'
  return 'text-red-400'
}

function scoreBg(score: number) {
  if (score >= 75) return 'bg-green-500'
  if (score >= 50) return 'bg-amber-500'
  return 'bg-red-500'
}

interface PerfData {
  salesTotalAmount: number
  salesCount: number
  avgBillValue: number
  outstandingTotal: number
  overdueAmount: number
  aging: { '0-30': number; '31-60': number; '61-90': number; '90+': number }
  monthlySales: { month: string; amount: number }[]
  topItems: { name: string; totalAmount: number; count: number }[]
  receipts: { date: string; vchNumber: string; amount: number; vchType: string; narration: string | null; firmCode: string }[]
  score: number
  scoreBreakdown: { overdueScore: number; paymentScore: number; volumeScore: number; consistencyScore: number }
}

export default function PerformanceView({ name }: { name: string }) {
  const { data, error, isLoading } = useSWR<PerfData>(
    `/api/tally/party-performance?name=${encodeURIComponent(name)}`,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30_000 }
  )

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 max-w-4xl">
        <div className="space-y-3 animate-pulse">
          <div className="h-10 bg-gray-800 rounded-xl w-1/2" />
          <div className="h-32 bg-gray-800 rounded-xl" />
          <div className="h-48 bg-gray-800 rounded-xl" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 md:p-6 max-w-4xl">
        <div className="bg-red-900/30 border border-red-700 rounded-xl px-4 py-3 text-sm text-red-300">
          Failed to load performance data: {error.message}
        </div>
      </div>
    )
  }

  if (!data) return null

  const maxMonthly = Math.max(...data.monthlySales.map(m => m.amount), 1)
  const agingEntries = Object.entries(data.aging).filter(([, v]) => v > 0)

  return (
    <div className="p-4 md:p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Link href={`/vi/party/${encodeURIComponent(name)}`} className="text-gray-400 hover:text-gray-200 transition">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-white truncate">{name}</h1>
          <p className="text-xs text-gray-400">Party Performance Analysis</p>
        </div>
      </div>

      {/* Score Card */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-5 mb-4">
        <div className="flex items-center gap-6">
          <div className="text-center">
            <p className={`text-4xl font-bold ${scoreColor(data.score)}`}>{data.score}</p>
            <p className="text-[10px] text-gray-400 uppercase font-semibold mt-1">Score / 100</p>
          </div>
          <div className="flex-1">
            <div className="w-full bg-gray-700 rounded-full h-3 mb-3">
              <div className={`h-3 rounded-full transition-all ${scoreBg(data.score)}`} style={{ width: `${data.score}%` }} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div>
                <p className="text-gray-500">Overdue</p>
                <p className="font-semibold text-gray-200">{data.scoreBreakdown.overdueScore}/30</p>
              </div>
              <div>
                <p className="text-gray-500">Payment</p>
                <p className="font-semibold text-gray-200">{data.scoreBreakdown.paymentScore}/30</p>
              </div>
              <div>
                <p className="text-gray-500">Volume</p>
                <p className="font-semibold text-gray-200">{data.scoreBreakdown.volumeScore}/20</p>
              </div>
              <div>
                <p className="text-gray-500">Consistency</p>
                <p className="font-semibold text-gray-200">{data.scoreBreakdown.consistencyScore}/20</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-3">
          <p className="text-[10px] text-gray-400 uppercase font-semibold">Total Sales</p>
          <p className="text-lg font-bold text-indigo-400">{formatINR(data.salesTotalAmount)}</p>
          <p className="text-[10px] text-gray-500">{data.salesCount} vouchers</p>
        </div>
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-3">
          <p className="text-[10px] text-gray-400 uppercase font-semibold">Avg Bill Value</p>
          <p className="text-lg font-bold text-gray-200">{formatINR(data.avgBillValue)}</p>
        </div>
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-3">
          <p className="text-[10px] text-gray-400 uppercase font-semibold">Outstanding</p>
          <p className="text-lg font-bold text-amber-400">{formatINR(data.outstandingTotal)}</p>
        </div>
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-3">
          <p className="text-[10px] text-gray-400 uppercase font-semibold">Overdue</p>
          <p className={`text-lg font-bold ${data.overdueAmount > 0 ? 'text-red-400' : 'text-green-400'}`}>{formatINR(data.overdueAmount)}</p>
        </div>
      </div>

      {/* Aging Analysis */}
      {agingEntries.length > 0 && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 mb-4">
          <h2 className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide mb-3">Outstanding Aging</h2>
          <div className="grid grid-cols-4 gap-2">
            {(['0-30', '31-60', '61-90', '90+'] as const).map(bucket => {
              const val = data.aging[bucket]
              const colors: Record<string, string> = {
                '0-30': 'text-green-400 border-green-800 bg-green-900/20',
                '31-60': 'text-amber-400 border-amber-800 bg-amber-900/20',
                '61-90': 'text-orange-400 border-orange-800 bg-orange-900/20',
                '90+': 'text-red-400 border-red-800 bg-red-900/20',
              }
              return (
                <div key={bucket} className={`rounded-lg p-3 border text-center ${colors[bucket]}`}>
                  <p className="text-[10px] font-semibold uppercase">{bucket} days</p>
                  <p className="text-sm font-bold mt-1">{formatINR(val)}</p>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Monthly Sales Trend */}
      {data.monthlySales.length > 0 && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 mb-4">
          <h2 className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide mb-3">Monthly Sales Trend</h2>
          <div className="space-y-1.5">
            {data.monthlySales.map(m => (
              <div key={m.month} className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-16 shrink-0">{m.month}</span>
                <div className="flex-1 bg-gray-700 rounded-full h-5 overflow-hidden">
                  <div className="bg-indigo-500 h-full rounded-full transition-all" style={{ width: `${(m.amount / maxMonthly) * 100}%` }} />
                </div>
                <span className="text-xs text-gray-300 font-medium w-24 text-right">{formatINR(m.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top Items */}
      {data.topItems.length > 0 && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 mb-4">
          <h2 className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide mb-3">Top Items Bought</h2>
          <div className="space-y-2">
            {data.topItems.map((item, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="text-gray-500 font-mono w-5">{i + 1}.</span>
                  <span className="text-gray-200 truncate">{item.name}</span>
                  <span className="text-gray-500 shrink-0">{item.count} entries</span>
                </div>
                <span className="font-semibold text-indigo-400 shrink-0 ml-3">{formatINR(item.totalAmount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Payment History */}
      {data.receipts.length > 0 && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
          <h2 className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide mb-3">Payment History</h2>
          <div className="space-y-0 divide-y divide-gray-700">
            {data.receipts.map((r, i) => {
              const fc = FIRM_COLORS[r.firmCode] || { bg: 'bg-gray-700', text: 'text-gray-300' }
              const isReceipt = r.vchType === 'Receipt'
              return (
                <div key={i} className="py-2 flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className={`px-1 py-0.5 rounded text-[10px] font-bold ${fc.bg} ${fc.text}`}>{r.firmCode}</span>
                      <span className={`text-xs font-semibold ${isReceipt ? 'text-emerald-400' : 'text-rose-400'}`}>{r.vchType}</span>
                      <span className="text-[10px] text-gray-500">#{r.vchNumber}</span>
                    </div>
                    <p className="text-[10px] text-gray-500">{fmtDate(r.date)}{r.narration ? ` · ${r.narration}` : ''}</p>
                  </div>
                  <p className={`text-xs font-bold shrink-0 ${isReceipt ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {formatINR(r.amount)}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {data.receipts.length === 0 && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
          <h2 className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide mb-2">Payment History</h2>
          <p className="text-xs text-gray-500 text-center py-4">No receipt/payment data. Sync receipts from the Tally Dashboard to see payment history.</p>
        </div>
      )}
    </div>
  )
}
