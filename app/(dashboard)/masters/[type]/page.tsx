'use client'

import { useState, useEffect, use, useMemo } from 'react'
import { findSimilar } from '@/lib/nameUtils'

const LABELS: Record<string, string> = {
  parties: 'Parties',
  qualities: 'Qualities',
  weavers: 'Weavers',
  transports: 'Transports',
}

interface Item { id: number; name: string; createdAt: string }
interface Suggestion { id: number; name: string; score: number }

export default function MasterPage({ params }: { params: Promise<{ type: string }> }) {
  const { type } = use(params)
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')

  const [confirmSuggestions, setConfirmSuggestions] = useState<Suggestion[] | null>(null)
  const [pendingName, setPendingName] = useState('')

  const label = LABELS[type] ?? type
  const singular = label.toLowerCase().replace(/s$/, '')

  useEffect(() => {
    fetch(`/api/masters/${type}`)
      .then((r) => r.json())
      .then((d) => { setItems(d); setLoading(false) })
  }, [type])

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

  function scoreColor(score: number) {
    if (score >= 90) return 'text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400'
    if (score >= 75) return 'text-orange-600 bg-orange-50 dark:bg-orange-900/20 dark:text-orange-400'
    return 'text-yellow-700 bg-yellow-50 dark:bg-yellow-900/20 dark:text-yellow-400'
  }

  return (
    <div className="p-4 md:p-8 max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-1">{label}</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Manage {label.toLowerCase()} used in dropdown lists</p>

      {/* Add form */}
      <form onSubmit={handleAdd} className="flex gap-3 mb-2">
        <div className="flex-1 relative">
          <input
            type="text"
            className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
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
          <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-2">⚠ Similar names already exist — did you mean one of these?</p>
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

      {/* List */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
        {loading ? (
          <div className="p-8 text-center text-gray-400">Loading...</div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-gray-400">No {label.toLowerCase()} added yet.</div>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
            {items.map((item) => (
              <li key={item.id} className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-gray-800 dark:text-gray-200">{item.name}</span>
                <button
                  onClick={() => handleDelete(item.id)}
                  className="text-xs text-red-400 hover:text-red-600 transition"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-xs text-gray-400 mt-3">{items.length} {label.toLowerCase()}</p>

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
                Cancel — use an existing name
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
