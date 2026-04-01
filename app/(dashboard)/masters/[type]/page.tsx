'use client'

import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'next/navigation'
import { findSimilar } from '@/lib/nameUtils'

const LABELS: Record<string, string> = {
  parties: 'Parties',
  qualities: 'Qualities',
  weavers: 'Weavers',
  transports: 'Transports',
}

const PREDEFINED_TAGS = ['Pali PC Job', 'Local', 'Direct', 'Commission']

interface Item { id: number; name: string; tag?: string | null; createdAt: string }
interface Suggestion { id: number; name: string; score: number }

export default function MasterPage() {
  const { type } = useParams<{ type: string }>()
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')

  const [confirmSuggestions, setConfirmSuggestions] = useState<Suggestion[] | null>(null)
  const [pendingName, setPendingName] = useState('')

  // Tag state (parties only)
  const [tagFilter, setTagFilter] = useState<string | null>(null) // null = All
  const [bulkTagMode, setBulkTagMode] = useState(false)
  const [bulkSelected, setBulkSelected] = useState<Set<number>>(new Set())
  const [bulkTag, setBulkTag] = useState('')
  const [customTag, setCustomTag] = useState('')
  const [showCustomTag, setShowCustomTag] = useState(false)
  const [savingTag, setSavingTag] = useState(false)
  const [editingTagId, setEditingTagId] = useState<number | null>(null)
  const [editTagValue, setEditTagValue] = useState('')
  const [showEditCustom, setShowEditCustom] = useState(false)

  const isParties = type === 'parties'

  const label = LABELS[type] ?? type
  const singular = label.toLowerCase().replace(/s$/, '')

  useEffect(() => {
    fetch(`/api/masters/${type}`)
      .then((r) => r.json())
      .then((d) => { setItems(d); setLoading(false) })
  }, [type])

  // Unique tags from items
  const uniqueTags = useMemo(() => {
    if (!isParties) return []
    const tags = new Set<string>()
    for (const item of items) {
      if (item.tag) tags.add(item.tag)
    }
    return Array.from(tags).sort()
  }, [items, isParties])

  // Filtered items
  const filteredItems = useMemo(() => {
    if (!isParties || tagFilter === null) return items
    if (tagFilter === '__untagged__') return items.filter(i => !i.tag)
    return items.filter(i => i.tag === tagFilter)
  }, [items, tagFilter, isParties])

  const liveSuggestions = useMemo<Suggestion[]>(() => {
    if (newName.trim().length < 2) return []
    return findSimilar(newName, items, 60)
  }, [newName, items])

  async function submitName(name: string, force = false) {
    setAdding(true); setError('')
    const res = await fetch(`/api/masters/${type}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, force }),
    })
    const data = await res.json()

    if (res.status === 201) {
      setItems(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
      setNewName('')
      setConfirmSuggestions(null)
      setPendingName('')
    } else if (res.status === 200 && data.needsConfirm) {
      setConfirmSuggestions(data.suggestions)
      setPendingName(name)
    } else {
      setError(data.error ?? 'Failed to add')
    }
    setAdding(false)
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    await submitName(newName.trim())
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this entry?')) return
    const res = await fetch(`/api/masters/${type}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (res.ok) {
      setItems((prev) => prev.filter((i) => i.id !== id))
    } else {
      const d = await res.json()
      alert(d.error ?? 'Cannot delete')
    }
  }

  // Bulk tag apply
  async function applyBulkTag() {
    const tag = showCustomTag ? customTag.trim() : bulkTag
    if (!tag || bulkSelected.size === 0) return
    setSavingTag(true)
    try {
      const res = await fetch(`/api/masters/parties`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(bulkSelected), tag }),
      })
      if (res.ok) {
        setItems(prev => prev.map(item =>
          bulkSelected.has(item.id) ? { ...item, tag } : item
        ))
        setBulkSelected(new Set())
        setBulkTag('')
        setCustomTag('')
        setShowCustomTag(false)
        setBulkTagMode(false)
      }
    } finally {
      setSavingTag(false)
    }
  }

  // Individual tag update
  async function saveIndividualTag(id: number) {
    const tag = showEditCustom ? customTag.trim() : editTagValue
    setSavingTag(true)
    try {
      const res = await fetch(`/api/masters/parties`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [id], tag: tag || null }),
      })
      if (res.ok) {
        setItems(prev => prev.map(item =>
          item.id === id ? { ...item, tag: tag || null } : item
        ))
        setEditingTagId(null)
        setEditTagValue('')
        setCustomTag('')
        setShowEditCustom(false)
      }
    } finally {
      setSavingTag(false)
    }
  }

  function toggleBulkSelect(id: number) {
    setBulkSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (bulkSelected.size === filteredItems.length) {
      setBulkSelected(new Set())
    } else {
      setBulkSelected(new Set(filteredItems.map(i => i.id)))
    }
  }

  function scoreColor(score: number) {
    if (score >= 90) return 'text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400'
    if (score >= 75) return 'text-orange-600 bg-orange-50 dark:bg-orange-900/20 dark:text-orange-400'
    return 'text-yellow-700 bg-yellow-50 dark:bg-yellow-900/20 dark:text-yellow-400'
  }

  function tagColor(tag: string) {
    if (tag === 'Pali PC Job') return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800'
    if (tag === 'Local') return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800'
    if (tag === 'Direct') return 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800'
    if (tag === 'Commission') return 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-800'
    return 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-600'
  }

  return (
    <div className={`p-4 md:p-8 max-w-2xl ${isParties && bulkTagMode ? 'pb-32' : ''}`}>
      <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-1">{label}</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Manage {label.toLowerCase()} used in dropdown lists</p>

      {/* Add form */}
      <form onSubmit={handleAdd} className="flex gap-3 mb-2">
        <div className="flex-1 relative">
          <input
            type="text"
            className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            placeholder={`Add new ${singular}... (auto-cleaned: spaces, quotes)`}
            value={newName}
            onChange={(e) => { setNewName(e.target.value); setError('') }}
            autoComplete="off"
          />
        </div>
        <button
          type="submit"
          disabled={adding}
          className="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-60 shrink-0"
        >
          {adding ? 'Adding...' : '+ Add'}
        </button>
      </form>

      {/* Live suggestions */}
      {liveSuggestions.length > 0 && newName.trim().length >= 2 && (
        <div className="mb-4 rounded-lg border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-4 py-3">
          <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-2">Similar names already exist -- did you mean one of these?</p>
          <div className="flex flex-col gap-1">
            {liveSuggestions.map(s => (
              <button
                key={s.id}
                type="button"
                onClick={() => { setNewName(s.name); setError('') }}
                className="flex items-center justify-between text-left text-sm px-3 py-1.5 rounded-md bg-white dark:bg-gray-700 border border-amber-200 dark:border-amber-700 hover:border-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition"
              >
                <span className="font-medium text-gray-800 dark:text-gray-100">{s.name}</span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ml-2 shrink-0 ${scoreColor(s.score)}`}>
                  {s.score}% match
                </span>
              </button>
            ))}
          </div>
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">Click a name to use it, or continue typing to add as new.</p>
        </div>
      )}

      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

      {/* Tag filter chips + Bulk Tag button (parties only) */}
      {isParties && !loading && items.length > 0 && (
        <div className="mb-4 space-y-3">
          {/* Filter chips */}
          <div className="flex gap-2 flex-wrap items-center">
            <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">Filter:</span>
            <button
              onClick={() => setTagFilter(null)}
              className={`text-xs px-3 py-1.5 rounded-full border transition ${
                tagFilter === null
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              All ({items.length})
            </button>
            {uniqueTags.map(tag => {
              const count = items.filter(i => i.tag === tag).length
              return (
                <button
                  key={tag}
                  onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition ${
                    tagFilter === tag
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : `${tagColor(tag)} hover:opacity-80`
                  }`}
                >
                  {tag} ({count})
                </button>
              )
            })}
            <button
              onClick={() => setTagFilter(tagFilter === '__untagged__' ? null : '__untagged__')}
              className={`text-xs px-3 py-1.5 rounded-full border transition ${
                tagFilter === '__untagged__'
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              Untagged ({items.filter(i => !i.tag).length})
            </button>
          </div>

          {/* Bulk tag toggle */}
          <button
            onClick={() => { setBulkTagMode(!bulkTagMode); setBulkSelected(new Set()); setBulkTag(''); setCustomTag(''); setShowCustomTag(false) }}
            className={`text-xs px-3 py-2 rounded-lg font-medium transition ${
              bulkTagMode
                ? 'bg-indigo-500 text-white hover:bg-indigo-600'
                : 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-700 hover:bg-indigo-100 dark:hover:bg-indigo-900/30'
            }`}
          >
            {bulkTagMode ? 'Cancel Bulk Tag' : 'Bulk Tag Mode'}
          </button>
        </div>
      )}

      {/* List */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
        {loading ? (
          <div className="p-8 text-center text-gray-400">Loading...</div>
        ) : filteredItems.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            {tagFilter !== null ? 'No parties match this filter.' : `No ${label.toLowerCase()} added yet.`}
          </div>
        ) : (
          <>
            {/* Select all in bulk mode */}
            {isParties && bulkTagMode && (
              <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={bulkSelected.size === filteredItems.length && filteredItems.length > 0}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 accent-indigo-500 cursor-pointer"
                />
                <span className="text-xs text-gray-500 dark:text-gray-400">Select all ({filteredItems.length})</span>
              </div>
            )}
            <ul className="divide-y divide-gray-100 dark:divide-gray-700">
              {filteredItems.map((item) => (
                <li key={item.id} className="flex items-center gap-3 px-4 py-3">
                  {/* Bulk checkbox */}
                  {isParties && bulkTagMode && (
                    <input
                      type="checkbox"
                      checked={bulkSelected.has(item.id)}
                      onChange={() => toggleBulkSelect(item.id)}
                      className="w-4 h-4 accent-indigo-500 shrink-0 cursor-pointer"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm text-gray-800 dark:text-gray-200">{item.name}</span>
                      {/* Tag badge */}
                      {isParties && item.tag && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            if (!bulkTagMode) {
                              setEditingTagId(editingTagId === item.id ? null : item.id)
                              setEditTagValue(item.tag ?? '')
                              setShowEditCustom(false)
                              setCustomTag('')
                            }
                          }}
                          className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${tagColor(item.tag)} ${!bulkTagMode ? 'cursor-pointer hover:opacity-70' : 'cursor-default'}`}
                        >
                          {item.tag}
                        </button>
                      )}
                      {/* Add tag link for untagged */}
                      {isParties && !item.tag && !bulkTagMode && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setEditingTagId(editingTagId === item.id ? null : item.id)
                            setEditTagValue('')
                            setShowEditCustom(false)
                            setCustomTag('')
                          }}
                          className="text-[10px] text-gray-400 dark:text-gray-500 hover:text-indigo-500 dark:hover:text-indigo-400 transition"
                        >
                          + tag
                        </button>
                      )}
                    </div>

                    {/* Individual tag editor */}
                    {isParties && editingTagId === item.id && !bulkTagMode && (
                      <div className="mt-2 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-3 space-y-2">
                        <div className="flex gap-1.5 flex-wrap">
                          {PREDEFINED_TAGS.map(t => (
                            <button
                              key={t}
                              onClick={() => { setEditTagValue(t); setShowEditCustom(false) }}
                              className={`text-xs px-2.5 py-1 rounded-full border transition ${
                                editTagValue === t && !showEditCustom
                                  ? 'bg-indigo-600 text-white border-indigo-600'
                                  : `${tagColor(t)} hover:opacity-80`
                              }`}
                            >
                              {t}
                            </button>
                          ))}
                          {/* Show tags that exist but aren't predefined */}
                          {uniqueTags.filter(t => !PREDEFINED_TAGS.includes(t)).map(t => (
                            <button
                              key={t}
                              onClick={() => { setEditTagValue(t); setShowEditCustom(false) }}
                              className={`text-xs px-2.5 py-1 rounded-full border transition ${
                                editTagValue === t && !showEditCustom
                                  ? 'bg-indigo-600 text-white border-indigo-600'
                                  : `${tagColor(t)} hover:opacity-80`
                              }`}
                            >
                              {t}
                            </button>
                          ))}
                          <button
                            onClick={() => { setShowEditCustom(true); setEditTagValue('') }}
                            className={`text-xs px-2.5 py-1 rounded-full border transition ${
                              showEditCustom
                                ? 'bg-indigo-600 text-white border-indigo-600'
                                : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'
                            }`}
                          >
                            New Tag...
                          </button>
                        </div>
                        {showEditCustom && (
                          <input
                            type="text"
                            className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
                            placeholder="Type custom tag..."
                            value={customTag}
                            onChange={e => setCustomTag(e.target.value)}
                            autoFocus
                          />
                        )}
                        <div className="flex gap-2">
                          <button
                            onClick={() => saveIndividualTag(item.id)}
                            disabled={savingTag || (!editTagValue && !customTag.trim())}
                            className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-indigo-700 disabled:opacity-50"
                          >
                            {savingTag ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            onClick={() => { setEditingTagId(null); setShowEditCustom(false); setCustomTag('') }}
                            className="bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-3 py-1.5 rounded-lg text-xs hover:bg-gray-200 dark:hover:bg-gray-600"
                          >
                            Cancel
                          </button>
                          {item.tag && (
                            <button
                              onClick={async () => {
                                setSavingTag(true)
                                try {
                                  const res = await fetch(`/api/masters/parties`, {
                                    method: 'PATCH',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ ids: [item.id], tag: null }),
                                  })
                                  if (res.ok) {
                                    setItems(prev => prev.map(i => i.id === item.id ? { ...i, tag: null } : i))
                                    setEditingTagId(null)
                                  }
                                } finally { setSavingTag(false) }
                              }}
                              disabled={savingTag}
                              className="ml-auto text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                            >
                              Remove tag
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  {!bulkTagMode && (
                    <button
                      onClick={() => handleDelete(item.id)}
                      className="text-xs text-red-400 hover:text-red-600 transition shrink-0"
                    >
                      Delete
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <p className="text-xs text-gray-400 mt-3">
        {filteredItems.length}{tagFilter !== null ? ` of ${items.length}` : ''} {label.toLowerCase()}
      </p>

      {/* Bulk tag sticky footer */}
      {isParties && bulkTagMode && bulkSelected.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-white dark:bg-gray-900 border-t border-indigo-200 dark:border-indigo-800 px-4 py-4 shadow-xl">
          <div className="max-w-2xl mx-auto">
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-3">
              {bulkSelected.size} {bulkSelected.size === 1 ? 'party' : 'parties'} selected
            </p>
            <div className="flex gap-2 flex-wrap mb-3">
              {PREDEFINED_TAGS.map(t => (
                <button
                  key={t}
                  onClick={() => { setBulkTag(t); setShowCustomTag(false) }}
                  className={`text-xs px-3 py-1.5 rounded-full border transition ${
                    bulkTag === t && !showCustomTag
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : `${tagColor(t)} hover:opacity-80`
                  }`}
                >
                  {t}
                </button>
              ))}
              {uniqueTags.filter(t => !PREDEFINED_TAGS.includes(t)).map(t => (
                <button
                  key={t}
                  onClick={() => { setBulkTag(t); setShowCustomTag(false) }}
                  className={`text-xs px-3 py-1.5 rounded-full border transition ${
                    bulkTag === t && !showCustomTag
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : `${tagColor(t)} hover:opacity-80`
                  }`}
                >
                  {t}
                </button>
              ))}
              <button
                onClick={() => { setShowCustomTag(true); setBulkTag('') }}
                className={`text-xs px-3 py-1.5 rounded-full border transition ${
                  showCustomTag
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                New Tag...
              </button>
            </div>
            {showCustomTag && (
              <input
                type="text"
                className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                placeholder="Type custom tag name..."
                value={customTag}
                onChange={e => setCustomTag(e.target.value)}
                autoFocus
              />
            )}
            <div className="flex gap-3">
              <button
                onClick={() => { setBulkTagMode(false); setBulkSelected(new Set()) }}
                className="px-4 py-2 rounded-lg text-sm border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={applyBulkTag}
                disabled={savingTag || (!bulkTag && !customTag.trim())}
                className="flex-1 bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition"
              >
                {savingTag ? 'Applying...' : `Apply "${showCustomTag ? customTag.trim() : bulkTag}" to ${bulkSelected.size} ${bulkSelected.size === 1 ? 'party' : 'parties'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation dialog */}
      {confirmSuggestions && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-md w-full p-6">
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-1">Similar names found</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              You are adding <strong>&quot;{pendingName}&quot;</strong>. These similar entries already exist:
            </p>
            <div className="flex flex-col gap-2 mb-5">
              {confirmSuggestions.map(s => (
                <div key={s.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600">
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{s.name}</span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${scoreColor(s.score)}`}>
                    {s.score}% match
                  </span>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => { setConfirmSuggestions(null); setPendingName(''); setNewName('') }}
                className="w-full px-4 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700"
              >
                Cancel -- use an existing name
              </button>
              <button
                onClick={() => submitName(pendingName, true)}
                disabled={adding}
                className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
              >
                {adding ? 'Saving...' : `Save anyway as "${pendingName}"`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
