'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import useSWR from 'swr'
import Link from 'next/link'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const FIRMS = ['', 'VI', 'VCF', 'VF']
const FIRM_LABELS: Record<string, string> = { '': 'All Firms', VI: 'VI', VCF: 'VCF', VF: 'VF' }

interface SyncStep { firm: string; stage: string; message: string; total?: number; progress?: number }

function useDebounce(value: string, delay: number) {
  const [d, setD] = useState(value)
  useEffect(() => { const t = setTimeout(() => setD(value), delay); return () => clearTimeout(t) }, [value, delay])
  return d
}

export default function OrdersPage() {
  const [firm, setFirm] = useState('')
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const debouncedSearch = useDebounce(search, 350)

  const [syncing, setSyncing] = useState(false)
  const [syncSteps, setSyncSteps] = useState<SyncStep[]>([])
  const [showSync, setShowSync] = useState(false)
  const [overallProgress, setOverallProgress] = useState(0)

  const params = new URLSearchParams()
  if (firm) params.set('firm', firm)
  if (status) params.set('status', status)
  if (debouncedSearch) params.set('search', debouncedSearch)
  params.set('page', String(page))

  const { data, mutate, isLoading } = useSWR(`/api/tally/orders?${params}`, fetcher, { dedupingInterval: 30000, revalidateOnFocus: false })
  const orders = data?.orders || []
  const total = data?.total || 0
  const summary = data?.summary || {}
  const totalPages = Math.ceil(total / 50)

  // Auto-sync if no data
  const autoSynced = useRef(false)
  useEffect(() => {
    if (!isLoading && summary.total === 0 && !autoSynced.current) {
      autoSynced.current = true
      handleSync()
    }
  }, [isLoading, summary.total])

  const handleSync = useCallback(async () => {
    setSyncing(true)
    setShowSync(true)
    setOverallProgress(0)
    setSyncSteps([
      { firm: 'VI', stage: 'waiting', message: 'Waiting...' },
      { firm: 'VCF', stage: 'waiting', message: 'Waiting...' },
      { firm: 'VF', stage: 'waiting', message: 'Waiting...' },
    ])

    const es = new EventSource('/api/tally/orders-sync')
    es.onmessage = (e) => {
      const d = JSON.parse(e.data)
      if (d.type === 'progress') {
        setSyncSteps(prev => prev.map(s => s.firm === d.firm ? { ...s, ...d } : s))
        const done = ['done', 'error']
        setSyncSteps(prev => {
          const doneCount = prev.filter(s => done.includes(s.stage)).length
          setOverallProgress(Math.round((doneCount / 3) * 100))
          return prev
        })
      }
      if (d.type === 'complete') {
        setOverallProgress(100)
        setSyncing(false)
        mutate()
        es.close()
      }
    }
    es.onerror = () => { setSyncing(false); es.close() }
  }, [mutate])

  const fmtNum = (n: number) => n?.toLocaleString('en-IN') || '0'

  return (
    <div className="p-4 md:p-6 max-w-6xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-white">Sales Orders</h1>
          <p className="text-xs text-gray-400">From Google Sheets — VI, VCF, VF</p>
        </div>
        <button onClick={handleSync} disabled={syncing} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
          {syncing ? 'Syncing...' : '🔄 Sync Orders'}
        </button>
      </div>

      {/* Sync Modal */}
      {showSync && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="bg-gray-800 rounded-2xl shadow-xl w-full max-w-md p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-white">{syncing ? 'Syncing Orders...' : 'Sync Complete'}</h2>
              {!syncing && <button onClick={() => setShowSync(false)} className="text-gray-400 text-2xl">&times;</button>}
            </div>
            <div className="w-full bg-gray-700 rounded-full h-2 mb-4">
              <div className="bg-indigo-500 h-2 rounded-full transition-all" style={{ width: `${overallProgress}%` }} />
            </div>
            <div className="space-y-3">
              {syncSteps.map(s => (
                <div key={s.firm} className="flex gap-3">
                  <span className={`text-sm ${s.stage === 'done' ? 'text-green-400' : s.stage === 'error' ? 'text-red-400' : s.stage === 'waiting' ? 'text-gray-500' : 'text-indigo-400'}`}>
                    {s.stage === 'done' ? '✓' : s.stage === 'error' ? '✗' : s.stage === 'waiting' ? '○' : '⟳'}
                  </span>
                  <div>
                    <span className="text-xs font-bold text-white">{s.firm}</span>
                    <p className="text-xs text-gray-400">{s.message}</p>
                    {s.stage === 'saving' && s.total && (
                      <div className="w-32 bg-gray-700 rounded-full h-1 mt-1">
                        <div className="bg-indigo-400 h-1 rounded-full" style={{ width: `${((s.progress || 0) / s.total) * 100}%` }} />
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {!syncing && <button onClick={() => setShowSync(false)} className="mt-4 w-full bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium">Done</button>}
          </div>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        {[
          { label: 'Total', value: summary.total || 0, color: 'border-indigo-500', active: status === '', onClick: () => { setStatus(''); setPage(1) } },
          { label: 'Pending', value: summary.pending || 0, color: 'border-orange-500', active: status === 'Pending', onClick: () => { setStatus(status === 'Pending' ? '' : 'Pending'); setPage(1) } },
          { label: 'Closed', value: summary.closed || 0, color: 'border-green-500', active: status === 'Closed', onClick: () => { setStatus(status === 'Closed' ? '' : 'Closed'); setPage(1) } },
        ].map(k => (
          <button key={k.label} onClick={k.onClick} className={`bg-gray-800 rounded-xl p-3 text-center border-b-3 ${k.color} ${k.active ? 'ring-2 ring-indigo-400' : ''}`}>
            <div className="text-2xl font-bold text-white">{fmtNum(k.value)}</div>
            <div className="text-[10px] text-gray-400 uppercase font-semibold">{k.label}</div>
          </button>
        ))}
      </div>

      {/* Qty Strip */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-gray-800 rounded-lg p-2 text-center">
          <div className="text-sm font-bold text-indigo-400">{fmtNum(summary.totalQty || 0)}</div>
          <div className="text-[10px] text-gray-500 uppercase">Total Qty</div>
        </div>
        <div className="bg-gray-800 rounded-lg p-2 text-center">
          <div className="text-sm font-bold text-green-400">{fmtNum(summary.dispatchedQty || 0)}</div>
          <div className="text-[10px] text-gray-500 uppercase">Dispatched</div>
        </div>
        <div className="bg-gray-800 rounded-lg p-2 text-center">
          <div className="text-sm font-bold text-orange-400">{fmtNum(summary.pendingQty || 0)}</div>
          <div className="text-[10px] text-gray-500 uppercase">Pending Qty</div>
        </div>
      </div>

      {/* Firm Tabs */}
      <div className="flex gap-1.5 mb-3">
        {FIRMS.map(f => (
          <button key={f || 'all'} onClick={() => { setFirm(f); setPage(1) }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${firm === f ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
            {FIRM_LABELS[f]}
          </button>
        ))}
      </div>

      {/* Search */}
      <input type="text" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
        placeholder="Search party, order, item, agent..."
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm text-white mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-500" />

      {/* Count */}
      <p className="text-xs text-gray-500 mb-2">{total} orders</p>

      {/* Table */}
      {isLoading ? (
        <div className="py-12 text-center text-gray-500">Loading...</div>
      ) : orders.length === 0 ? (
        <div className="py-12 text-center text-gray-500">No orders found</div>
      ) : (
        <div className="space-y-2">
          {orders.map((o: any) => (
            <div key={o.id} className="bg-gray-800 rounded-xl p-3 border border-gray-700">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-white text-sm">{o.partyName}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${o.status === 'Pending' ? 'bg-orange-900/50 text-orange-400' : 'bg-green-900/50 text-green-400'}`}>
                      {o.status}
                    </span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-900/50 text-indigo-400">{o.firmCode}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 mt-1 text-xs text-gray-400">
                    <span>#{o.orderNo}</span>
                    <span>{o.date}</span>
                    <span>{o.itemName}</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-bold text-white">{fmtNum(o.orderQty)} mtr</div>
                  <div className="text-xs text-gray-500">Bal: {fmtNum(o.balance)}</div>
                </div>
              </div>
              {o.agentName && <div className="text-[10px] text-gray-500 mt-1">{o.agentName}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 bg-gray-800 text-gray-400 rounded text-sm disabled:opacity-30">‹</button>
          <span className="text-xs text-gray-500">Page {page} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-1 bg-gray-800 text-gray-400 rounded text-sm disabled:opacity-30">›</button>
        </div>
      )}
    </div>
  )
}
