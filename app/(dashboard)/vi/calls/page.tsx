'use client'

import { useState, useEffect } from 'react'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json())

function useDebounce(v: string, d: number) {
  const [dv, setDv] = useState(v)
  useEffect(() => { const t = setTimeout(() => setDv(v), d); return () => clearTimeout(t) }, [v, d])
  return dv
}

const PRIORITIES = ['', 'critical', 'high', 'never', 'promise', 'followup']
const PRI_LABELS: Record<string, string> = { '': 'All', critical: '🔴 Critical', high: '🟠 High', never: 'Never Called', promise: 'Promise Broken', followup: 'Follow-up Due' }
const PAY_COLORS: Record<string, string> = { fast: 'bg-green-900/50 text-green-400', normal: 'bg-green-900/50 text-green-400', slow: 'bg-orange-900/50 text-orange-400', very_slow: 'bg-red-900/50 text-red-400', never: 'bg-red-900/50 text-red-400', new: 'bg-blue-900/50 text-blue-400' }
const DOT_COLORS: Record<string, string> = { critical: 'bg-red-500', high: 'bg-orange-500', medium: 'bg-yellow-500', low: 'bg-green-500' }

export default function CallsPage() {
  const [priority, setPriority] = useState('')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 350)
  const [expandedParty, setExpandedParty] = useState<string | null>(null)
  const [logForm, setLogForm] = useState<string | null>(null)
  const [logNote, setLogNote] = useState('')
  const [logPromiseDate, setLogPromiseDate] = useState('')
  const [logPromiseAmt, setLogPromiseAmt] = useState('')
  const [logFollowup, setLogFollowup] = useState('3')
  const [saving, setSaving] = useState(false)

  const params = new URLSearchParams()
  if (priority) params.set('priority', priority)
  if (debouncedSearch) params.set('search', debouncedSearch)

  const { data, mutate } = useSWR(`/api/tally/calls?${params}`, fetcher, { dedupingInterval: 30000, revalidateOnFocus: false })
  const parties = data?.parties || []
  const summary = data?.summary || {}

  // Call history
  const [historyData, setHistoryData] = useState<Record<string, any[]>>({})

  async function loadHistory(party: string) {
    if (historyData[party]) return
    const res = await fetch(`/api/tally/calls/history?party=${encodeURIComponent(party)}`)
    const d = await res.json()
    setHistoryData(prev => ({ ...prev, [party]: d.history || [] }))
  }

  async function saveCallLog(partyName: string) {
    setSaving(true)
    await fetch('/api/tally/calls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ party: partyName, note: logNote, promiseDate: logPromiseDate, promiseAmt: logPromiseAmt, nextFollowUpDays: logFollowup }),
    })
    setSaving(false)
    setLogForm(null)
    setLogNote('')
    setLogPromiseDate('')
    setLogPromiseAmt('')
    setHistoryData(prev => { const n = { ...prev }; delete n[partyName]; return n })
    mutate()
  }

  const fmtNum = (n: number) => n?.toLocaleString('en-IN') || '0'
  const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : ''

  return (
    <div className="p-4 md:p-6 max-w-4xl">
      <h1 className="text-xl font-bold text-white mb-1">Call Reminders</h1>
      <p className="text-xs text-gray-400 mb-4">Priority-scored outstanding follow-up list</p>

      {/* Summary KPI */}
      <div className="grid grid-cols-5 gap-0 bg-gray-800 rounded-xl overflow-hidden mb-4 border border-gray-700">
        {[
          { label: 'All', value: summary.total || 0, color: 'text-purple-400' },
          { label: 'Never Called', value: summary.neverCalled || 0, color: 'text-red-400' },
          { label: 'Promise Broken', value: summary.promiseBroken || 0, color: 'text-orange-400' },
          { label: 'Follow-up', value: summary.followUpDue || 0, color: 'text-blue-400' },
          { label: 'Total OS', value: '₹' + fmtNum(summary.grandOS || 0), color: 'text-green-400' },
        ].map((k, i) => (
          <div key={i} className="p-2 text-center border-r border-gray-700 last:border-r-0">
            <div className={`text-sm font-bold ${k.color}`}>{k.value}</div>
            <div className="text-[9px] text-gray-500 uppercase">{k.label}</div>
          </div>
        ))}
      </div>

      {/* Priority Chips */}
      <div className="flex gap-1.5 mb-3 flex-wrap">
        {PRIORITIES.map(p => (
          <button key={p || 'all'} onClick={() => setPriority(p)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium ${priority === p ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 border border-gray-700'}`}>
            {PRI_LABELS[p]}
          </button>
        ))}
      </div>

      <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search party..."
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm text-white mb-3 focus:outline-none focus:ring-2 focus:ring-purple-500" />

      {/* Party Cards */}
      <div className="space-y-2">
        {parties.map((p: any) => (
          <div key={p.partyName} className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
            {p.promiseBroken && <div className="bg-red-900/30 border-l-3 border-red-500 px-3 py-1 text-xs text-red-400 font-bold">⚠ Promise Broken — ₹{fmtNum(p.promiseAmt)} by {fmtDate(p.promiseDate)}</div>}
            {p.followUpDue && !p.promiseBroken && <div className="bg-blue-900/30 border-l-3 border-blue-500 px-3 py-1 text-xs text-blue-400 font-bold">🔁 Follow-up due — {fmtDate(p.nextFollowUp)}</div>}

            <div className="p-3 cursor-pointer" onClick={() => { setExpandedParty(expandedParty === p.partyName ? null : p.partyName); if (expandedParty !== p.partyName) loadHistory(p.partyName) }}>
              <div className="flex items-start gap-2">
                <div className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${DOT_COLORS[p.priority] || 'bg-gray-500'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-white text-sm truncate">{p.partyName}</span>
                    {p.firms?.map((f: string) => <span key={f} className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-900/50 text-indigo-400">{f}</span>)}
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${PAY_COLORS[p.payTag] || ''}`}>{p.payLabel}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-sm font-bold text-red-400">₹{fmtNum(p.totalOS)}</span>
                    <span className="text-xs text-gray-500">{p.billCount} bills</span>
                    <span className="text-xs text-gray-500">{p.maxAge}d oldest</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {p.daysSince === null ? <span className="text-red-400 font-bold">Never called</span> : <>Last call: {fmtDate(p.lastCallDate)} ({p.daysSince}d ago){p.lastNote ? ` — ${p.lastNote.slice(0, 50)}` : ''}</>}
                  </div>
                </div>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold capitalize ${p.priority === 'critical' ? 'bg-red-900/50 text-red-400' : p.priority === 'high' ? 'bg-orange-900/50 text-orange-400' : p.priority === 'medium' ? 'bg-yellow-900/50 text-yellow-400' : 'bg-green-900/50 text-green-400'}`}>
                  {p.priority}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-1.5 px-3 pb-2 flex-wrap">
              {p.mobile ? (
                <>
                  <a href={`tel:${p.mobile}`} className="px-2.5 py-1 bg-green-900/30 border border-green-700 text-green-400 rounded-full text-xs font-medium">📞 Call</a>
                  <a href={`https://wa.me/91${p.mobile}?text=${encodeURIComponent(`Dear *${p.partyName}*,\n\nPayment reminder: Outstanding ₹${fmtNum(p.totalOS)} (${p.billCount} bills, oldest ${p.maxAge} days).\n\nPlease arrange payment.\nThank you.`)}`}
                    target="_blank" className="px-2.5 py-1 bg-green-900/30 border border-green-700 text-green-400 rounded-full text-xs font-medium">💬 WA</a>
                </>
              ) : <span className="px-2.5 py-1 bg-gray-700 text-gray-500 rounded-full text-xs">No mobile</span>}
              <button onClick={(e) => { e.stopPropagation(); setLogForm(logForm === p.partyName ? null : p.partyName) }}
                className="px-2.5 py-1 bg-purple-900/30 border border-purple-700 text-purple-400 rounded-full text-xs font-medium">📝 Log Call</button>
            </div>

            {/* Log Form */}
            {logForm === p.partyName && (
              <div className="bg-gray-900 border-t border-gray-700 p-3">
                <div className="text-xs font-bold text-white mb-2">📝 Log Call — {p.partyName}</div>
                <div className="flex gap-1.5 mb-2 flex-wrap">
                  {['No Answer', 'Will Pay', 'Part Payment', 'Busy', 'Promise Made'].map(t => (
                    <button key={t} onClick={() => setLogNote(t)} className={`px-2 py-0.5 rounded text-[10px] border ${logNote === t ? 'bg-purple-600 text-white border-purple-600' : 'bg-gray-800 text-gray-400 border-gray-700'}`}>{t}</button>
                  ))}
                </div>
                <textarea value={logNote} onChange={e => setLogNote(e.target.value)} placeholder="Note..." className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-xs text-white mb-2 h-16 resize-none focus:outline-none" />
                <div className="grid grid-cols-3 gap-2 mb-2">
                  <div><label className="text-[10px] text-gray-500 block mb-0.5">Promise Date</label><input type="date" value={logPromiseDate} onChange={e => setLogPromiseDate(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white" /></div>
                  <div><label className="text-[10px] text-gray-500 block mb-0.5">Promise ₹</label><input type="number" value={logPromiseAmt} onChange={e => setLogPromiseAmt(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white" /></div>
                  <div><label className="text-[10px] text-gray-500 block mb-0.5">Follow-up in</label>
                    <select value={logFollowup} onChange={e => setLogFollowup(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white">
                      <option value="">No follow-up</option>
                      <option value="1">1 day</option><option value="2">2 days</option><option value="3">3 days</option>
                      <option value="5">5 days</option><option value="7">1 week</option><option value="14">2 weeks</option>
                    </select>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => saveCallLog(p.partyName)} disabled={saving} className="flex-1 bg-purple-600 text-white py-1.5 rounded text-xs font-medium disabled:opacity-50">{saving ? 'Saving...' : '✓ Save'}</button>
                  <button onClick={() => setLogForm(null)} className="px-4 py-1.5 bg-gray-700 text-gray-400 rounded text-xs">✗</button>
                </div>
              </div>
            )}

            {/* Call History */}
            {expandedParty === p.partyName && (
              <div className="bg-gray-900/50 border-t border-gray-700 p-3">
                <div className="text-[10px] text-gray-500 uppercase font-semibold mb-2">Call History</div>
                {!(historyData[p.partyName]?.length) ? (
                  <div className="text-xs text-gray-500 text-center py-2">No history yet</div>
                ) : historyData[p.partyName].map((h: any, i: number) => (
                  <div key={i} className="flex gap-2 py-1.5 border-b border-gray-800 last:border-0">
                    <span className="text-[10px] text-gray-500 w-16 shrink-0">{fmtDate(h.callDate)}</span>
                    <div className="text-xs text-gray-300 flex-1">
                      {h.note || <em className="text-gray-600">No note</em>}
                      {h.promiseDate && <div className="text-orange-400 text-[10px] mt-0.5">Promise: ₹{fmtNum(h.promiseAmt)} by {fmtDate(h.promiseDate)}</div>}
                      {h.calledBy && <div className="text-gray-600 text-[10px]">by {h.calledBy}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {parties.length === 0 && <div className="py-12 text-center text-gray-500">No parties match filters</div>}
    </div>
  )
}
