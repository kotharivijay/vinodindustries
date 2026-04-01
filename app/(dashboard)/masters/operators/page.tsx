'use client'

import { useState, useEffect } from 'react'
import BackButton from '../../BackButton'

interface Operator {
  id: number
  name: string
  mobileNo: string | null
  isActive: boolean
}

export default function OperatorsPage() {
  const [operators, setOperators] = useState<Operator[]>([])
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState<number | null>(null)

  // New operator form
  const [name, setName] = useState('')
  const [mobileNo, setMobileNo] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/dyeing/operators')
      .then(r => r.json())
      .then(d => { setOperators(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  async function addOperator(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    setError('')
    const res = await fetch('/api/dyeing/operators', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), mobileNo: mobileNo.trim() || null }),
    })
    if (res.ok) {
      const op = await res.json()
      setOperators(prev => [...prev, op].sort((a, b) => a.name.localeCompare(b.name)))
      setName('')
      setMobileNo('')
    } else {
      const d = await res.json().catch(() => ({}))
      setError(d.error || 'Failed to add')
    }
    setSaving(false)
  }

  async function toggleActive(op: Operator) {
    setToggling(op.id)
    const res = await fetch('/api/dyeing/operators', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: op.id, isActive: !op.isActive }),
    })
    if (res.ok) {
      const updated = await res.json()
      setOperators(prev => prev.map(x => x.id === updated.id ? updated : x))
    }
    setToggling(null)
  }

  return (
    <div className="p-4 md:p-8">
      <div className="flex items-center gap-3 mb-6">
        <BackButton />
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">Operator Master</h1>
          <p className="text-sm text-gray-400">Manage dyeing operators</p>
        </div>
      </div>

      {/* Add new operator */}
      <form onSubmit={addOperator} className="bg-gray-800 rounded-xl border border-gray-700 p-5 mb-6">
        <h2 className="text-sm font-semibold text-white mb-3">Add New Operator</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <input
            type="text"
            placeholder="Operator name *"
            value={name}
            onChange={e => setName(e.target.value)}
            required
            className="w-full bg-gray-700 border border-gray-600 text-gray-100 placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
          <input
            type="text"
            placeholder="Mobile number"
            value={mobileNo}
            onChange={e => setMobileNo(e.target.value)}
            className="w-full bg-gray-700 border border-gray-600 text-gray-100 placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50"
          >
            {saving ? 'Adding...' : 'Add Operator'}
          </button>
        </div>
        {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
      </form>

      {/* List */}
      <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-500">Loading...</div>
        ) : operators.length === 0 ? (
          <div className="p-12 text-center text-gray-500">No operators yet. Add one above.</div>
        ) : (
          <div className="divide-y divide-gray-700">
            {operators.map(op => (
              <div key={op.id} className="flex items-center justify-between px-5 py-4">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">&#128119;</span>
                  <div>
                    <p className={`text-sm font-semibold ${op.isActive ? 'text-white' : 'text-gray-500'}`}>{op.name}</p>
                    {op.mobileNo && <p className="text-xs text-gray-500">{op.mobileNo}</p>}
                  </div>
                </div>
                <button
                  onClick={() => toggleActive(op)}
                  disabled={toggling === op.id}
                  className={`px-4 py-1.5 rounded-full text-xs font-medium transition disabled:opacity-50 ${
                    op.isActive
                      ? 'bg-green-900/40 text-green-400 border border-green-700 hover:bg-green-900/60'
                      : 'bg-gray-700 text-gray-400 border border-gray-600 hover:bg-gray-600'
                  }`}
                >
                  {op.isActive ? 'Active' : 'Inactive'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
