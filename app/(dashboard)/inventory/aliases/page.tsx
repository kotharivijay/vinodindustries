'use client'

import { useState, useRef, useEffect } from 'react'
import useSWR from 'swr'
import BackButton from '../../BackButton'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface Alias {
  id: number
  tallyStockItem: string
  category: string
  unit: string
  gstRate: string | number
  hsn: string | null
  defaultTrackStock: boolean
  godownOverride: string | null
  lastSyncedAt: string | null
}

const CATEGORIES = ['Chemical', 'Dye', 'Auxiliary', 'Spare']

export default function AliasesPage() {
  const [search, setSearch] = useState('')
  const { data, mutate, isLoading } = useSWR<Alias[]>(
    `/api/inv/aliases${search ? `?q=${encodeURIComponent(search)}` : ''}`, fetcher,
  )
  const [syncing, setSyncing] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<Partial<Alias>>({})
  const [syncLog, setSyncLog] = useState<{ ts: string; type: 'progress' | 'complete' | 'error'; message: string }[]>([])
  const [showLog, setShowLog] = useState(false)
  const logEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [syncLog])

  function appendLog(type: 'progress' | 'complete' | 'error', message: string) {
    const ts = new Date().toLocaleTimeString('en-IN', { hour12: false })
    setSyncLog(prev => [...prev, { ts, type, message }])
  }

  function syncFromTally() {
    if (syncing) return
    setSyncing(true)
    setSyncLog([])
    setShowLog(true)
    appendLog('progress', 'Connecting to Tally…')
    const es = new EventSource('/api/inv/aliases/sync')
    es.onmessage = e => {
      try {
        const ev = JSON.parse(e.data)
        appendLog(ev.type, ev.message)
        if (ev.type === 'complete' || ev.type === 'error') {
          es.close()
          setSyncing(false)
          mutate()
        }
      } catch {}
    }
    es.onerror = () => {
      es.close()
      setSyncing(false)
      appendLog('error', 'Connection lost.')
    }
  }

  async function saveEdit() {
    await fetch('/api/inv/aliases', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: editId, ...editForm }),
    })
    setEditId(null); mutate()
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl">
      <div className="flex items-center gap-3 mb-5">
        <BackButton />
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Tally Aliases</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Stock-item master synced from Tally · {data?.length || 0} total</p>
        </div>
        <button onClick={syncFromTally} disabled={syncing}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50">
          {syncing ? '⏳ Syncing…' : '🔄 Sync from Tally'}
        </button>
      </div>

      {showLog && (
        <div className="mb-4 bg-gray-900 text-gray-100 rounded-xl border border-gray-700 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 bg-gray-800 border-b border-gray-700 text-xs">
            <span className="font-semibold">Tally Sync Log</span>
            <div className="flex gap-2">
              {!syncing && (
                <button onClick={() => setSyncLog([])} className="text-gray-400 hover:text-gray-200">Clear</button>
              )}
              <button onClick={() => setShowLog(false)} className="text-gray-400 hover:text-gray-200">Hide ✕</button>
            </div>
          </div>
          <div className="px-3 py-2 max-h-56 overflow-y-auto font-mono text-[11px] leading-snug space-y-0.5">
            {syncLog.length === 0 ? (
              <p className="text-gray-500">Waiting for first message…</p>
            ) : (
              syncLog.map((l, i) => (
                <div key={i} className="flex gap-2">
                  <span className="text-gray-500 shrink-0">{l.ts}</span>
                  <span className={
                    l.type === 'error' ? 'text-red-400' :
                    l.type === 'complete' ? 'text-emerald-400' :
                    'text-gray-200'
                  }>{l.message}</span>
                </div>
              ))
            )}
            <div ref={logEndRef} />
          </div>
        </div>
      )}

      <input type="search" value={search} onChange={e => setSearch(e.target.value)}
        placeholder="Search alias…"
        className="w-full max-w-md mb-4 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm" />

      {isLoading ? (
        <div className="p-12 text-center text-gray-400">Loading…</div>
      ) : !data?.length ? (
        <div className="p-12 text-center text-gray-400">No aliases yet — sync from Tally first.</div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300">
              <tr>
                <th className="px-3 py-2 text-left">Stock Item</th>
                <th className="px-3 py-2 text-left">Category</th>
                <th className="px-3 py-2 text-left">Unit</th>
                <th className="px-3 py-2 text-right">GST%</th>
                <th className="px-3 py-2 text-left">HSN</th>
                <th className="px-3 py-2 text-center">Track Stock</th>
                <th className="px-3 py-2 text-left">Godown override</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {data.map(a => (
                <tr key={a.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                  <td className="px-3 py-1.5 font-medium text-gray-800 dark:text-gray-100">{a.tallyStockItem}</td>
                  <td className="px-3 py-1.5">
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300">{a.category}</span>
                  </td>
                  <td className="px-3 py-1.5 text-gray-500">{a.unit}</td>
                  <td className="px-3 py-1.5 text-gray-500 text-right">{Number(a.gstRate).toFixed(2)}</td>
                  <td className="px-3 py-1.5 text-gray-500 font-mono text-[11px]">{a.hsn || '—'}</td>
                  <td className="px-3 py-1.5 text-center">{a.defaultTrackStock ? '✅' : '—'}</td>
                  <td className="px-3 py-1.5 text-gray-500 text-[11px]">{a.godownOverride || '—'}</td>
                  <td className="px-3 py-1.5 text-right">
                    <button onClick={() => { setEditId(a.id); setEditForm({ category: a.category, defaultTrackStock: a.defaultTrackStock, godownOverride: a.godownOverride || '' }) }}
                      className="text-indigo-600 dark:text-indigo-400 text-[10px] hover:underline">Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditId(null)}>
          <div onClick={e => e.stopPropagation()} className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-5 w-full max-w-sm space-y-3">
            <h3 className="text-base font-bold text-gray-800 dark:text-gray-100">Edit Alias</h3>
            <label className="block text-xs">
              <span className="text-gray-500 dark:text-gray-400">Category</span>
              <select value={editForm.category || ''} onChange={e => setEditForm(f => ({ ...f, category: e.target.value }))}
                className="mt-0.5 w-full px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm">
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={!!editForm.defaultTrackStock}
                onChange={e => setEditForm(f => ({ ...f, defaultTrackStock: e.target.checked }))} />
              <span className="text-gray-700 dark:text-gray-200">Track stock (chemicals/dyes)</span>
            </label>
            <label className="block text-xs">
              <span className="text-gray-500 dark:text-gray-400">Godown override</span>
              <input value={(editForm.godownOverride as string) || ''}
                onChange={e => setEditForm(f => ({ ...f, godownOverride: e.target.value }))}
                placeholder="leave blank to use category default"
                className="mt-0.5 w-full px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
            </label>
            <div className="flex gap-2 pt-2">
              <button onClick={() => setEditId(null)} className="flex-1 px-3 py-2 rounded-lg text-xs bg-gray-200 dark:bg-gray-700">Cancel</button>
              <button onClick={saveEdit} className="flex-1 px-3 py-2 rounded-lg text-xs bg-indigo-600 text-white font-semibold">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
