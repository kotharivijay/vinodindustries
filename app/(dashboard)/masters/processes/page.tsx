'use client'

import { useState, useEffect } from 'react'
import BackButton from '../../BackButton'

interface ChemicalMaster {
  id: number
  name: string
  unit: string
  currentPrice: number | null
}

interface ProcessItem {
  id: number
  chemicalId: number
  quantity: number
  quantityHigh: number | null
  chemical: { id: number; name: string; unit: string }
}

interface DyeingProcess {
  id: number
  name: string
  description: string | null
  threshold: number
  items: ProcessItem[]
}

export default function ProcessMasterPage() {
  const [processes, setProcesses] = useState<DyeingProcess[]>([])
  const [chemicals, setChemicals] = useState<ChemicalMaster[]>([])
  const [loading, setLoading] = useState(true)

  // New process form
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newThreshold, setNewThreshold] = useState('220')
  const [newItems, setNewItems] = useState<{ chemicalId: number | null; quantity: string; quantityHigh: string; search: string }[]>([])
  const [saving, setSaving] = useState(false)

  // Edit state
  const [editId, setEditId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editThreshold, setEditThreshold] = useState('220')
  const [editItems, setEditItems] = useState<{ chemicalId: number | null; quantity: string; quantityHigh: string; search: string }[]>([])
  const [editSaving, setEditSaving] = useState(false)

  // Chemical dropdown
  const [dropdownIdx, setDropdownIdx] = useState<number | null>(null)
  const [dropdownContext, setDropdownContext] = useState<'new' | 'edit'>('new')

  useEffect(() => {
    Promise.all([
      fetch('/api/dyeing/processes').then(r => r.json()),
      fetch('/api/chemicals').then(r => r.json()).catch(() => []),
    ]).then(([processData, chemData]) => {
      setProcesses(Array.isArray(processData) ? processData : [])
      setChemicals(Array.isArray(chemData) ? chemData : [])
      setLoading(false)
    })
  }, [])

  function addNewRow() {
    setNewItems(prev => [...prev, { chemicalId: null, quantity: '', quantityHigh: '', search: '' }])
  }

  async function handleCreate() {
    if (!newName.trim()) return
    setSaving(true)
    try {
      const res = await fetch('/api/dyeing/processes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          description: newDesc.trim() || undefined,
          threshold: parseFloat(newThreshold) || 220,
          items: newItems.filter(i => i.chemicalId && parseFloat(i.quantity) > 0).map(i => ({
            chemicalId: i.chemicalId!,
            quantity: parseFloat(i.quantity),
            quantityHigh: i.quantityHigh ? parseFloat(i.quantityHigh) : null,
          })),
        }),
      })
      if (res.ok) {
        const created = await res.json()
        setProcesses(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
        setNewName('')
        setNewDesc('')
        setNewThreshold('220')
        setNewItems([])
      } else {
        const err = await res.json()
        alert(err.error || 'Failed to create')
      }
    } finally {
      setSaving(false)
    }
  }

  function startEdit(p: DyeingProcess) {
    setEditId(p.id)
    setEditName(p.name)
    setEditDesc(p.description || '')
    setEditThreshold(String(p.threshold ?? 220))
    setEditItems(p.items.map(i => ({
      chemicalId: i.chemicalId,
      quantity: String(i.quantity),
      quantityHigh: i.quantityHigh != null ? String(i.quantityHigh) : '',
      search: i.chemical.name,
    })))
  }

  async function handleUpdate() {
    if (!editId || !editName.trim()) return
    setEditSaving(true)
    try {
      const res = await fetch(`/api/dyeing/processes/${editId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          description: editDesc.trim() || undefined,
          threshold: parseFloat(editThreshold) || 220,
          items: editItems.filter(i => i.chemicalId && parseFloat(i.quantity) > 0).map(i => ({
            chemicalId: i.chemicalId!,
            quantity: parseFloat(i.quantity),
            quantityHigh: i.quantityHigh ? parseFloat(i.quantityHigh) : null,
          })),
        }),
      })
      if (res.ok) {
        const updated = await res.json()
        setProcesses(prev => prev.map(p => p.id === editId ? updated : p))
        setEditId(null)
      } else {
        const err = await res.json()
        alert(err.error || 'Failed to update')
      }
    } finally {
      setEditSaving(false)
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this process?')) return
    const res = await fetch(`/api/dyeing/processes/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setProcesses(prev => prev.filter(p => p.id !== id))
      if (editId === id) setEditId(null)
    }
  }

  function ChemDropdown({ items, setItems, idx, context }: {
    items: { chemicalId: number | null; quantity: string; quantityHigh: string; search: string }[]
    setItems: React.Dispatch<React.SetStateAction<typeof items>>
    idx: number
    context: 'new' | 'edit'
  }) {
    const searchVal = items[idx]?.search || ''
    const filtered = chemicals.filter(c => c.name.toLowerCase().includes(searchVal.toLowerCase())).slice(0, 10)

    return (
      <div className="relative">
        <input
          type="text"
          value={searchVal}
          placeholder="Search chemical..."
          className="w-full bg-gray-800 border border-gray-600 text-gray-100 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
          onChange={e => {
            const val = e.target.value
            setItems(prev => {
              const u = [...prev]
              u[idx] = { ...u[idx], search: val }
              return u
            })
            setDropdownIdx(idx)
            setDropdownContext(context)
          }}
          onFocus={() => { setDropdownIdx(idx); setDropdownContext(context) }}
        />
        {dropdownIdx === idx && dropdownContext === context && filtered.length > 0 && (
          <div className="absolute z-50 w-full bg-gray-800 border border-gray-600 rounded-lg mt-1 max-h-48 overflow-y-auto shadow-xl">
            {filtered.map(c => (
              <button
                key={c.id}
                className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-purple-900/40"
                onClick={() => {
                  setItems(prev => {
                    const u = [...prev]
                    u[idx] = { ...u[idx], chemicalId: c.id, search: c.name }
                    return u
                  })
                  setDropdownIdx(null)
                }}
              >
                {c.name} <span className="text-gray-500 text-xs">({c.unit})</span>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (loading) return <div className="p-8 text-gray-400">Loading...</div>

  return (
    <div className="p-4 md:p-8 max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <BackButton />
        <h1 className="text-2xl font-bold text-white">Process Master</h1>
      </div>

      {/* Add New Process */}
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-200 mb-3">Add New Process</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
          <input
            type="text"
            placeholder="Process name"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            className="bg-gray-900 border border-gray-600 text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
          <input
            type="text"
            placeholder="Description (optional)"
            value={newDesc}
            onChange={e => setNewDesc(e.target.value)}
            className="bg-gray-900 border border-gray-600 text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400 whitespace-nowrap">Threshold</label>
            <input
              type="number"
              step="1"
              value={newThreshold}
              onChange={e => setNewThreshold(e.target.value)}
              className="w-20 bg-gray-900 border border-gray-600 text-gray-100 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
            <span className="text-xs text-gray-500">kg</span>
          </div>
        </div>

        {newItems.length > 0 && (
          <div className="flex gap-2 mb-2 text-xs text-gray-400 px-1">
            <span className="flex-1">Chemical</span>
            <span className="w-24 text-center">{`\u2264 ${newThreshold || 220}`} kg</span>
            <span className="w-24 text-center">{`> ${newThreshold || 220}`} kg</span>
            <span className="w-6" />
          </div>
        )}
        {newItems.map((item, idx) => (
          <div key={idx} className="flex gap-2 mb-2 items-center">
            <div className="flex-1">
              <ChemDropdown items={newItems} setItems={setNewItems} idx={idx} context="new" />
            </div>
            <input
              type="number"
              step="0.01"
              placeholder="Qty"
              value={item.quantity}
              onChange={e => {
                const val = e.target.value
                setNewItems(prev => {
                  const u = [...prev]
                  u[idx] = { ...u[idx], quantity: val }
                  return u
                })
              }}
              className="w-24 bg-gray-800 border border-gray-600 text-gray-100 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
            />
            <input
              type="number"
              step="0.01"
              placeholder="Qty (high)"
              value={item.quantityHigh}
              onChange={e => {
                const val = e.target.value
                setNewItems(prev => {
                  const u = [...prev]
                  u[idx] = { ...u[idx], quantityHigh: val }
                  return u
                })
              }}
              className="w-24 bg-gray-800 border border-gray-600 text-gray-100 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
            />
            <button
              onClick={() => setNewItems(prev => prev.filter((_, i) => i !== idx))}
              className="text-red-400 hover:text-red-300 text-sm px-2"
            >
              X
            </button>
          </div>
        ))}

        <div className="flex gap-2 mt-3">
          <button onClick={addNewRow} className="text-xs text-purple-400 hover:text-purple-300 border border-purple-700 rounded px-3 py-1.5">
            + Add Chemical
          </button>
          <button
            onClick={handleCreate}
            disabled={saving || !newName.trim()}
            className="bg-purple-600 text-white text-xs font-medium rounded px-4 py-1.5 hover:bg-purple-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Create Process'}
          </button>
        </div>
      </div>

      {/* Process List */}
      <div className="space-y-4">
        {processes.map(p => (
          <div key={p.id} className="bg-gray-800 rounded-xl border border-gray-700 p-5">
            {editId === p.id ? (
              /* Edit mode */
              <div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                  <input
                    type="text"
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    className="bg-gray-900 border border-gray-600 text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                  <input
                    type="text"
                    placeholder="Description"
                    value={editDesc}
                    onChange={e => setEditDesc(e.target.value)}
                    className="bg-gray-900 border border-gray-600 text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-400 whitespace-nowrap">Threshold</label>
                    <input
                      type="number"
                      step="1"
                      value={editThreshold}
                      onChange={e => setEditThreshold(e.target.value)}
                      className="w-20 bg-gray-900 border border-gray-600 text-gray-100 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                    <span className="text-xs text-gray-500">kg</span>
                  </div>
                </div>

                {editItems.length > 0 && (
                  <div className="flex gap-2 mb-2 text-xs text-gray-400 px-1">
                    <span className="flex-1">Chemical</span>
                    <span className="w-24 text-center">{`\u2264 ${editThreshold || 220}`} kg</span>
                    <span className="w-24 text-center">{`> ${editThreshold || 220}`} kg</span>
                    <span className="w-6" />
                  </div>
                )}
                {editItems.map((item, idx) => (
                  <div key={idx} className="flex gap-2 mb-2 items-center">
                    <div className="flex-1">
                      <ChemDropdown items={editItems} setItems={setEditItems} idx={idx} context="edit" />
                    </div>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Qty"
                      value={item.quantity}
                      onChange={e => {
                        const val = e.target.value
                        setEditItems(prev => {
                          const u = [...prev]
                          u[idx] = { ...u[idx], quantity: val }
                          return u
                        })
                      }}
                      className="w-24 bg-gray-800 border border-gray-600 text-gray-100 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
                    />
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Qty (high)"
                      value={item.quantityHigh}
                      onChange={e => {
                        const val = e.target.value
                        setEditItems(prev => {
                          const u = [...prev]
                          u[idx] = { ...u[idx], quantityHigh: val }
                          return u
                        })
                      }}
                      className="w-24 bg-gray-800 border border-gray-600 text-gray-100 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
                    />
                    <button
                      onClick={() => setEditItems(prev => prev.filter((_, i) => i !== idx))}
                      className="text-red-400 hover:text-red-300 text-sm px-2"
                    >
                      X
                    </button>
                  </div>
                ))}

                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => setEditItems(prev => [...prev, { chemicalId: null, quantity: '', quantityHigh: '', search: '' }])}
                    className="text-xs text-purple-400 hover:text-purple-300 border border-purple-700 rounded px-3 py-1.5"
                  >
                    + Add Chemical
                  </button>
                  <button
                    onClick={handleUpdate}
                    disabled={editSaving}
                    className="bg-green-600 text-white text-xs font-medium rounded px-4 py-1.5 hover:bg-green-700 disabled:opacity-50"
                  >
                    {editSaving ? 'Saving...' : 'Save'}
                  </button>
                  <button onClick={() => setEditId(null)} className="text-xs text-gray-400 hover:text-gray-200 border border-gray-600 rounded px-3 py-1.5">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              /* View mode */
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-base font-semibold text-white">{p.name}</h3>
                    <div className="flex items-center gap-3 mt-0.5">
                      {p.description && <span className="text-xs text-gray-400">{p.description}</span>}
                      <span className="text-xs text-gray-500">Threshold: {p.threshold ?? 220} kg</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => startEdit(p)} className="text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-700 rounded px-2 py-1">
                      Edit
                    </button>
                    <button onClick={() => handleDelete(p.id)} className="text-xs text-red-400 hover:text-red-300 border border-red-800 rounded px-2 py-1">
                      Delete
                    </button>
                  </div>
                </div>
                {p.items.length > 0 ? (
                  <div className="space-y-1.5">
                    {p.items.some(i => i.quantityHigh != null) && (
                      <div className="flex items-center text-xs text-gray-500 px-3">
                        <span className="flex-1" />
                        <span className="w-24 text-right">{`\u2264 ${p.threshold ?? 220}`} kg</span>
                        <span className="w-24 text-right">{`> ${p.threshold ?? 220}`} kg</span>
                      </div>
                    )}
                    {p.items.map(item => (
                      <div key={item.id} className="flex items-center bg-gray-900 rounded-lg px-3 py-2">
                        <span className="text-sm text-gray-200 flex-1">{item.chemical.name}</span>
                        <span className="text-sm text-purple-400 font-medium w-24 text-right">{item.quantity} {item.chemical.unit}</span>
                        {p.items.some(i => i.quantityHigh != null) && (
                          <span className="text-sm font-medium w-24 text-right">
                            {item.quantityHigh != null ? (
                              <span className="text-orange-400">{item.quantityHigh} {item.chemical.unit}</span>
                            ) : (
                              <span className="text-gray-600">--</span>
                            )}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-500 italic">No chemicals defined</p>
                )}
              </div>
            )}
          </div>
        ))}
        {processes.length === 0 && (
          <p className="text-center text-gray-500 py-8">No processes yet. Create one above.</p>
        )}
      </div>
    </div>
  )
}
