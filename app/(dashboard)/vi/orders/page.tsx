'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import useSWR from 'swr'

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
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const debouncedSearch = useDebounce(search, 350)

  // Party & Agent filter
  const [partyFilter, setPartyFilter] = useState('')
  const [agentFilter, setAgentFilter] = useState('')
  const [partySearch, setPartySearch] = useState('')
  const [agentSearch, setAgentSearch] = useState('')
  const [showPartyDD, setShowPartyDD] = useState(false)
  const [showAgentDD, setShowAgentDD] = useState(false)

  // OS Panels
  const [osParty, setOsParty] = useState<string | null>(null)
  const [osAgent, setOsAgent] = useState<string | null>(null)
  const [osData, setOsData] = useState<any>(null)
  const [osLoading, setOsLoading] = useState(false)
  const [agentOsData, setAgentOsData] = useState<any>(null)
  const [agentOsLoading, setAgentOsLoading] = useState(false)
  const [osTab, setOsTab] = useState<'bills' | 'bank'>('bills')
  const [agentView, setAgentView] = useState<'party' | 'bill'>('party')
  const [agentBillSort, setAgentBillSort] = useState({ date: 'oldest', party: 'none' })
  const [expandedAgentParty, setExpandedAgentParty] = useState<number | null>(null)
  const [checkedBills, setCheckedBills] = useState<Set<number>>(new Set())
  const [checkAllBills, setCheckAllBills] = useState(true)

  // Sync
  const [syncing, setSyncing] = useState(false)
  const [syncSteps, setSyncSteps] = useState<SyncStep[]>([])
  const [showSync, setShowSync] = useState(false)
  const [overallProgress, setOverallProgress] = useState(0)

  const params = new URLSearchParams()
  if (firm) params.set('firm', firm)
  if (status) params.set('status', status)
  if (debouncedSearch) params.set('search', debouncedSearch)
  if (partyFilter) params.set('party', partyFilter)
  if (agentFilter) params.set('agent', agentFilter)
  params.set('page', String(page))

  const { data, mutate, isLoading } = useSWR(`/api/tally/orders?${params}`, fetcher, { dedupingInterval: 30000, revalidateOnFocus: false })
  const orders = data?.orders || []
  const total = data?.total || 0
  const summary = data?.summary || {}
  const dropdowns = data?.dropdowns || {}
  const totalPages = Math.ceil(total / 50)

  const filteredParties = (dropdowns.parties || []).filter((p: string) => !partySearch || p.toLowerCase().includes(partySearch.toLowerCase()))
  const filteredAgents = (dropdowns.agents || []).filter((a: string) => !agentSearch || a.toLowerCase().includes(agentSearch.toLowerCase()))

  // Auto-sync
  const autoSynced = useRef(false)
  useEffect(() => {
    if (!isLoading && summary.total === 0 && !autoSynced.current) { autoSynced.current = true; handleSync() }
  }, [isLoading, summary.total])

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = () => { setShowPartyDD(false); setShowAgentDD(false) }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [])

  const handleSync = useCallback(async () => {
    setSyncing(true); setShowSync(true); setOverallProgress(0)
    setSyncSteps([{ firm: 'VI', stage: 'waiting', message: 'Waiting...' }, { firm: 'VCF', stage: 'waiting', message: 'Waiting...' }, { firm: 'VF', stage: 'waiting', message: 'Waiting...' }])
    const es = new EventSource('/api/tally/orders-sync')
    es.onmessage = (e) => {
      const d = JSON.parse(e.data)
      if (d.type === 'progress') {
        setSyncSteps(prev => { const next = prev.map(s => s.firm === d.firm ? { ...s, ...d } : s); setOverallProgress(Math.round((next.filter(s => ['done', 'error'].includes(s.stage)).length / 3) * 100)); return next })
      }
      if (d.type === 'complete') { setOverallProgress(100); setSyncing(false); mutate(); es.close() }
    }
    es.onerror = () => { setSyncing(false); es.close() }
  }, [mutate])

  // Party OS
  async function loadPartyOS(party: string) {
    if (osParty === party) { setOsParty(null); return }
    setOsParty(party); setOsAgent(null); setOsLoading(true); setOsTab('bills')
    const res = await fetch(`/api/tally/outstanding?party=${encodeURIComponent(party)}&limit=200`)
    const d = await res.json()
    // Also load bank payments
    const bankRes = await fetch(`/api/tally/outstanding?party=${encodeURIComponent(party)}&type=bank`)
    setOsData({ bills: d.bills || [], total: d.totalAmount || 0, count: d.total || 0 })
    setOsLoading(false)
    // Init checkboxes
    const ids = new Set<number>((d.bills || []).map((_: any, i: number) => i))
    setCheckedBills(ids); setCheckAllBills(true)
  }

  // Agent OS
  async function loadAgentOS(agent: string) {
    if (osAgent === agent) { setOsAgent(null); return }
    setOsAgent(agent); setOsParty(null); setAgentOsLoading(true); setAgentView('party')
    const res = await fetch(`/api/tally/outstanding?agent=${encodeURIComponent(agent)}&limit=500`)
    const d = await res.json()
    // Group bills by party
    const partyMap: Record<string, { bills: any[]; total: number }> = {}
    for (const b of (d.bills || [])) {
      const key = b.partyName || 'Unknown'
      if (!partyMap[key]) partyMap[key] = { bills: [], total: 0 }
      partyMap[key].bills.push(b)
      partyMap[key].total += Math.abs(b.closingBalance || 0)
    }
    const parties = Object.entries(partyMap).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.total - a.total)
    setAgentOsData({ parties, grandTotal: d.totalAmount || 0, totalBills: d.total || 0 })
    setAgentOsLoading(false)
  }

  // WA share
  function shareOsWhatsApp() {
    if (!osData?.bills?.length || !osParty) return
    const selected = osData.bills.filter((_: any, i: number) => checkedBills.has(i))
    if (!selected.length) return
    const total = selected.reduce((s: number, b: any) => s + Math.abs(b.closingBalance || 0), 0)
    const today = new Date().toLocaleDateString('en-IN')
    const lines = selected.map((b: any) => `  • ${b.billRef || '-'} | ${b.billDate ? new Date(b.billDate).toLocaleDateString('en-IN') : '-'} | ₹${Math.abs(b.closingBalance || 0).toLocaleString('en-IN')} | ${b.overdueDays || 0}d`)
    const msg = `📋 *Outstanding Bills*\n*${osParty}*\nAs on: ${today}\n${'─'.repeat(20)}\n${lines.join('\n')}\n${'─'.repeat(20)}\n*Total: ₹${total.toLocaleString('en-IN')}*\n\n_Please arrange payment at earliest._`
    window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank')
  }

  function shareAgentWhatsApp() {
    if (!agentOsData?.parties?.length || !osAgent) return
    const today = new Date().toLocaleDateString('en-IN')
    const lines = agentOsData.parties.map((p: any, i: number) => `${i + 1}. *${p.name}* — ₹${Math.round(p.total).toLocaleString('en-IN')}`)
    const msg = `📊 *Agent Outstanding Summary*\n*Agent: ${osAgent}*\nAs on: ${today}\n${'─'.repeat(25)}\n${lines.join('\n')}\n${'─'.repeat(25)}\n*Grand Total: ₹${Math.round(agentOsData.grandTotal).toLocaleString('en-IN')}*\n\n_Kindly follow up for collection._`
    window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank')
  }

  const fmtNum = (n: number) => n?.toLocaleString('en-IN') || '0'
  const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : ''
  const ageBadge = (days: number) => {
    const cls = days >= 90 ? 'bg-red-900/50 text-red-400' : days >= 45 ? 'bg-orange-900/50 text-orange-400' : days >= 15 ? 'bg-yellow-900/50 text-yellow-400' : 'bg-green-900/50 text-green-400'
    return <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${cls}`}>{days}d</span>
  }

  // Sort agent bills
  const sortedAgentBills = (bills: any[]) => {
    const sorted = [...bills]
    if (agentBillSort.party === 'az') sorted.sort((a, b) => (a.partyName || '').localeCompare(b.partyName || ''))
    else if (agentBillSort.party === 'za') sorted.sort((a, b) => (b.partyName || '').localeCompare(a.partyName || ''))
    else if (agentBillSort.date === 'newest') sorted.sort((a, b) => (a.overdueDays || 0) - (b.overdueDays || 0))
    else sorted.sort((a, b) => (b.overdueDays || 0) - (a.overdueDays || 0))
    return sorted
  }

  const allAgentBills = agentOsData?.parties?.flatMap((p: any) => p.bills.map((b: any) => ({ ...b, partyName: p.name }))) || []

  return (
    <div className="p-4 md:p-6 max-w-6xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-white">Sales Orders</h1>
          <p className="text-xs text-gray-400">From Google Sheets — VI, VCF, VF</p>
        </div>
        <button onClick={handleSync} disabled={syncing} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
          {syncing ? 'Syncing...' : '🔄 Sync'}
        </button>
      </div>

      {/* Sync Modal */}
      {showSync && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="bg-gray-800 rounded-2xl shadow-xl w-full max-w-md p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-white">{syncing ? 'Syncing...' : 'Sync Complete'}</h2>
              {!syncing && <button onClick={() => setShowSync(false)} className="text-gray-400 text-2xl">&times;</button>}
            </div>
            <div className="w-full bg-gray-700 rounded-full h-2 mb-4">
              <div className="bg-indigo-500 h-2 rounded-full transition-all" style={{ width: `${overallProgress}%` }} />
            </div>
            {syncSteps.map(s => (
              <div key={s.firm} className="flex gap-2 mb-1">
                <span className={s.stage === 'done' ? 'text-green-400' : s.stage === 'error' ? 'text-red-400' : 'text-gray-500'}>
                  {s.stage === 'done' ? '✓' : s.stage === 'error' ? '✗' : '⟳'}
                </span>
                <span className="text-xs text-white font-bold">{s.firm}</span>
                <span className="text-xs text-gray-400">{s.message}</span>
              </div>
            ))}
            {!syncing && <button onClick={() => setShowSync(false)} className="mt-3 w-full bg-indigo-600 text-white py-2 rounded-lg text-sm">Done</button>}
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
          <button key={k.label} onClick={k.onClick} className={`bg-gray-800 rounded-xl p-3 text-center border-b-2 ${k.color} ${k.active ? 'ring-2 ring-indigo-400' : ''}`}>
            <div className="text-2xl font-bold text-white">{fmtNum(k.value)}</div>
            <div className="text-[10px] text-gray-400 uppercase font-semibold">{k.label}</div>
          </button>
        ))}
      </div>

      {/* Qty Strip */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-gray-800 rounded-lg p-2 text-center"><div className="text-sm font-bold text-indigo-400">{fmtNum(summary.totalQty || 0)}</div><div className="text-[10px] text-gray-500 uppercase">Total Qty</div></div>
        <div className="bg-gray-800 rounded-lg p-2 text-center"><div className="text-sm font-bold text-green-400">{fmtNum(summary.dispatchedQty || 0)}</div><div className="text-[10px] text-gray-500 uppercase">Dispatched</div></div>
        <div className="bg-gray-800 rounded-lg p-2 text-center"><div className="text-sm font-bold text-orange-400">{fmtNum(summary.pendingQty || 0)}</div><div className="text-[10px] text-gray-500 uppercase">Pending Qty</div></div>
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

      {/* Party + OS Button | Agent + OS Button */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-3">
        {/* Party Dropdown + OS */}
        <div className="flex gap-2">
          <div className="flex-1 relative" onClick={e => e.stopPropagation()}>
            <button onClick={() => { setShowPartyDD(!showPartyDD); setShowAgentDD(false) }}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm border ${partyFilter ? 'bg-indigo-900/30 border-indigo-500 text-indigo-300 font-semibold' : 'bg-gray-800 border-gray-700 text-gray-400'}`}>
              {partyFilter || 'All Parties'}
              {partyFilter && <span className="float-right text-gray-500 cursor-pointer" onClick={e => { e.stopPropagation(); setPartyFilter(''); setPage(1); setOsParty(null) }}>✕</span>}
            </button>
            {showPartyDD && (
              <div className="absolute top-full left-0 right-0 z-40 bg-gray-800 border border-gray-700 rounded-lg mt-1 shadow-xl overflow-hidden">
                <div className="p-2 border-b border-gray-700">
                  <input type="text" value={partySearch} onChange={e => setPartySearch(e.target.value)} placeholder="Search party..."
                    className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-xs text-white focus:outline-none" autoFocus />
                </div>
                <ul className="max-h-48 overflow-y-auto">
                  <li onClick={() => { setPartyFilter(''); setShowPartyDD(false); setPage(1); setOsParty(null) }}
                    className="px-3 py-2 text-xs text-gray-400 hover:bg-gray-700 cursor-pointer font-semibold border-b border-gray-700">All Parties</li>
                  {filteredParties.slice(0, 100).map((p: string) => (
                    <li key={p} onClick={() => { setPartyFilter(p); setShowPartyDD(false); setPage(1) }}
                      className={`px-3 py-2 text-xs cursor-pointer hover:bg-gray-700 ${partyFilter === p ? 'bg-indigo-900/50 text-indigo-300' : 'text-gray-300'}`}>
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <button onClick={() => partyFilter && loadPartyOS(partyFilter)}
            className={`px-3 py-2 rounded-lg text-sm font-bold border whitespace-nowrap ${partyFilter ? 'bg-orange-700 border-orange-600 text-white cursor-pointer hover:bg-orange-800' : 'bg-gray-800 border-gray-700 text-gray-600 cursor-not-allowed'}`}>
            ₹ OS
          </button>
        </div>

        {/* Agent Dropdown + OS */}
        <div className="flex gap-2">
          <div className="flex-1 relative" onClick={e => e.stopPropagation()}>
            <button onClick={() => { setShowAgentDD(!showAgentDD); setShowPartyDD(false) }}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm border ${agentFilter ? 'bg-blue-900/30 border-blue-500 text-blue-300 font-semibold' : 'bg-gray-800 border-gray-700 text-gray-400'}`}>
              {agentFilter || 'All Agents'}
              {agentFilter && <span className="float-right text-gray-500 cursor-pointer" onClick={e => { e.stopPropagation(); setAgentFilter(''); setPage(1); setOsAgent(null) }}>✕</span>}
            </button>
            {showAgentDD && (
              <div className="absolute top-full left-0 right-0 z-40 bg-gray-800 border border-gray-700 rounded-lg mt-1 shadow-xl overflow-hidden">
                <div className="p-2 border-b border-gray-700">
                  <input type="text" value={agentSearch} onChange={e => setAgentSearch(e.target.value)} placeholder="Search agent..."
                    className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-xs text-white focus:outline-none" autoFocus />
                </div>
                <ul className="max-h-48 overflow-y-auto">
                  <li onClick={() => { setAgentFilter(''); setShowAgentDD(false); setPage(1); setOsAgent(null) }}
                    className="px-3 py-2 text-xs text-gray-400 hover:bg-gray-700 cursor-pointer font-semibold border-b border-gray-700">All Agents</li>
                  {filteredAgents.slice(0, 100).map((a: string) => (
                    <li key={a} onClick={() => { setAgentFilter(a); setShowAgentDD(false); setPage(1) }}
                      className={`px-3 py-2 text-xs cursor-pointer hover:bg-gray-700 ${agentFilter === a ? 'bg-blue-900/50 text-blue-300' : 'text-gray-300'}`}>
                      {a}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <button onClick={() => agentFilter && loadAgentOS(agentFilter)}
            className={`px-3 py-2 rounded-lg text-sm font-bold border whitespace-nowrap ${agentFilter ? 'bg-indigo-600 border-indigo-500 text-white cursor-pointer hover:bg-indigo-700' : 'bg-gray-800 border-gray-700 text-gray-600 cursor-not-allowed'}`}>
            📊 OS
          </button>
        </div>
      </div>

      {/* ── Party OS Panel (inline) ── */}
      {osParty && (
        <div className="bg-gray-800 rounded-xl border-t-3 border-orange-500 border border-gray-700 mb-4 overflow-hidden animate-in slide-in-from-top">
          <div className="flex items-center justify-between px-4 py-3 bg-orange-900/20 border-b border-gray-700">
            <span className="text-sm font-bold text-orange-400">₹ {osParty} — Outstanding</span>
            <button onClick={() => setOsParty(null)} className="text-gray-400 hover:text-white">&times;</button>
          </div>
          {osLoading ? (
            <div className="py-8 text-center text-gray-500 text-sm">Loading bills...</div>
          ) : !osData?.bills?.length ? (
            <div className="py-8 text-center text-gray-500 text-sm">✓ No outstanding bills</div>
          ) : (
            <>
              {/* KPI */}
              <div className="grid grid-cols-3 gap-0 border-b border-gray-700">
                <div className="p-3 text-center"><div className="text-lg font-bold text-red-400">₹{fmtNum(Math.round(osData.bills.reduce((s: number, b: any) => s + Math.abs(b.closingBalance || 0), 0)))}</div><div className="text-[9px] text-gray-500 uppercase">Total OS</div></div>
                <div className="p-3 text-center"><div className="text-lg font-bold text-orange-400">{osData.bills.length}</div><div className="text-[9px] text-gray-500 uppercase">Bills</div></div>
                <div className="p-3 text-center"><div className="text-lg font-bold text-indigo-400">{Math.max(...osData.bills.map((b: any) => b.overdueDays || 0))}d</div><div className="text-[9px] text-gray-500 uppercase">Oldest</div></div>
              </div>
              {/* WA bar */}
              <div className="flex items-center justify-between px-4 py-2 bg-orange-900/10 border-b border-gray-700">
                <label className="text-xs text-gray-400 flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={checkAllBills} onChange={e => { setCheckAllBills(e.target.checked); setCheckedBills(e.target.checked ? new Set(osData.bills.map((_: any, i: number) => i)) : new Set()) }} /> Select All
                </label>
                <button onClick={shareOsWhatsApp} className="bg-green-600 text-white px-3 py-1 rounded-full text-xs font-bold hover:bg-green-700">💬 WhatsApp</button>
              </div>
              {/* Bills */}
              <div className="max-h-64 overflow-y-auto">
                {osData.bills.map((b: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 px-4 py-2 border-b border-gray-700/50 text-xs">
                    <input type="checkbox" checked={checkedBills.has(i)} onChange={e => { const next = new Set(checkedBills); e.target.checked ? next.add(i) : next.delete(i); setCheckedBills(next) }} />
                    <span className="text-gray-400 w-20">{b.billDate ? fmtDate(b.billDate) : '-'}</span>
                    <span className="text-gray-300 font-mono flex-1">{b.billRef || '-'}</span>
                    <span className="text-white font-bold">₹{fmtNum(Math.abs(Math.round(b.closingBalance || 0)))}</span>
                    {ageBadge(b.overdueDays || 0)}
                    <span className="px-1 py-0.5 rounded text-[9px] bg-indigo-900/50 text-indigo-400">{b.firmCode}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Agent OS Panel (inline) ── */}
      {osAgent && (
        <div className="bg-gray-800 rounded-xl border-t-3 border-indigo-500 border border-gray-700 mb-4 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-indigo-900/20 border-b border-gray-700">
            <span className="text-sm font-bold text-indigo-400">📊 {osAgent} — All Party Outstanding</span>
            <button onClick={() => setOsAgent(null)} className="text-gray-400 hover:text-white">&times;</button>
          </div>
          {agentOsLoading ? (
            <div className="py-8 text-center text-gray-500 text-sm">Loading...</div>
          ) : !agentOsData?.parties?.length ? (
            <div className="py-8 text-center text-gray-500 text-sm">No outstanding for this agent</div>
          ) : (
            <>
              {/* KPI */}
              <div className="grid grid-cols-3 gap-0 border-b border-gray-700">
                <div className="p-3 text-center"><div className="text-lg font-bold text-red-400">₹{fmtNum(Math.round(agentOsData.grandTotal))}</div><div className="text-[9px] text-gray-500 uppercase">Grand Total</div></div>
                <div className="p-3 text-center"><div className="text-lg font-bold text-orange-400">{agentOsData.parties.length}</div><div className="text-[9px] text-gray-500 uppercase">Parties</div></div>
                <div className="p-3 text-center"><div className="text-lg font-bold text-indigo-400">{agentOsData.totalBills}</div><div className="text-[9px] text-gray-500 uppercase">Bills</div></div>
              </div>
              {/* View Toggle + WA */}
              <div className="flex items-center justify-between px-4 py-2 bg-indigo-900/10 border-b border-gray-700">
                <div className="flex gap-1">
                  <button onClick={() => setAgentView('party')} className={`px-3 py-1 rounded-full text-xs font-semibold ${agentView === 'party' ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-400'}`}>Party Wise</button>
                  <button onClick={() => setAgentView('bill')} className={`px-3 py-1 rounded-full text-xs font-semibold ${agentView === 'bill' ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-400'}`}>Bill Wise ({agentOsData.totalBills})</button>
                </div>
                <button onClick={shareAgentWhatsApp} className="bg-green-600 text-white px-3 py-1 rounded-full text-xs font-bold hover:bg-green-700">💬 Share</button>
              </div>

              {agentView === 'party' ? (
                <div className="max-h-80 overflow-y-auto">
                  {agentOsData.parties.map((p: any, pi: number) => (
                    <div key={pi} className="border-b border-gray-700">
                      <div className="flex items-center gap-2 px-4 py-2.5 cursor-pointer hover:bg-gray-700/50" onClick={() => setExpandedAgentParty(expandedAgentParty === pi ? null : pi)}>
                        <span className="text-sm font-semibold text-white flex-1">{p.name}</span>
                        <span className="text-sm font-bold text-red-400">₹{fmtNum(Math.round(p.total))}</span>
                        <span className="text-xs text-gray-500">{p.bills.length} bills</span>
                        <span className={`text-gray-500 text-xs transition-transform ${expandedAgentParty === pi ? 'rotate-180' : ''}`}>▼</span>
                      </div>
                      {expandedAgentParty === pi && (
                        <div className="bg-gray-900/50 px-4 pb-2">
                          {p.bills.map((b: any, bi: number) => (
                            <div key={bi} className="flex items-center gap-2 py-1.5 text-xs border-b border-gray-800 last:border-0">
                              <span className="text-gray-500 w-16">{b.billDate ? fmtDate(b.billDate) : '-'}</span>
                              <span className="text-gray-300 font-mono flex-1">{b.billRef || '-'}</span>
                              <span className="text-white font-bold">₹{fmtNum(Math.abs(Math.round(b.closingBalance || 0)))}</span>
                              {ageBadge(b.overdueDays || 0)}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 px-4 py-2 bg-gray-900/30 border-b border-gray-700 text-xs">
                    <span className="text-gray-500">Date:</span>
                    <select value={agentBillSort.date} onChange={e => setAgentBillSort(p => ({ ...p, date: e.target.value }))} className="bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs text-white">
                      <option value="oldest">Oldest first</option><option value="newest">Newest first</option>
                    </select>
                    <span className="text-gray-500 ml-2">Party:</span>
                    <select value={agentBillSort.party} onChange={e => setAgentBillSort(p => ({ ...p, party: e.target.value }))} className="bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs text-white">
                      <option value="none">Default</option><option value="az">A→Z</option><option value="za">Z→A</option>
                    </select>
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {sortedAgentBills(allAgentBills).map((b: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 px-4 py-2 border-b border-gray-700/50 text-xs">
                        <span className="text-gray-600 w-5">{i + 1}</span>
                        <span className="text-gray-400 w-16">{b.billDate ? fmtDate(b.billDate) : '-'}</span>
                        <span className="text-gray-300 font-mono w-24">{b.billRef || '-'}</span>
                        <span className="text-white font-bold w-20 text-right">₹{fmtNum(Math.abs(Math.round(b.closingBalance || 0)))}</span>
                        {ageBadge(b.overdueDays || 0)}
                        <span className="text-gray-300 flex-1 truncate">{b.partyName}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between px-4 py-2 bg-indigo-900/20 border-t border-indigo-700 text-sm font-bold text-indigo-300">
                    <span>Total ({allAgentBills.length} bills)</span>
                    <span>₹{fmtNum(Math.round(agentOsData.grandTotal))}</span>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* Search */}
      <input type="text" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
        placeholder="Search party, order, item, agent..."
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm text-white mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-500" />

      <p className="text-xs text-gray-500 mb-2">{total} orders</p>

      {/* Order Cards (expandable) */}
      {isLoading ? (
        <div className="py-12 text-center text-gray-500">Loading...</div>
      ) : orders.length === 0 ? (
        <div className="py-12 text-center text-gray-500">No orders found</div>
      ) : (
        <div className="space-y-2">
          {orders.map((o: any) => {
            const expanded = expandedId === o.id
            return (
              <div key={o.id} className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
                <div className="p-3 cursor-pointer" onClick={() => setExpandedId(expanded ? null : o.id)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-white text-sm">{o.partyName}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${o.status === 'Pending' ? 'bg-orange-900/50 text-orange-400' : 'bg-green-900/50 text-green-400'}`}>{o.status}</span>
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

                {/* Expanded Detail */}
                {expanded && (
                  <div className="px-3 pb-3 pt-0 border-t border-gray-700 space-y-1.5">
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      {o.partyOrderNo && <div><span className="text-[10px] text-gray-500 block">Party Order No</span><span className="text-xs text-gray-300">{o.partyOrderNo}</span></div>}
                      {o.rate > 0 && <div><span className="text-[10px] text-gray-500 block">Rate</span><span className="text-xs text-white font-semibold">₹{o.rate}</span></div>}
                      {o.dispatchMtr > 0 && <div><span className="text-[10px] text-gray-500 block">Dispatched</span><span className="text-xs text-green-400">{fmtNum(o.dispatchMtr)} mtr</span></div>}
                      {o.desDate && <div><span className="text-[10px] text-gray-500 block">Des Date</span><span className="text-xs text-gray-300">{o.desDate}</span></div>}
                      {o.discount && <div><span className="text-[10px] text-gray-500 block">Discount</span><span className="text-xs text-gray-300">{o.discount}</span></div>}
                    </div>
                    {o.remark && <div><span className="text-[10px] text-gray-500 block">Remark</span><span className="text-xs text-yellow-400">{o.remark}</span></div>}
                  </div>
                )}
              </div>
            )
          })}
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
