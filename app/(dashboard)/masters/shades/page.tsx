'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface Shade { id: number; name: string; createdAt: string }

export default function ShadesPage() {
  const router = useRouter()
  const { data: items, isLoading, mutate } = useSWR<Shade[]>('/api/shades', fetcher)
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  async function add() {
    if (!newName.trim()) return
    setAdding(true)
    setError('')
    try {
      const res = await fetch('/api/shades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed'); return }
      setNewName('')
      mutate()
    } finally {
      setAdding(false)
    }
  }

  async function remove(id: number, name: string) {
    if (!confirm(`Delete shade "${name}"?`)) return
    const res = await fetch(`/api/shades?id=${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const d = await res.json()
      alert(d.error ?? 'Failed to delete')
      return
    }
    mutate()
  }

  const filtered = (items ?? []).filter(i => i.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="p-4 md:p-8 max-w-lg">
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 rounded-lg px-4 py-2 text-sm font-medium transition">
          &larr; Back
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-800">Shades</h1>
          <p className="text-sm text-gray-500">{items?.length ?? 0} shades</p>
        </div>
      </div>

      {/* Add form */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
        <div className="flex gap-2">
          <input
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            placeholder="Shade name..."
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && add()}
          />
          <button
            onClick={add}
            disabled={adding || !newName.trim()}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {adding ? '...' : 'Add'}
          </button>
        </div>
        {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
      </div>

      <input
        type="text"
        placeholder="Search..."
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-400"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      {isLoading ? (
        <div className="text-gray-400 text-sm">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center text-gray-400 py-12">No shades found</div>
      ) : (
        <div className="space-y-1">
          {filtered.map(item => (
            <div key={item.id} className="bg-white rounded-lg border border-gray-100 px-4 py-3 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-800">{item.name}</span>
              <button
                onClick={() => remove(item.id, item.name)}
                className="text-xs text-red-500 hover:text-red-700"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
