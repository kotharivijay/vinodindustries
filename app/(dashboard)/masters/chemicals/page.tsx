'use client'

import { useState, useEffect, useMemo } from 'react'

const UNITS = ['kg', 'liter', 'gram', 'ml', 'piece', 'bag', 'drum']

interface PriceHistory {
  id: number
  price: number
  source: string
  note: string | null
  date: string
}

interface Chemical {
  id: number
  name: string
  unit: string
  currentPrice: number | null
  updatedAt: string
  priceHistory: PriceHistory[]
}

// ─── Import Modal ─────────────────────────────────────────────────────────────

function ImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [text, setText] = useState('')
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ results: { name: string; status: string }[] } | null>(null)
  const [error, setError] = useState('')

  const preview = useMemo(() => {
    return text
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const parts = line.split(/,|\t/).map(p => p.trim())
        const name = parts[0] ?? ''
        const second = parts[1] ?? ''
        const third = parts[2] ?? ''
        // Detect: name, price  or  name, unit, price
        const secondNum = parseFloat(second)
        if (!isNaN(secondNum) && third === '') {
          return { name, unit: 'kg', price: secondNum }
        }
        const thirdNum = parseFloat(third)
        if (!isNaN(thirdNum)) {
          return { name, unit: second || 'kg', price: thirdNum }
        }
        return { name, unit: second || 'kg', price: null }
      })
      .filter(r => r.name.length > 0)
  }, [text])

  async function handleImport() {
    setImporting(true); setError('')
    const res = await fetch('/api/chemicals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: preview }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Import failed'); setImporting(false); return }
    setResult(data)
    onImported()
    setImporting(false)
  }

  const created = result?.results.filter(r => r.status === 'created').length ?? 0
  const updated = result?.results.filter(r => r.status === 'updated').length ?? 0
  const skipped = result?.results.filter(r => r.status === 'skipped').length ?? 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-bold text-gray-800">Import Chemicals</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        <div className="flex-1 overflow-auto px-6 py-4">
          {!result ? (
            <>
              <p className="text-sm text-gray-600 mb-1 font-medium">Paste chemical data (one per line):</p>
              <p className="text-xs text-gray-400 mb-3">
                Formats accepted:<br />
                <code className="bg-gray-100 px-1 rounded">Name, Price</code> — unit defaults to kg<br />
                <code className="bg-gray-100 px-1 rounded">Name, Unit, Price</code><br />
                <code className="bg-gray-100 px-1 rounded">Name</code> — adds without price
              </p>
              <textarea
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400 min-h-[160px] resize-y"
                placeholder={"Soda Ash, 25.50\nHydrogen Peroxide, liter, 45\nCaustic Soda, kg, 22\nSalt"}
                value={text}
                onChange={e => setText(e.target.value)}
              />

              {preview.length > 0 && (
                <div className="mt-3 border rounded-lg overflow-auto max-h-48">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-3 py-2 text-left">Name</th>
                        <th className="px-3 py-2 text-left">Unit</th>
                        <th className="px-3 py-2 text-right">Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((r, i) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="px-3 py-1.5 font-medium">{r.name}</td>
                          <td className="px-3 py-1.5 text-gray-500">{r.unit}</td>
                          <td className="px-3 py-1.5 text-right text-gray-600">{r.price != null ? `₹${r.price}` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {error && <p className="text-red-500 text-sm mt-3">{error}</p>}
            </>
          ) : (
            <div className="py-4">
              <div className="text-center mb-6">
                <div className="text-5xl mb-3">✅</div>
                <p className="text-xl font-bold text-gray-800">Import Complete</p>
              </div>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="border rounded-lg p-3 text-center bg-green-50 border-green-200">
                  <div className="text-2xl font-bold text-green-700">{created}</div>
                  <div className="text-xs text-green-600 mt-0.5">Created</div>
                </div>
                <div className="border rounded-lg p-3 text-center bg-blue-50 border-blue-200">
                  <div className="text-2xl font-bold text-blue-700">{updated}</div>
                  <div className="text-xs text-blue-600 mt-0.5">Price Updated</div>
                </div>
                <div className="border rounded-lg p-3 text-center bg-gray-50 border-gray-200">
                  <div className="text-2xl font-bold text-gray-500">{skipped}</div>
                  <div className="text-xs text-gray-400 mt-0.5">Skipped</div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t flex justify-between items-center">
          <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700">
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result && (
            <button
              onClick={handleImport}
              disabled={preview.length === 0 || importing}
              className="bg-indigo-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {importing ? 'Importing...' : `Import ${preview.length} Chemicals`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Price Update Modal ────────────────────────────────────────────────────────

function PriceModal({ chemical, onClose, onUpdated }: {
  chemical: Chemical
  onClose: () => void
  onUpdated: (c: Chemical) => void
}) {
  const [price, setPrice] = useState(chemical.currentPrice?.toString() ?? '')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    if (!price || isNaN(parseFloat(price))) { setError('Enter a valid price'); return }
    setSaving(true); setError('')
    const res = await fetch(`/api/chemicals/${chemical.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ price: parseFloat(price), note: note || null }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Failed'); setSaving(false); return }
    onUpdated(data)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <h2 className="text-base font-bold text-gray-800 mb-1">Update Price</h2>
        <p className="text-sm text-gray-500 mb-4">{chemical.name} ({chemical.unit})</p>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">New Price (₹ per {chemical.unit})</label>
            <input
              type="number"
              step="0.01"
              min="0"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              value={price}
              onChange={e => { setPrice(e.target.value); setError('') }}
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Note (optional)</label>
            <input
              type="text"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              placeholder="e.g. Price as per invoice #123"
              value={note}
              onChange={e => setNote(e.target.value)}
            />
          </div>
        </div>

        {error && <p className="text-red-500 text-sm mt-2">{error}</p>}

        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 border border-gray-300 text-gray-600 rounded-lg py-2 text-sm hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving} className="flex-1 bg-indigo-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
            {saving ? 'Saving...' : 'Save Price'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── History Panel ─────────────────────────────────────────────────────────────

function HistoryPanel({ chemical }: { chemical: Chemical }) {
  const fmt = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
  return (
    <div className="mt-2 bg-gray-50 rounded-lg border border-gray-200 overflow-hidden">
      <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide border-b bg-white">Price History</div>
      {chemical.priceHistory.length === 0 ? (
        <p className="text-xs text-gray-400 px-3 py-2">No history yet.</p>
      ) : (
        <table className="w-full text-xs">
          <tbody>
            {chemical.priceHistory.map(h => (
              <tr key={h.id} className="border-b last:border-0">
                <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">{fmt(h.date)}</td>
                <td className="px-3 py-1.5 font-medium text-gray-800">₹{h.price}/{chemical.unit}</td>
                <td className="px-3 py-1.5">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${h.source === 'inward_sheet' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                    {h.source === 'inward_sheet' ? 'Inward Sheet' : 'Manual'}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-gray-400">{h.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function ChemicalsPage() {
  const [chemicals, setChemicals] = useState<Chemical[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [priceModal, setPriceModal] = useState<Chemical | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  // Add form state
  const [newName, setNewName] = useState('')
  const [newUnit, setNewUnit] = useState('kg')
  const [newPrice, setNewPrice] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')

  useEffect(() => { loadChemicals() }, [])

  async function loadChemicals() {
    setLoading(true)
    const res = await fetch('/api/chemicals')
    const data = await res.json()
    setChemicals(data)
    setLoading(false)
  }

  const filtered = useMemo(() =>
    chemicals.filter(c => c.name.toLowerCase().includes(search.toLowerCase())),
    [chemicals, search]
  )

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setAdding(true); setAddError('')
    const res = await fetch('/api/chemicals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim(), unit: newUnit, price: newPrice ? parseFloat(newPrice) : null }),
    })
    const data = await res.json()
    if (!res.ok) { setAddError(data.error ?? 'Failed'); setAdding(false); return }
    setChemicals(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
    setNewName(''); setNewPrice(''); setNewUnit('kg'); setShowAdd(false)
    setAdding(false)
  }

  async function handleDelete(id: number, name: string) {
    if (!confirm(`Delete "${name}"? This will also remove all price history.`)) return
    const res = await fetch(`/api/chemicals/${id}`, { method: 'DELETE' })
    if (res.ok) setChemicals(prev => prev.filter(c => c.id !== id))
    else alert('Cannot delete')
  }

  function handlePriceUpdated(updated: Chemical) {
    setChemicals(prev => prev.map(c => c.id === updated.id ? updated : c))
  }

  const fmt = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

  return (
    <div className="p-4 md:p-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Chemical Master</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage chemicals with price history</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowImport(true)}
            className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50"
          >
            Import
          </button>
          <button
            onClick={() => setShowAdd(v => !v)}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700"
          >
            + Add Chemical
          </button>
        </div>
      </div>

      {/* Add form */}
      {showAdd && (
        <form onSubmit={handleAdd} className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 mt-4 mb-2">
          <p className="text-sm font-semibold text-indigo-800 mb-3">New Chemical</p>
          <div className="flex flex-wrap gap-3">
            <input
              type="text"
              required
              className="flex-1 min-w-[160px] border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              placeholder="Chemical name"
              value={newName}
              onChange={e => { setNewName(e.target.value); setAddError('') }}
              autoFocus
            />
            <select
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              value={newUnit}
              onChange={e => setNewUnit(e.target.value)}
            >
              {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
            <input
              type="number"
              step="0.01"
              min="0"
              className="w-32 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              placeholder="Price (₹)"
              value={newPrice}
              onChange={e => setNewPrice(e.target.value)}
            />
            <button
              type="submit"
              disabled={adding}
              className="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-60"
            >
              {adding ? 'Saving...' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => setShowAdd(false)}
              className="text-sm text-gray-500 hover:text-gray-700 px-2"
            >
              Cancel
            </button>
          </div>
          {addError && <p className="text-red-500 text-sm mt-2">{addError}</p>}
        </form>
      )}

      {/* Search */}
      <div className="mt-4 mb-3">
        <input
          type="text"
          className="w-full max-w-sm border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          placeholder="Search chemicals..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            {search ? 'No chemicals match your search.' : 'No chemicals added yet. Click "Import" or "+ Add Chemical" to get started.'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">#</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Chemical Name</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Unit</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Current Price</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide hidden sm:table-cell">Updated</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((c, i) => (
                <>
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-400 text-xs">{i + 1}</td>
                    <td className="px-4 py-3 font-medium text-gray-800">{c.name}</td>
                    <td className="px-4 py-3 text-gray-500">{c.unit}</td>
                    <td className="px-4 py-3 text-right">
                      {c.currentPrice != null
                        ? <span className="font-semibold text-gray-800">₹{c.currentPrice.toFixed(2)}</span>
                        : <span className="text-gray-400 text-xs">Not set</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs hidden sm:table-cell">{fmt(c.updatedAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setPriceModal(c)}
                          className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                        >
                          Update Price
                        </button>
                        <button
                          onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                          className="text-xs text-gray-500 hover:text-gray-700"
                        >
                          {expandedId === c.id ? 'Hide' : 'History'}
                        </button>
                        <button
                          onClick={() => handleDelete(c.id, c.name)}
                          className="text-xs text-red-400 hover:text-red-600"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expandedId === c.id && (
                    <tr key={`hist-${c.id}`}>
                      <td colSpan={6} className="px-4 pb-3">
                        <HistoryPanel chemical={c} />
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-gray-400 mt-3">{filtered.length} of {chemicals.length} chemicals</p>

      {/* Modals */}
      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onImported={() => { loadChemicals(); setShowImport(false) }}
        />
      )}
      {priceModal && (
        <PriceModal
          chemical={priceModal}
          onClose={() => setPriceModal(null)}
          onUpdated={handlePriceUpdated}
        />
      )}
    </div>
  )
}
