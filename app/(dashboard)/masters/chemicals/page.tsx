'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import BackButton from '../../BackButton'

const UNITS = ['kg', 'liter', 'gram', 'ml', 'piece', 'bag', 'drum']

interface PriceHistory { id: number; price: number; source: string; note: string | null; date: string }
interface Chemical { id: number; name: string; unit: string; currentPrice: number | null; updatedAt: string; priceHistory: PriceHistory[]; category: string | null }
interface ProcessItem { chemicalId: number; chemical: { id: number; name: string; unit: string }; quantity: number }
interface DyeingProcess { id: number; name: string; description?: string; items: ProcessItem[] }

// ─── Chemical dropdown (searchable) ──────────────────────────────────────────

function ChemicalDropdown({ value, chemicals, onChange }: {
  value: number | null
  chemicals: Chemical[]
  onChange: (c: Chemical) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = chemicals.find(c => c.id === value)

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const filtered = chemicals.filter(c => c.name.toLowerCase().includes(query.toLowerCase())).slice(0, 40)

  return (
    <div ref={ref} className="relative">
      <input
        type="text"
        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
        placeholder="Search chemical..."
        value={open ? query : (selected?.name ?? '')}
        onFocus={() => { setOpen(true); setQuery('') }}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
      />
      {open && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-44 overflow-y-auto">
          {filtered.length === 0
            ? <p className="px-3 py-2 text-xs text-gray-400">No chemicals found</p>
            : filtered.map(c => (
              <button key={c.id} type="button"
                onMouseDown={e => { e.preventDefault(); onChange(c); setOpen(false); setQuery('') }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 dark:hover:bg-indigo-900/20 ${c.id === value ? 'bg-indigo-50 dark:bg-indigo-900/30 font-medium text-indigo-700' : 'text-gray-800 dark:text-gray-200'}`}
              >
                {c.name} <span className="text-xs text-gray-400">{c.unit}</span>
              </button>
            ))
          }
        </div>
      )}
    </div>
  )
}

// ─── Process Editor (shared between desktop + mobile sheet) ──────────────────

interface DraftItem { chemicalId: number | null; chemical: Chemical | null; quantity: string }

function ProcessEditor({ process, chemicals, onSave, onDelete, onClose, saving, error }: {
  process: DyeingProcess | null
  chemicals: Chemical[]
  onSave: (name: string, description: string, items: DraftItem[]) => void
  onDelete?: () => void
  onClose: () => void
  saving: boolean
  error: string
}) {
  const [name, setName] = useState(process?.name ?? '')
  const [desc, setDesc] = useState(process?.description ?? '')
  const [items, setItems] = useState<DraftItem[]>(
    process?.items.map(i => ({ chemicalId: i.chemical.id, chemical: i.chemical as Chemical, quantity: String(i.quantity) })) ?? []
  )

  const addItem = () => setItems(prev => [...prev, { chemicalId: null, chemical: null, quantity: '' }])
  const removeItem = (i: number) => setItems(prev => prev.filter((_, j) => j !== i))
  const updateItem = (i: number, patch: Partial<DraftItem>) => setItems(prev => prev.map((it, j) => j === i ? { ...it, ...patch } : it))

  return (
    <div className="flex flex-col h-full">
      {/* Editor header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700 shrink-0">
        <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100">{process ? 'Edit Process' : 'New Process'}</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none">×</button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {error && <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded px-3 py-2">{error}</p>}

        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Process Name *</label>
          <input
            type="text"
            autoFocus
            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            placeholder="e.g. Anti-Fungal, Scouring..."
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Description</label>
          <input
            type="text"
            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            placeholder="What this process does..."
            value={desc}
            onChange={e => setDesc(e.target.value)}
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Chemicals</label>
            <button type="button" onClick={addItem} className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 font-medium">+ Add</button>
          </div>

          {items.length === 0 ? (
            <button type="button" onClick={addItem} className="w-full border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-lg py-4 text-xs text-gray-400 hover:border-indigo-300 hover:text-indigo-500 transition">
              + Add first chemical
            </button>
          ) : (
            <div className="space-y-2">
              {items.map((item, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <div className="flex-1">
                    <ChemicalDropdown
                      value={item.chemicalId}
                      chemicals={chemicals}
                      onChange={c => updateItem(i, { chemicalId: c.id, chemical: c })}
                    />
                  </div>
                  <input
                    type="number" step="0.01" min="0"
                    className="w-20 border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    placeholder="Qty"
                    value={item.quantity}
                    onChange={e => updateItem(i, { quantity: e.target.value })}
                  />
                  <span className="text-xs text-gray-400 w-8 shrink-0">{item.chemical?.unit ?? ''}</span>
                  <button type="button" onClick={() => removeItem(i)} className="text-gray-300 hover:text-red-500 text-lg leading-none shrink-0">×</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Summary */}
        {items.filter(i => i.chemicalId && parseFloat(i.quantity) > 0).length > 0 && (
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg px-3 py-2.5 space-y-1">
            {items.filter(i => i.chemicalId && parseFloat(i.quantity) > 0).map((i, idx) => (
              <div key={idx} className="flex justify-between text-xs">
                <span className="text-gray-600 dark:text-gray-300">{i.chemical?.name}</span>
                <span className="font-medium text-gray-800 dark:text-gray-200">{i.quantity} {i.chemical?.unit}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 shrink-0">
        {onDelete
          ? <button type="button" onClick={onDelete} className="text-sm text-red-500 hover:text-red-700 font-medium">Delete</button>
          : <span />
        }
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition">Cancel</button>
          <button
            type="button"
            disabled={saving}
            onClick={() => onSave(name, desc, items)}
            className="px-4 py-1.5 text-sm bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 transition"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Import Modal ─────────────────────────────────────────────────────────────

function ImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [text, setText] = useState('')
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ results: { name: string; status: string }[] } | null>(null)
  const [error, setError] = useState('')

  const preview = useMemo(() => {
    return text.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
      const parts = line.split(/,|\t/).map(p => p.trim())
      const name = parts[0] ?? ''
      const second = parts[1] ?? ''
      const third = parts[2] ?? ''
      const secondNum = parseFloat(second)
      if (!isNaN(secondNum) && third === '') return { name, unit: 'kg', price: secondNum }
      const thirdNum = parseFloat(third)
      if (!isNaN(thirdNum)) return { name, unit: second || 'kg', price: thirdNum }
      return { name, unit: second || 'kg', price: null }
    }).filter(r => r.name.length > 0)
  }, [text])

  async function handleImport() {
    setImporting(true); setError('')
    const res = await fetch('/api/chemicals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: preview }) })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Import failed'); setImporting(false); return }
    setResult(data); onImported(); setImporting(false)
  }

  const created = result?.results.filter(r => r.status === 'created').length ?? 0
  const updated = result?.results.filter(r => r.status === 'updated').length ?? 0
  const skipped = result?.results.filter(r => r.status === 'skipped').length ?? 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b dark:border-gray-700">
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">Import Chemicals</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>
        <div className="flex-1 overflow-auto px-6 py-4">
          {!result ? (
            <>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-1 font-medium">Paste chemical data (one per line):</p>
              <p className="text-xs text-gray-400 mb-3">
                Formats: <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">Name, Price</code> · <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">Name, Unit, Price</code> · <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">Name</code>
              </p>
              <textarea
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm font-mono bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-400 min-h-[140px] resize-y"
                placeholder={"Soda Ash, 25.50\nHydrogen Peroxide, liter, 45\nCaustic Soda, kg, 22"}
                value={text} onChange={e => setText(e.target.value)}
              />
              {preview.length > 0 && (
                <div className="mt-3 border dark:border-gray-700 rounded-lg overflow-auto max-h-40">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 dark:bg-gray-800 border-b dark:border-gray-700">
                      <tr>
                        <th className="px-3 py-2 text-left">Name</th>
                        <th className="px-3 py-2 text-left">Unit</th>
                        <th className="px-3 py-2 text-right">Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((r, i) => (
                        <tr key={i} className="border-b dark:border-gray-700 last:border-0">
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
            <div className="py-4 text-center">
              <div className="text-5xl mb-3">✅</div>
              <p className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-4">Import Complete</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="border rounded-lg p-3 bg-green-50 border-green-200"><div className="text-2xl font-bold text-green-700">{created}</div><div className="text-xs text-green-600 mt-0.5">Created</div></div>
                <div className="border rounded-lg p-3 bg-blue-50 border-blue-200"><div className="text-2xl font-bold text-blue-700">{updated}</div><div className="text-xs text-blue-600 mt-0.5">Price Updated</div></div>
                <div className="border rounded-lg p-3 bg-gray-50 border-gray-200"><div className="text-2xl font-bold text-gray-500">{skipped}</div><div className="text-xs text-gray-400 mt-0.5">Skipped</div></div>
              </div>
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t dark:border-gray-700 flex justify-between items-center">
          <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700">{result ? 'Close' : 'Cancel'}</button>
          {!result && (
            <button onClick={handleImport} disabled={preview.length === 0 || importing}
              className="bg-indigo-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
              {importing ? 'Importing...' : `Import ${preview.length} Chemicals`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Price Modal ──────────────────────────────────────────────────────────────

function PriceModal({ chemical, onClose, onUpdated }: { chemical: Chemical; onClose: () => void; onUpdated: (c: Chemical) => void }) {
  const [price, setPrice] = useState(chemical.currentPrice?.toString() ?? '')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    if (!price || isNaN(parseFloat(price))) { setError('Enter a valid price'); return }
    setSaving(true); setError('')
    const res = await fetch(`/api/chemicals/${chemical.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ price: parseFloat(price), note: note || null }) })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Failed'); setSaving(false); return }
    onUpdated(data); onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <h2 className="text-base font-bold text-gray-800 dark:text-gray-100 mb-1">Update Price</h2>
        <p className="text-sm text-gray-500 mb-4">{chemical.name} ({chemical.unit})</p>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">New Price (₹ per {chemical.unit})</label>
            <input type="number" step="0.01" min="0" autoFocus
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              value={price} onChange={e => { setPrice(e.target.value); setError('') }} />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Note (optional)</label>
            <input type="text"
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              placeholder="e.g. Invoice #123" value={note} onChange={e => setNote(e.target.value)} />
          </div>
        </div>
        {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-lg py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="flex-1 bg-indigo-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">{saving ? 'Saving...' : 'Save Price'}</button>
        </div>
      </div>
    </div>
  )
}

// ─── Category Badge ───────────────────────────────────────────────────────────

function CategoryBadge({ category, onClick }: { category: string | null; onClick?: () => void }) {
  if (category === 'color') {
    return (
      <button
        type="button"
        onClick={onClick}
        title="Click to change category"
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-700 hover:bg-purple-200 dark:hover:bg-purple-800/50 transition cursor-pointer select-none"
      >
        🎨 Color
      </button>
    )
  }
  if (category === 'auxiliary') {
    return (
      <button
        type="button"
        onClick={onClick}
        title="Click to change category"
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-700 hover:bg-sky-200 dark:hover:bg-sky-800/50 transition cursor-pointer select-none"
      >
        ⚙️ Auxiliary
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title="Click to set category"
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 border border-gray-200 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600 transition cursor-pointer select-none"
    >
      — Set
    </button>
  )
}

const CATEGORY_CYCLE: Record<string, string | null> = {
  color: 'auxiliary',
  auxiliary: null,
}
function nextCategory(current: string | null): string | null {
  if (current === null) return 'color'
  return CATEGORY_CYCLE[current] ?? null
}

// ─── History Panel ────────────────────────────────────────────────────────────

function HistoryPanel({ chemical }: { chemical: Chemical }) {
  const fmt = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
  return (
    <div className="mt-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden">
      <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide border-b dark:border-gray-600 bg-white dark:bg-gray-800">Price History</div>
      {chemical.priceHistory.length === 0
        ? <p className="text-xs text-gray-400 px-3 py-2">No history yet.</p>
        : <table className="w-full text-xs">
            <tbody>
              {chemical.priceHistory.map(h => (
                <tr key={h.id} className="border-b dark:border-gray-700 last:border-0">
                  <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">{fmt(h.date)}</td>
                  <td className="px-3 py-1.5 font-medium text-gray-800 dark:text-gray-200">₹{h.price}/{chemical.unit}</td>
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
      }
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ChemicalsPage() {
  const [chemicals, setChemicals] = useState<Chemical[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [priceModal, setPriceModal] = useState<Chemical | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [newName, setNewName] = useState('')
  const [newUnit, setNewUnit] = useState('kg')
  const [newPrice, setNewPrice] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')

  // Processes state
  const [processes, setProcesses] = useState<DyeingProcess[]>([])
  const [activeTab, setActiveTab] = useState<'chemicals' | 'presets'>('chemicals') // mobile tabs
  const [editingProcess, setEditingProcess] = useState<DyeingProcess | null | 'new'>(null) // null=closed, 'new'=new, process=edit
  const [processSaving, setProcessSaving] = useState(false)
  const [processError, setProcessError] = useState('')

  useEffect(() => { loadChemicals(); loadProcesses() }, [])

  async function loadChemicals() {
    setLoading(true)
    const res = await fetch('/api/chemicals')
    setChemicals(await res.json())
    setLoading(false)
  }

  async function loadProcesses() {
    const res = await fetch('/api/dyeing/processes')
    if (res.ok) setProcesses(await res.json())
  }

  const filtered = useMemo(() => chemicals.filter(c => c.name.toLowerCase().includes(search.toLowerCase())), [chemicals, search])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setAdding(true); setAddError('')
    const res = await fetch('/api/chemicals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newName.trim(), unit: newUnit, price: newPrice ? parseFloat(newPrice) : null }) })
    const data = await res.json()
    if (!res.ok) { setAddError(data.error ?? 'Failed'); setAdding(false); return }
    setChemicals(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
    setNewName(''); setNewPrice(''); setNewUnit('kg'); setShowAdd(false); setAdding(false)
  }

  async function handleDelete(id: number, name: string) {
    if (!confirm(`Delete "${name}"? This will also remove all price history.`)) return
    const res = await fetch(`/api/chemicals/${id}`, { method: 'DELETE' })
    if (res.ok) setChemicals(prev => prev.filter(c => c.id !== id))
    else alert('Cannot delete')
  }

  async function handleCategoryToggle(c: Chemical) {
    const newCategory = nextCategory(c.category)
    const res = await fetch(`/api/chemicals/${c.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: newCategory }),
    })
    if (res.ok) {
      const updated = await res.json()
      setChemicals(prev => prev.map(ch => ch.id === c.id ? { ...ch, category: updated.category } : ch))
    }
  }

  async function saveProcess(name: string, description: string, items: DraftItem[]) {
    if (!name.trim()) { setProcessError('Process name is required'); return }
    setProcessSaving(true); setProcessError('')
    const body = {
      name: name.trim(),
      description: description.trim() || null,
      items: items.filter(i => i.chemicalId && parseFloat(i.quantity) > 0).map(i => ({ chemicalId: i.chemicalId!, quantity: parseFloat(i.quantity) })),
    }
    const isNew = editingProcess === 'new'
    const url = isNew ? '/api/dyeing/processes' : `/api/dyeing/processes/${(editingProcess as DyeingProcess).id}`
    const res = await fetch(url, { method: isNew ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json()
    if (!res.ok) { setProcessError(data.error ?? 'Failed'); setProcessSaving(false); return }
    if (isNew) setProcesses(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
    else setProcesses(prev => prev.map(p => p.id === data.id ? data : p))
    setEditingProcess(null); setProcessSaving(false)
  }

  async function deleteProcess() {
    if (editingProcess === 'new' || !editingProcess) return
    if (!confirm(`Delete process "${editingProcess.name}"?`)) return
    await fetch(`/api/dyeing/processes/${editingProcess.id}`, { method: 'DELETE' })
    setProcesses(prev => prev.filter(p => p.id !== (editingProcess as DyeingProcess).id))
    setEditingProcess(null)
  }

  const fmt = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

  // ── Process sidebar content (reused desktop + mobile) ────────────────────
  const ProcessList = () => (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700 shrink-0">
        <div>
          <p className="text-sm font-bold text-gray-800 dark:text-gray-100">Process Presets</p>
          <p className="text-xs text-gray-400">{processes.length} presets</p>
        </div>
        <button
          onClick={() => { setProcessError(''); setEditingProcess('new') }}
          className="text-sm bg-indigo-600 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-indigo-700 transition"
        >
          + New
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {processes.length === 0 ? (
          <div className="text-center text-gray-400 text-xs py-8">No presets yet.<br />Click + New to create one.</div>
        ) : processes.map(p => (
          <button
            key={p.id}
            onClick={() => { setProcessError(''); setEditingProcess(p) }}
            className={`w-full text-left rounded-xl border px-3 py-2.5 transition ${editingProcess !== 'new' && (editingProcess as DyeingProcess)?.id === p.id ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-900/30' : 'border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-indigo-200 dark:hover:border-indigo-700'}`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{p.name}</span>
              <span className="text-[10px] bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.5 rounded-full font-medium shrink-0 ml-2">
                {p.items.length} chem
              </span>
            </div>
            {p.description && <p className="text-xs text-gray-400 mt-0.5 truncate">{p.description}</p>}
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Page header */}
      <div className="px-4 md:px-8 pt-6 pb-3 shrink-0">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-3">
            <BackButton />
            <div>
              <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Chemical Master</h1>
              <p className="text-sm text-gray-500">Manage chemicals with price history</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowImport(true)} className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700">Import</button>
            <button onClick={() => setShowAdd(v => !v)} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">+ Add Chemical</button>
          </div>
        </div>

        {/* Mobile tab switcher */}
        <div className="flex md:hidden gap-1 mt-3 bg-gray-100 dark:bg-gray-700 rounded-xl p-1">
          <button onClick={() => setActiveTab('chemicals')} className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${activeTab === 'chemicals' ? 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}>
            Chemicals ({chemicals.length})
          </button>
          <button onClick={() => setActiveTab('presets')} className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${activeTab === 'presets' ? 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}>
            Presets ({processes.length})
          </button>
        </div>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="px-4 md:px-8 shrink-0">
          <form onSubmit={handleAdd} className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-700 rounded-xl p-4 mb-2">
            <p className="text-sm font-semibold text-indigo-800 dark:text-indigo-300 mb-3">New Chemical</p>
            <div className="flex flex-wrap gap-3">
              <input type="text" required autoFocus
                className="flex-1 min-w-[160px] border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                placeholder="Chemical name" value={newName} onChange={e => { setNewName(e.target.value); setAddError('') }} />
              <select className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-400" value={newUnit} onChange={e => setNewUnit(e.target.value)}>
                {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
              <input type="number" step="0.01" min="0"
                className="w-32 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                placeholder="Price (₹)" value={newPrice} onChange={e => setNewPrice(e.target.value)} />
              <button type="submit" disabled={adding} className="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-60">{adding ? 'Saving...' : 'Save'}</button>
              <button type="button" onClick={() => setShowAdd(false)} className="text-sm text-gray-500 hover:text-gray-700 px-2">Cancel</button>
            </div>
            {addError && <p className="text-red-500 text-sm mt-2">{addError}</p>}
          </form>
        </div>
      )}

      {/* Main body: two columns on desktop, tabs on mobile */}
      <div className="flex flex-1 overflow-hidden px-4 md:px-8 pb-4 gap-4">

        {/* ── Left: Chemical list ── */}
        <div className={`flex-1 flex flex-col overflow-hidden ${activeTab === 'presets' ? 'hidden md:flex' : 'flex'}`}>
          <div className="mb-3 shrink-0">
            <input type="text"
              className="w-full max-w-sm border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              placeholder="Search chemicals..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>

          <div className="flex-1 overflow-y-auto bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
            {loading ? (
              <div className="p-8 text-center text-gray-400">Loading...</div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-gray-400">
                {search ? 'No chemicals match your search.' : 'No chemicals added yet.'}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-600 sticky top-0">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">#</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Name</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:table-cell">Category</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Unit</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Price</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide hidden sm:table-cell">Updated</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {filtered.map((c, i) => (
                    <>
                      <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="px-4 py-3 text-gray-400 text-xs">{i + 1}</td>
                        <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-100">{c.name}</td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          <CategoryBadge category={c.category} onClick={() => handleCategoryToggle(c)} />
                        </td>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{c.unit}</td>
                        <td className="px-4 py-3 text-right">
                          {c.currentPrice != null ? <span className="font-semibold text-gray-800 dark:text-gray-100">₹{c.currentPrice.toFixed(2)}</span> : <span className="text-gray-400 text-xs">Not set</span>}
                        </td>
                        <td className="px-4 py-3 text-gray-400 text-xs hidden sm:table-cell">{fmt(c.updatedAt)}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <span className="md:hidden"><CategoryBadge category={c.category} onClick={() => handleCategoryToggle(c)} /></span>
                            <button onClick={() => setPriceModal(c)} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">Update Price</button>
                            <button onClick={() => setExpandedId(expandedId === c.id ? null : c.id)} className="text-xs text-gray-500 hover:text-gray-700">{expandedId === c.id ? 'Hide' : 'History'}</button>
                            <button onClick={() => handleDelete(c.id, c.name)} className="text-xs text-red-400 hover:text-red-600">Delete</button>
                          </div>
                        </td>
                      </tr>
                      {expandedId === c.id && (
                        <tr key={`hist-${c.id}`}><td colSpan={7} className="px-4 pb-3"><HistoryPanel chemical={c} /></td></tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-2 shrink-0">{filtered.length} of {chemicals.length} chemicals</p>
        </div>

        {/* ── Right: Process Presets sidebar (desktop sticky, mobile tab) ── */}
        <div className={`md:w-72 lg:w-80 shrink-0 flex flex-col overflow-hidden ${activeTab === 'chemicals' ? 'hidden md:flex' : 'flex flex-1 md:flex-none'}`}>
          <div className="flex-1 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col">
            {editingProcess !== null ? (
              <ProcessEditor
                process={editingProcess === 'new' ? null : editingProcess}
                chemicals={chemicals}
                onSave={saveProcess}
                onDelete={editingProcess !== 'new' ? deleteProcess : undefined}
                onClose={() => setEditingProcess(null)}
                saving={processSaving}
                error={processError}
              />
            ) : (
              <ProcessList />
            )}
          </div>
        </div>
      </div>

      {/* Mobile bottom sheet for process editor */}
      {editingProcess !== null && (
        <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={() => setEditingProcess(null)} />
          <div className="relative bg-white dark:bg-gray-900 rounded-t-2xl flex flex-col" style={{ maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>
            <div className="flex justify-center pt-3 pb-1 shrink-0">
              <div className="w-10 h-1 bg-gray-300 dark:bg-gray-600 rounded-full" />
            </div>
            <div className="flex-1 overflow-hidden flex flex-col">
              <ProcessEditor
                process={editingProcess === 'new' ? null : editingProcess}
                chemicals={chemicals}
                onSave={saveProcess}
                onDelete={editingProcess !== 'new' ? deleteProcess : undefined}
                onClose={() => setEditingProcess(null)}
                saving={processSaving}
                error={processError}
              />
            </div>
          </div>
        </div>
      )}

      {showImport && <ImportModal onClose={() => setShowImport(false)} onImported={() => { loadChemicals(); setShowImport(false) }} />}
      {priceModal && <PriceModal chemical={priceModal} onClose={() => setPriceModal(null)} onUpdated={c => setChemicals(prev => prev.map(ch => ch.id === c.id ? c : ch))} />}
    </div>
  )
}
