'use client'

import { useState } from 'react'
import useSWR from 'swr'
import BackButton from '../../BackButton'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface Party {
  id: number
  tallyLedger: string
  displayName: string
  gstin: string | null
  state: string | null
  city: string | null
  whatsapp: string | null
  email: string | null
  parentGroup: string | null
  gstRegistrationType: 'Regular' | 'Composition' | 'Unregistered'
  active: boolean
  lastSyncedAt: string | null
}

export default function PartiesPage() {
  const [search, setSearch] = useState('')
  const { data, mutate, isLoading } = useSWR<Party[]>(
    `/api/inv/parties${search ? `?q=${encodeURIComponent(search)}` : ''}`, fetcher,
  )
  const [syncing, setSyncing] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<Partial<Party>>({})

  async function syncFromTally() {
    setSyncing(true)
    try {
      const res = await fetch('/api/inv/parties/sync', { method: 'POST' })
      const d = await res.json()
      if (!res.ok) alert('Sync failed: ' + (d.error || res.status))
      else alert(`Synced — ${d.inserted} new, ${d.updated} updated`)
      mutate()
    } finally { setSyncing(false) }
  }

  function openEdit(p: Party) {
    setEditingId(p.id)
    setEditForm({ whatsapp: p.whatsapp || '', email: p.email || '', city: p.city || '', gstRegistrationType: p.gstRegistrationType })
  }

  async function saveEdit() {
    await fetch('/api/inv/parties', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: editingId, ...editForm }),
    })
    setEditingId(null); mutate()
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl">
      <div className="flex items-center gap-3 mb-5">
        <BackButton />
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Parties</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Suppliers + customers synced from Tally · {data?.length || 0} total</p>
        </div>
        <button onClick={syncFromTally} disabled={syncing}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50">
          {syncing ? '⏳ Syncing…' : '🔄 Sync from Tally'}
        </button>
      </div>

      <input type="search" value={search} onChange={e => setSearch(e.target.value)}
        placeholder="Search by name…"
        className="w-full max-w-md mb-4 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm" />

      {isLoading ? (
        <div className="p-12 text-center text-gray-400">Loading…</div>
      ) : !data?.length ? (
        <div className="p-12 text-center text-gray-400">No parties yet — click <strong>Sync from Tally</strong> to import.</div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">GSTIN</th>
                <th className="px-3 py-2 text-left">State</th>
                <th className="px-3 py-2 text-left">GST Type</th>
                <th className="px-3 py-2 text-left">Group</th>
                <th className="px-3 py-2 text-left">WhatsApp</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {data.map(p => (
                <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                  <td className="px-3 py-1.5 font-medium text-gray-800 dark:text-gray-100">{p.displayName}</td>
                  <td className="px-3 py-1.5 text-gray-500 font-mono text-[11px]">{p.gstin || '—'}</td>
                  <td className="px-3 py-1.5 text-gray-500">{p.state || '—'}</td>
                  <td className="px-3 py-1.5">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      p.gstRegistrationType === 'Regular' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
                      p.gstRegistrationType === 'Composition' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' :
                      'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                    }`}>
                      {p.gstRegistrationType}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-gray-500 text-[11px]">{p.parentGroup || '—'}</td>
                  <td className="px-3 py-1.5 text-gray-500">{p.whatsapp || '—'}</td>
                  <td className="px-3 py-1.5 text-right">
                    <button onClick={() => openEdit(p)} className="text-indigo-600 dark:text-indigo-400 text-[10px] hover:underline">Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editingId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditingId(null)}>
          <div onClick={e => e.stopPropagation()} className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-5 w-full max-w-sm space-y-3">
            <h3 className="text-base font-bold text-gray-800 dark:text-gray-100">Edit Party</h3>
            {(['whatsapp', 'email', 'city'] as const).map(k => (
              <label key={k} className="block text-xs">
                <span className="text-gray-500 dark:text-gray-400 capitalize">{k}</span>
                <input value={(editForm as any)[k] || ''}
                  onChange={e => setEditForm(f => ({ ...f, [k]: e.target.value }))}
                  className="mt-0.5 w-full px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
              </label>
            ))}
            <label className="block text-xs">
              <span className="text-gray-500 dark:text-gray-400">GST Type</span>
              <select value={editForm.gstRegistrationType || 'Regular'}
                onChange={e => setEditForm(f => ({ ...f, gstRegistrationType: e.target.value as any }))}
                className="mt-0.5 w-full px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm">
                <option>Regular</option>
                <option>Composition</option>
                <option>Unregistered</option>
              </select>
            </label>
            <div className="flex gap-2 pt-2">
              <button onClick={() => setEditingId(null)} className="flex-1 px-3 py-2 rounded-lg text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200">Cancel</button>
              <button onClick={saveEdit} className="flex-1 px-3 py-2 rounded-lg text-xs bg-indigo-600 text-white font-semibold">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
