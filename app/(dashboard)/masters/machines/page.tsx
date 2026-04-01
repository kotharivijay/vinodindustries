'use client'

import { useState, useEffect } from 'react'
import BackButton from '../../BackButton'

interface Machine {
  id: number
  number: number
  name: string
  isActive: boolean
}

export default function MachinesPage() {
  const [machines, setMachines] = useState<Machine[]>([])
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState<number | null>(null)

  useEffect(() => {
    fetch('/api/dyeing/machines')
      .then(r => r.json())
      .then(d => { setMachines(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  async function toggleActive(m: Machine) {
    setToggling(m.id)
    const res = await fetch('/api/dyeing/machines', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: m.id, isActive: !m.isActive }),
    })
    if (res.ok) {
      const updated = await res.json()
      setMachines(prev => prev.map(x => x.id === updated.id ? updated : x))
    }
    setToggling(null)
  }

  return (
    <div className="p-4 md:p-8">
      <div className="flex items-center gap-3 mb-6">
        <BackButton />
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">Machine Master</h1>
          <p className="text-sm text-gray-400">Manage jet dyeing machines</p>
        </div>
      </div>

      <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-500">Loading...</div>
        ) : machines.length === 0 ? (
          <div className="p-12 text-center text-gray-500">No machines found.</div>
        ) : (
          <div className="divide-y divide-gray-700">
            {machines.map(m => (
              <div key={m.id} className="flex items-center justify-between px-5 py-4">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">&#9881;&#65039;</span>
                  <div>
                    <p className={`text-sm font-semibold ${m.isActive ? 'text-white' : 'text-gray-500'}`}>{m.name}</p>
                    <p className="text-xs text-gray-500">Machine #{m.number}</p>
                  </div>
                </div>
                <button
                  onClick={() => toggleActive(m)}
                  disabled={toggling === m.id}
                  className={`px-4 py-1.5 rounded-full text-xs font-medium transition disabled:opacity-50 ${
                    m.isActive
                      ? 'bg-green-900/40 text-green-400 border border-green-700 hover:bg-green-900/60'
                      : 'bg-gray-700 text-gray-400 border border-gray-600 hover:bg-gray-600'
                  }`}
                >
                  {m.isActive ? 'Active' : 'Inactive'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
