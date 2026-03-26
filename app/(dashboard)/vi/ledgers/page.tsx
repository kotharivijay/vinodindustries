'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'

interface Ledger {
  id: number
  firmCode: string
  name: string
  parent: string | null
  address: string | null
  gstNo: string | null
  panNo: string | null
  mobileNos: string | null
  state: string | null
  lastSynced: string | null
}

const FIRM_TABS = ['ALL', 'VI', 'VCF', 'VF'] as const

const FIRM_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  VI:  { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200' },
  VCF: { bg: 'bg-teal-100', text: 'text-teal-700', border: 'border-teal-200' },
  VF:  { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-200' },
}

const FIRM_NAMES: Record<string, string> = {
  VI: 'Vinod Industries',
  VCF: 'Vimal Cotton Fabrics',
  VF: 'Vijay Fabrics',
}

type SortMode = 'name-asc' | 'name-desc'

export default function LedgerMasterPage() {
  const router = useRouter()
  const [ledgers, setLedgers] = useState<Ledger[]>([])
  const [parentGroups, setParentGroups] = useState<string[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  const [firm, setFirm] = useState<string>('')
  const [search, setSearch] = useState('')
  const [parentFilter, setParentFilter] = useState('')
  const [sort, setSort] = useState<SortMode>('name-asc')
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)
  const [connected, setConnected] = useState<boolean | null>(null)

  // Check Tally connection on mount
  useEffect(() => {
    fetch('/api/tally/config')
      .then(r => r.json())
      .then(d => setConnected(d.connected))
      .catch(() => setConnected(false))
  }, [])

  // Load ledgers when filters change
  useEffect(() => {
    loadLedgers()
  }, [firm, search, parentFilter])

  async function loadLedgers() {
    setLoading(true)
    const params = new URLSearchParams()
    if (firm) params.set('firm', firm)
    if (search) params.set('search', search)
    if (parentFilter) params.set('parent', parentFilter)
    try {
      const res = await fetch(`/api/tally/ledgers?${params}`)
      const data = await res.json()
      setLedgers(data.ledgers || [])
      setParentGroups(data.parentGroups || [])
      setTotal(data.total || 0)
    } catch {
      setLedgers([])
    }
    setLoading(false)
  }

  async function handleSync() {
    setSyncing(true)
    setSyncResult(null)
    try {
      const res = await fetch('/api/tally/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firmCode: firm || 'ALL' }),
      })
      const data = await res.json()
      if (data.results) {
        const summary = data.results
          .map((r: any) => r.errors === -1 ? `${r.firm}: connection failed` : `${r.firm}: ${r.synced} synced`)
          .join(', ')
        setSyncResult(summary)
        loadLedgers()
      } else {
        setSyncResult('Sync failed')
      }
    } catch {
      setSyncResult('Network error')
    }
    setSyncing(false)
  }

  const sorted = useMemo(() => {
    const arr = [...ledgers]
    if (sort === 'name-desc') arr.sort((a, b) => b.name.localeCompare(a.name))
    else arr.sort((a, b) => a.name.localeCompare(b.name))
    return arr
  }, [ledgers, sort])

  const fmt = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })

  return (
    <div className="p-4 md:p-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-1">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600 transition">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-800">Ledger Master</h1>
          <p className="text-sm text-gray-500 mt-0.5">Tally Prime ledgers across all firms</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Connection dot */}
          <span className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className={`w-2 h-2 rounded-full ${connected === true ? 'bg-green-500' : connected === false ? 'bg-red-500' : 'bg-gray-300'}`} />
            {connected === true ? 'Connected' : connected === false ? 'Offline' : '...'}
          </span>
        </div>
      </div>

      {/* Firm Tabs */}
      <div className="flex gap-1.5 mt-4 mb-3 overflow-x-auto pb-1">
        {FIRM_TABS.map(tab => {
          const active = tab === 'ALL' ? firm === '' : firm === tab
          return (
            <button
              key={tab}
              onClick={() => { setFirm(tab === 'ALL' ? '' : tab); setParentFilter('') }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition ${
                active
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {tab === 'ALL' ? 'All Firms' : tab}
            </button>
          )
        })}
      </div>

      {/* Search + Filters Row */}
      <div className="flex flex-wrap gap-2 mb-3">
        <input
          type="text"
          className="flex-1 min-w-[200px] border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          placeholder="Search name, GST, PAN, mobile, address..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 max-w-[200px]"
          value={parentFilter}
          onChange={e => setParentFilter(e.target.value)}
        >
          <option value="">All Groups</option>
          {parentGroups.map(p => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <select
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          value={sort}
          onChange={e => setSort(e.target.value as SortMode)}
        >
          <option value="name-asc">Name A-Z</option>
          <option value="name-desc">Name Z-A</option>
        </select>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap"
        >
          {syncing ? 'Syncing...' : 'Sync from Tally'}
        </button>
      </div>

      {/* Sync Result */}
      {syncResult && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 text-sm text-blue-800 mb-3 flex items-center justify-between">
          <span>{syncResult}</span>
          <button onClick={() => setSyncResult(null)} className="text-blue-400 hover:text-blue-600 ml-2">&times;</button>
        </div>
      )}

      {/* Count */}
      <p className="text-xs text-gray-400 mb-3">
        Showing {sorted.length} of {total} ledgers
        {firm && ` in ${FIRM_NAMES[firm] || firm}`}
      </p>

      {/* Ledger Cards */}
      {loading ? (
        <div className="py-12 text-center text-gray-400">Loading ledgers...</div>
      ) : sorted.length === 0 ? (
        <div className="py-12 text-center text-gray-400">
          {search || parentFilter ? 'No ledgers match your filters.' : 'No ledgers synced yet. Click "Sync from Tally" to import.'}
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map(ledger => {
            const fc = FIRM_COLORS[ledger.firmCode] || { bg: 'bg-gray-100', text: 'text-gray-600', border: 'border-gray-200' }
            const expanded = expandedId === ledger.id
            return (
              <div
                key={ledger.id}
                className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden"
              >
                {/* Card Header - always visible */}
                <button
                  onClick={() => setExpandedId(expanded ? null : ledger.id)}
                  className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-gray-50 transition"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-800 text-sm">{ledger.name}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${fc.bg} ${fc.text} ${fc.border} border`}>
                        {ledger.firmCode}
                      </span>
                    </div>
                    {ledger.parent && (
                      <p className="text-xs text-gray-400 mt-0.5">{ledger.parent}</p>
                    )}
                    {/* Compact info on collapsed view */}
                    {!expanded && (ledger.gstNo || ledger.mobileNos) && (
                      <div className="flex flex-wrap gap-x-3 mt-1">
                        {ledger.gstNo && <span className="text-xs text-gray-500">GST: {ledger.gstNo}</span>}
                        {ledger.mobileNos && <span className="text-xs text-gray-500">{ledger.mobileNos}</span>}
                      </div>
                    )}
                  </div>
                  <svg className={`w-4 h-4 text-gray-400 flex-shrink-0 mt-1 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* Expanded Details */}
                {expanded && (
                  <div className="px-4 pb-4 border-t border-gray-100 pt-3 space-y-2">
                    {ledger.address && (
                      <div>
                        <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">Address</p>
                        <p className="text-sm text-gray-700">{ledger.address}</p>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      {ledger.gstNo && (
                        <div>
                          <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">GST No</p>
                          <p className="text-sm text-gray-700 font-mono">{ledger.gstNo}</p>
                        </div>
                      )}
                      {ledger.panNo && (
                        <div>
                          <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">PAN No</p>
                          <p className="text-sm text-gray-700 font-mono">{ledger.panNo}</p>
                        </div>
                      )}
                      {ledger.mobileNos && (
                        <div>
                          <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">Mobile</p>
                          <p className="text-sm text-gray-700">{ledger.mobileNos}</p>
                        </div>
                      )}
                      {ledger.state && (
                        <div>
                          <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">State</p>
                          <p className="text-sm text-gray-700">{ledger.state}</p>
                        </div>
                      )}
                    </div>
                    {ledger.lastSynced && (
                      <p className="text-[10px] text-gray-300 mt-2">
                        Last synced: {fmt(ledger.lastSynced)}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
