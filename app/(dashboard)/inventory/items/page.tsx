'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import BackButton from '../../BackButton'
import { ITEM_USAGE_TAG_GROUPS, ITEM_USAGE_TAGS, labelForUsageTag } from '@/lib/inv/item-usage-tags'

/** Title-case + collapse internal whitespace, e.g. "  reactive  yellow 145 " → "Reactive Yellow 145". */
function normalizeDisplayName(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase())
}

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface Item {
  id: number
  displayName: string
  unit: string
  reviewStatus: 'approved' | 'pending_review' | 'rejected'
  trackStock: boolean
  usageTags: string[]
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
  const [tagFilter, setTagFilter] = useState<string>('') // '' = all
  const [editTagsForId, setEditTagsForId] = useState<number | null>(null)

  // Searchable alias combobox state
  const [aliasQuery, setAliasQuery] = useState('')
  const [aliasOpen, setAliasOpen] = useState(false)
  const aliasBoxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (aliasBoxRef.current && !aliasBoxRef.current.contains(e.target as Node)) {
        setAliasOpen(false)
      }
    }
    if (aliasOpen) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [aliasOpen])

  const selectedAlias = useMemo(
    () => aliases.find(a => String(a.id) === form.aliasId) || null,
    [aliases, form.aliasId],
  )

  const filteredAliases = useMemo(() => {
    const q = aliasQuery.trim().toLowerCase()
    if (!q) return aliases.slice(0, 100)
    return aliases.filter(a =>
      a.tallyStockItem.toLowerCase().includes(q) ||
      a.category.toLowerCase().includes(q) ||
      a.unit.toLowerCase().includes(q),
    ).slice(0, 100)
  }, [aliases, aliasQuery])

  function pickAlias(a: Alias) {
    setForm(f => ({ ...f, aliasId: String(a.id) }))
    setAliasQuery(a.tallyStockItem)
    setAliasOpen(false)
  }

  function resetForm() {
    setForm({ displayName: '', aliasId: '', autoApprove: false })
    setAliasQuery('')
    setAliasOpen(false)
  }

  async function create() {
    const cleanName = normalizeDisplayName(form.displayName)
    if (!cleanName || !form.aliasId) {
      alert('Display name and alias are required.')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/inv/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: cleanName,
          aliasId: Number(form.aliasId),
          autoApprove: form.autoApprove,
        }),
      })
      const d = await res.json()
      if (!res.ok) { alert('Save failed: ' + (d.error || res.status)); return }
      setShowCreate(false)
      resetForm()
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

      {/* Usage-tag filter row */}
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        <span className="text-[11px] text-gray-500 dark:text-gray-400">Tag:</span>
        <button onClick={() => setTagFilter('')}
          className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border ${
            !tagFilter ? 'bg-purple-600 text-white border-purple-600'
              : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600'
          }`}>
          Any
        </button>
        {ITEM_USAGE_TAGS.map(t => (
          <button key={t} onClick={() => setTagFilter(prev => prev === t ? '' : t)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border ${
              tagFilter === t ? 'bg-purple-600 text-white border-purple-600'
                : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600'
            }`}>
            {labelForUsageTag(t)}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="p-12 text-center text-gray-400">Loading…</div>
      ) : !data?.length ? (
        <div className="p-12 text-center text-gray-400">No items match.</div>
      ) : (() => {
        const visible = tagFilter
          ? (data || []).filter(it => (it.usageTags || []).includes(tagFilter))
          : (data || [])
        if (!visible.length) {
          return (
            <div className="p-12 text-center text-gray-400">
              No items tagged <span className="font-semibold">{labelForUsageTag(tagFilter)}</span>. Pick another tag or click Any.
            </div>
          )
        }
        return (
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
                <th className="px-3 py-2 text-left">Used at</th>
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {visible.map(it => (
                <tr key={it.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                  <td className="px-3 py-1.5 font-medium text-gray-800 dark:text-gray-100">{it.displayName}</td>
                  <td className="px-3 py-1.5 text-gray-500">{it.alias.tallyStockItem}</td>
                  <td className="px-3 py-1.5"><span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300">{it.alias.category}</span></td>
                  <td className="px-3 py-1.5 text-gray-500">{it.unit}</td>
                  <td className="px-3 py-1.5 text-gray-500 text-right">{Number(it.alias.gstRate).toFixed(0)}</td>
                  <td className="px-3 py-1.5 text-center">{it.trackStock ? '✅' : '—'}</td>
                  <td className="px-3 py-1.5">
                    <div className="flex flex-wrap items-center gap-1">
                      {(it.usageTags || []).map(t => (
                        <span key={t} className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">
                          {labelForUsageTag(t)}
                        </span>
                      ))}
                      <button onClick={() => setEditTagsForId(it.id)}
                        className="text-[10px] text-indigo-600 dark:text-indigo-400 hover:underline px-1">
                        {(it.usageTags || []).length === 0 ? '+ tag' : 'Edit'}
                      </button>
                    </div>
                  </td>
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
        )
      })()}

      {editTagsForId !== null && (() => {
        const item = (data || []).find(i => i.id === editTagsForId)
        if (!item) return null
        return (
          <UsageTagEditor
            item={item}
            onClose={() => setEditTagsForId(null)}
            onSaved={() => { setEditTagsForId(null); mutate() }}
          />
        )
      })()}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => { setShowCreate(false); resetForm() }}>
          <div onClick={e => e.stopPropagation()} className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-5 w-full max-w-sm space-y-3">
            <h3 className="text-base font-bold text-gray-800 dark:text-gray-100">New Item</h3>

            <label className="block text-xs">
              <span className="text-gray-500 dark:text-gray-400">Display name *</span>
              <input
                value={form.displayName}
                onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}
                onBlur={() => setForm(f => ({ ...f, displayName: normalizeDisplayName(f.displayName) }))}
                placeholder="Reactive Yellow 145"
                className="mt-0.5 w-full px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
              <span className="text-[10px] text-gray-400">Auto-trims and Title-Cases on blur. Saved as: <span className="font-mono">{normalizeDisplayName(form.displayName) || '—'}</span></span>
            </label>

            <div ref={aliasBoxRef} className="relative">
              <label className="block text-xs">
                <span className="text-gray-500 dark:text-gray-400">Tally alias *</span>
                <input
                  value={aliasQuery}
                  onChange={e => { setAliasQuery(e.target.value); setForm(f => ({ ...f, aliasId: '' })); setAliasOpen(true) }}
                  onFocus={() => setAliasOpen(true)}
                  placeholder="Search Tally stock items…"
                  className="mt-0.5 w-full px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
              </label>
              {aliasOpen && (
                <div className="absolute z-10 left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl max-h-64 overflow-y-auto">
                  {filteredAliases.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-gray-400">
                      No aliases match. {aliases.length === 0 && <span>Sync from Tally first at <span className="font-mono">/inventory/aliases</span>.</span>}
                    </div>
                  ) : filteredAliases.map(a => (
                    <button key={a.id} type="button" onClick={() => pickAlias(a)}
                      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-indigo-50 dark:hover:bg-indigo-900/30 flex justify-between items-center gap-2 ${form.aliasId === String(a.id) ? 'bg-indigo-50 dark:bg-indigo-900/20' : ''}`}>
                      <span className="font-medium text-gray-800 dark:text-gray-100 truncate">{a.tallyStockItem}</span>
                      <span className="text-[10px] text-gray-500 dark:text-gray-400 shrink-0">{a.category} · {a.unit} · {Number(a.gstRate).toFixed(0)}%</span>
                    </button>
                  ))}
                </div>
              )}
              {selectedAlias && (
                <p className="mt-1 text-[10px] text-gray-400">
                  Drives unit ({selectedAlias.unit}), GST {Number(selectedAlias.gstRate).toFixed(0)}%, category {selectedAlias.category}
                </p>
              )}
            </div>

            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={form.autoApprove}
                onChange={e => setForm(f => ({ ...f, autoApprove: e.target.checked }))} />
              <span className="text-gray-700 dark:text-gray-200">Approve immediately (skip review)</span>
            </label>

            <div className="flex gap-2 pt-2">
              <button onClick={() => { setShowCreate(false); resetForm() }} className="flex-1 px-3 py-2 rounded-lg text-xs bg-gray-200 dark:bg-gray-700">Cancel</button>
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

function UsageTagEditor({ item, onClose, onSaved }: {
  item: Item
  onClose: () => void
  onSaved: () => void
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set(item.usageTags || []))
  const [saving, setSaving] = useState(false)

  function toggle(tag: string) {
    setPicked(prev => { const s = new Set(prev); s.has(tag) ? s.delete(tag) : s.add(tag); return s })
  }

  async function save() {
    setSaving(true)
    try {
      const res = await fetch(`/api/inv/items/${item.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usageTags: Array.from(picked) }),
      })
      if (res.ok) onSaved()
      else { const d = await res.json().catch(() => ({})); alert('Save failed: ' + (d.error || res.status)) }
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-5 w-full max-w-md space-y-3">
        <div>
          <h3 className="text-base font-bold text-gray-800 dark:text-gray-100">Used at</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{item.displayName}</p>
        </div>

        {ITEM_USAGE_TAG_GROUPS.map(group => (
          <div key={group.label}>
            <p className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1.5">{group.label}</p>
            <div className="flex flex-wrap gap-1.5">
              {group.tags.map(tag => {
                const on = picked.has(tag)
                return (
                  <button key={tag} type="button" onClick={() => toggle(tag)}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition ${
                      on
                        ? 'bg-purple-600 text-white border-purple-600'
                        : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600'
                    }`}>
                    {labelForUsageTag(tag)}
                  </button>
                )
              })}
            </div>
          </div>
        ))}

        <p className="text-[10px] text-gray-400">
          {picked.size} selected · click to toggle. New tag values can be added in
          <span className="font-mono"> lib/inv/item-usage-tags.ts</span>.
        </p>

        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 px-3 py-2 rounded-lg text-xs bg-gray-200 dark:bg-gray-700">Cancel</button>
          <button onClick={save} disabled={saving}
            className="flex-1 px-3 py-2 rounded-lg text-xs bg-indigo-600 text-white font-semibold disabled:opacity-50">
            {saving ? 'Saving…' : 'Save tags'}
          </button>
        </div>
      </div>
    </div>
  )
}
