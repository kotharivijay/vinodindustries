'use client'

import { useState, useMemo } from 'react'
import useSWR from 'swr'
import BackButton from '../../BackButton'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const TAG_COLORS: Record<string, string> = {
  'Dyes & Auxiliary': 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800',
  'Machinery': 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600',
  'Packing Material': 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-800',
  'Fuel': 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800',
  'Transport': 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800',
  'Employee': 'bg-teal-100 text-teal-700 border-teal-200 dark:bg-teal-900/30 dark:text-teal-300 dark:border-teal-800',
  'Customer': 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800',
  'Pali PC Job': 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800',
}

export default function LedgerTagsPage() {
  const { data: allTags = [] } = useSWR<string[]>('/api/tally/ledger-tags?action=all-tags', fetcher, { revalidateOnFocus: false })
  const { data: tagData, mutate } = useSWR('/api/tally/ledger-tags', fetcher, { revalidateOnFocus: false })

  const [search, setSearch] = useState('')
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [newTag, setNewTag] = useState('')
  const [saving, setSaving] = useState(false)

  // Fetch untagged ledgers for tagging
  const { data: allLedgers = [] } = useSWR(
    search.length >= 2 ? `/api/inventory/po?action=ledgers` : null,
    fetcher, { revalidateOnFocus: false }
  )

  // Fetch ledgers for selected tag
  const { data: tagLedgers = [], mutate: mutateTag } = useSWR(
    selectedTag ? `/api/tally/ledger-tags?tag=${encodeURIComponent(selectedTag)}` : null,
    fetcher, { revalidateOnFocus: false }
  )

  const filteredLedgers = useMemo(() => {
    if (!search || search.length < 2) return []
    const q = search.toLowerCase()
    return allLedgers.filter((l: any) => l.name.toLowerCase().includes(q)).slice(0, 30)
  }, [allLedgers, search])

  async function addTag(tag: string) {
    if (selectedIds.size === 0) return
    setSaving(true)
    await fetch('/api/tally/ledger-tags', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add-tag', ledgerIds: Array.from(selectedIds), tag }),
    })
    setSaving(false)
    setSelectedIds(new Set())
    mutate()
    mutateTag()
  }

  async function removeTag(ledgerId: number, tag: string) {
    await fetch('/api/tally/ledger-tags', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'remove-tag', ledgerIds: [ledgerId], tag }),
    })
    mutate()
    mutateTag()
  }

  function toggleSelect(id: number) {
    setSelectedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  const tagCounts = tagData?.tagCounts || {}

  return (
    <div className="p-4 md:p-6 dark:text-gray-100">
      <div className="flex items-center gap-4 mb-5">
        <BackButton />
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Ledger Tags</h1>
      </div>

      {/* Tag summary */}
      <div className="flex flex-wrap gap-2 mb-5">
        {allTags.map(tag => (
          <button key={tag} onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
            className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition ${TAG_COLORS[tag] || 'bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-800'} ${selectedTag === tag ? 'ring-2 ring-purple-400' : ''}`}>
            {tag} ({tagCounts[tag] || 0})
          </button>
        ))}
        <div className="flex items-center gap-1">
          <input type="text" placeholder="+ Custom tag" value={newTag} onChange={e => setNewTag(e.target.value)}
            className="w-28 text-xs border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-700 dark:text-gray-100" />
          {newTag.trim() && selectedIds.size > 0 && (
            <button onClick={() => { addTag(newTag.trim()); setNewTag('') }}
              className="text-xs bg-purple-600 text-white px-2 py-1.5 rounded-lg font-medium">Add</button>
          )}
        </div>
      </div>

      {/* Search + tag untagged ledgers */}
      <div className="mb-5">
        <input type="text" placeholder="🔍 Search ledger to tag (min 2 chars)..." value={search} onChange={e => setSearch(e.target.value)}
          className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2.5 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:ring-2 focus:ring-purple-400" />

        {filteredLedgers.length > 0 && (
          <div className="mt-2 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
            {selectedIds.size > 0 && (
              <div className="px-4 py-2 bg-purple-50 dark:bg-purple-900/20 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2 flex-wrap">
                <span className="text-xs text-purple-700 dark:text-purple-300 font-medium">{selectedIds.size} selected — Add tag:</span>
                {allTags.map(tag => (
                  <button key={tag} onClick={() => addTag(tag)} disabled={saving}
                    className={`text-[10px] px-2 py-0.5 rounded border font-medium disabled:opacity-50 ${TAG_COLORS[tag] || 'bg-indigo-100 text-indigo-700 border-indigo-200'}`}>
                    + {tag}
                  </button>
                ))}
              </div>
            )}
            <div className="divide-y divide-gray-50 dark:divide-gray-700 max-h-80 overflow-y-auto">
              {filteredLedgers.map((l: any, i: number) => (
                <label key={i} className="flex items-center gap-3 px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/40 cursor-pointer">
                  <input type="checkbox" checked={selectedIds.has(l.id || i)} onChange={() => toggleSelect(l.id || i)}
                    className="w-4 h-4 rounded border-gray-300 text-purple-600" />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-gray-700 dark:text-gray-200">{l.name}</span>
                    {l.parent && <span className="text-[9px] text-gray-400 ml-2">({l.parent})</span>}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {(l.tags || []).map((t: string) => (
                      <span key={t} className={`text-[9px] px-1.5 py-0.5 rounded border ${TAG_COLORS[t] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>{t}</span>
                    ))}
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Tagged ledgers for selected tag */}
      {selectedTag && (
        <div>
          <h2 className="text-sm font-bold text-gray-700 dark:text-gray-200 mb-2">{selectedTag} — {tagLedgers.length} ledgers</h2>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
            <div className="divide-y divide-gray-50 dark:divide-gray-700 max-h-96 overflow-y-auto">
              {tagLedgers.map((l: any) => (
                <div key={l.id} className="flex items-center justify-between px-4 py-2">
                  <div>
                    <span className="text-sm text-gray-700 dark:text-gray-200">{l.name}</span>
                    {l.mobileNos && <span className="text-[10px] text-gray-400 ml-2">📞 {l.mobileNos}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    {l.closingBalance != null && l.closingBalance !== 0 && (
                      <span className="text-[10px] text-gray-500">₹{Math.abs(l.closingBalance).toLocaleString('en-IN')}</span>
                    )}
                    <button onClick={() => removeTag(l.id, selectedTag)}
                      className="text-[10px] text-red-400 hover:text-red-600">✕ Remove</button>
                  </div>
                </div>
              ))}
              {tagLedgers.length === 0 && <div className="px-4 py-8 text-center text-gray-400 text-sm">No ledgers tagged with &quot;{selectedTag}&quot;</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
