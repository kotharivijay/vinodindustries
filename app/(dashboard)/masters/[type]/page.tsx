'use client'

import { useState, useEffect, use } from 'react'

const LABELS: Record<string, string> = {
  parties: 'Parties',
  qualities: 'Qualities',
  weavers: 'Weavers',
  transports: 'Transports',
}

interface Item { id: number; name: string; createdAt: string }

export default function MasterPage({ params }: { params: Promise<{ type: string }> }) {
  const { type } = use(params)
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')

  const label = LABELS[type] ?? type

  useEffect(() => {
    fetch(`/api/masters/${type}`)
      .then((r) => r.json())
      .then((d) => { setItems(d); setLoading(false) })
  }, [type])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setAdding(true); setError('')
    const res = await fetch(`/api/masters/${type}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() }),
    })
    const data = await res.json()
    if (res.ok) {
      setItems((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
      setNewName('')
    } else {
      setError(data.error ?? 'Failed to add')
    }
    setAdding(false)
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

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-800 mb-1">{label}</h1>
      <p className="text-sm text-gray-500 mb-6">Manage {label.toLowerCase()} used in dropdown lists</p>

      {/* Add form */}
      <form onSubmit={handleAdd} className="flex gap-3 mb-6">
        <input
          type="text"
          className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          placeholder={`Add new ${label.toLowerCase().replace(/s$/, '')}...`}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button
          type="submit"
          disabled={adding}
          className="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-60"
        >
          {adding ? 'Adding...' : '+ Add'}
        </button>
      </form>
      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

      {/* List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        {loading ? (
          <div className="p-8 text-center text-gray-400">Loading...</div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-gray-400">No {label.toLowerCase()} added yet.</div>
        ) : (
          <ul className="divide-y">
            {items.map((item) => (
              <li key={item.id} className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-gray-800">{item.name}</span>
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
    </div>
  )
}
