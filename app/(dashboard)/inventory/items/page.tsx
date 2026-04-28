'use client'

import { useState } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import BackButton from '../../BackButton'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface Item {
  id: number
  displayName: string
  unit: string
  reviewStatus: 'approved' | 'pending_review' | 'rejected'
  trackStock: boolean
  alias: { id: number; tallyStockItem: string; category: string; gstRate: string }
  group?: { id: number; name: string } | null
}

interface Alias { id: number; tallyStockItem: string; unit: string; gstRate: string; category: string }

export default function ItemsPage() {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'approved' | 'pending_review' | 'rejected'>('all')
  const queryParams = new URLSearchParams()
  if (search) queryParams.set('q', search)
  if (filter !== 'all') queryParams.set('reviewStatus', filter)
  const { data, mutate, isLoading } = useSWR<Item[]>(`/api/inv/items?${queryParams.toString()}`, fetcher)
  const { data: aliases = [] } = useSWR<Alias[]>('/api/inv/aliases', fetcher)

  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ displayName: '', aliasId: '', autoApprove: false })
  const [saving, setSaving] = useState(false)

  async function create() {
    if (!form.displayName.trim() || !form.aliasId) return
    setSaving(true)
    try {
      const res = await fetch('/api/inv/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: form.displayName.trim(),
          aliasId: Number(form.aliasId),
          autoApprove: form.autoApprove,
        }),
      })
      const d = await res.json()
      if (!res.ok) { alert('Save failed: ' + (d.error || res.status)); return }
      setShowCreate(false)
      setForm({ displayName: '', aliasId: '', autoApprove: false })
      mutate()
    } finally { setSaving(false) }
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl">
      <div className="flex items-center gap-3 mb-5">
        <BackButton />
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Items Master</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{data?.length || 0} items · two-layer model (real items → Tally aliases)</p>
        </div>
        <Link href="/inventory/items/review" className="bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 px-3 py-2 rounded-lg text-xs font-semibold border border-amber-300 dark:border-amber-700">
          Review queue →
        </Link>
        <button onClick={() => setShowCreate(true)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-semibold">
          + New Item
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        {(['all', 'approved', 'pending_review', 'rejected'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
              filter === f ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600'
            }`}>
            {f === 'all' ? 'All' : f === 'pending_review' ? 'Pending' : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
        <input type="search" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search…"
          className="flex-1 min-w-[180px] px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs" />
      </div>

      {isLoading ? (
        <div className="p-12 text-center text-gray-400">Loading…</div>
      ) : !data?.length ? (
        <div className="p-12 text-center text-gray-400">No items match.</div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300">
              <tr>
                <th className="px-3 py-2 text-left">Item</th>
                <th className="px-3 py-2 text-left">Alias</th>
                <th className="px-3 py-2 text-left">Cat</th>
                <th className="px-3 py-2 text-left">Unit</th>
                <th className="px-3 py-2 text-right">GST%</th>
                <th className="px-3 py-2 text-center">Track</th>
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {data.map(it => (
                <tr key={it.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                  <td className="px-3 py-1.5 font-medium text-gray-800 dark:text-gray-100">{it.displayName}</td>
                  <td className="px-3 py-1.5 text-gray-500">{it.alias.tallyStockItem}</td>
                  <td className="px-3 py-1.5"><span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300">{it.alias.category}</span></td>
                  <td className="px-3 py-1.5 text-gray-500">{it.unit}</td>
                  <td className="px-3 py-1.5 text-gray-500 text-right">{Number(it.alias.gstRate).toFixed(0)}</td>
                  <td className="px-3 py-1.5 text-center">{it.trackStock ? '✅' : '—'}</td>
                  <td className="px-3 py-1.5">
                    {it.reviewStatus === 'approved' && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">Approved</span>}
                    {it.reviewStatus === 'pending_review' && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">Pending</span>}
                    {it.reviewStatus === 'rejected' && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">Rejected</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowCreate(false)}>
          <div onClick={e => e.stopPropagation()} className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-5 w-full max-w-sm space-y-3">
            <h3 className="text-base font-bold text-gray-800 dark:text-gray-100">New Item</h3>
            <label className="block text-xs">
              <span className="text-gray-500 dark:text-gray-400">Display name *</span>
              <input value={form.displayName} onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}
                placeholder="Reactive Yellow 145"
                className="mt-0.5 w-full px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
            </label>
            <label className="block text-xs">
              <span className="text-gray-500 dark:text-gray-400">Tally alias *</span>
              <select value={form.aliasId} onChange={e => setForm(f => ({ ...f, aliasId: e.target.value }))}
                className="mt-0.5 w-full px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm">
                <option value="">— Select alias —</option>
                {aliases.map(a => <option key={a.id} value={a.id}>{a.tallyStockItem} ({a.unit}, {Number(a.gstRate).toFixed(0)}%)</option>)}
              </select>
              <span className="text-[10px] text-gray-400">Drives unit, GST rate, and category</span>
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={form.autoApprove}
                onChange={e => setForm(f => ({ ...f, autoApprove: e.target.checked }))} />
              <span className="text-gray-700 dark:text-gray-200">Approve immediately (skip review)</span>
            </label>
            <div className="flex gap-2 pt-2">
              <button onClick={() => setShowCreate(false)} className="flex-1 px-3 py-2 rounded-lg text-xs bg-gray-200 dark:bg-gray-700">Cancel</button>
              <button onClick={create} disabled={saving} className="flex-1 px-3 py-2 rounded-lg text-xs bg-indigo-600 text-white font-semibold disabled:opacity-50">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
