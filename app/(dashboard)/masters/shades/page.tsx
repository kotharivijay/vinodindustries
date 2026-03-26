'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface Chemical { id: number; name: string; unit: string }
interface RecipeItem { id?: number; chemicalId: number; chemical: { id: number; name: string; unit: string }; quantity: number }
interface Shade { id: number; name: string; description?: string; createdAt: string; recipeItems: RecipeItem[] }

// ── Chemical search dropdown ──────────────────────────────────────────────────
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
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = chemicals.filter(c =>
    c.name.toLowerCase().includes(query.toLowerCase())
  ).slice(0, 40)

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
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-xs text-gray-400">No chemicals found</p>
          ) : filtered.map(c => (
            <button
              key={c.id}
              type="button"
              onMouseDown={e => { e.preventDefault(); onChange(c); setOpen(false); setQuery('') }}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 dark:hover:bg-indigo-900/20 ${c.id === value ? 'bg-indigo-50 dark:bg-indigo-900/30 font-medium text-indigo-700 dark:text-indigo-400' : 'text-gray-800 dark:text-gray-200'}`}
            >
              {c.name} <span className="text-xs text-gray-400">{c.unit}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Recipe editor ─────────────────────────────────────────────────────────────
interface DraftItem { chemicalId: number | null; chemical: Chemical | null; quantity: string }

function RecipeEditor({ items, chemicals, onChange }: {
  items: DraftItem[]
  chemicals: Chemical[]
  onChange: (items: DraftItem[]) => void
}) {
  const add = () => onChange([...items, { chemicalId: null, chemical: null, quantity: '' }])
  const remove = (i: number) => onChange(items.filter((_, j) => j !== i))
  const update = (i: number, patch: Partial<DraftItem>) =>
    onChange(items.map((it, j) => j === i ? { ...it, ...patch } : it))

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Recipe — per 100 kg fabric</p>
        <button
          type="button"
          onClick={add}
          className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 font-medium"
        >
          + Add Chemical
        </button>
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-gray-400 py-3 text-center border border-dashed border-gray-200 dark:border-gray-700 rounded-lg">
          No recipe yet — click + Add Chemical
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((item, i) => (
            <div key={i} className="flex gap-2 items-center">
              <div className="flex-1">
                <ChemicalDropdown
                  value={item.chemicalId}
                  chemicals={chemicals}
                  onChange={c => update(i, { chemicalId: c.id, chemical: c })}
                />
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="w-20 border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  placeholder="Qty"
                  value={item.quantity}
                  onChange={e => update(i, { quantity: e.target.value })}
                />
                <span className="text-xs text-gray-400 w-6">{item.chemical?.unit ?? ''}</span>
              </div>
              <button
                type="button"
                onClick={() => remove(i)}
                className="text-gray-300 hover:text-red-500 text-lg leading-none shrink-0"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ShadesPage() {
  const router = useRouter()
  const { data: shades, isLoading, mutate } = useSWR<Shade[]>('/api/shades', fetcher)
  const { data: chemicals } = useSWR<Chemical[]>('/api/chemicals', fetcher)

  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Shade | null>(null)
  const [isNew, setIsNew] = useState(false)

  // Editor state
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editRecipe, setEditRecipe] = useState<DraftItem[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function openNew() {
    setSelected(null)
    setIsNew(true)
    setEditName('')
    setEditDesc('')
    setEditRecipe([])
    setError('')
  }

  function openEdit(shade: Shade) {
    setSelected(shade)
    setIsNew(false)
    setEditName(shade.name)
    setEditDesc(shade.description ?? '')
    setEditRecipe(shade.recipeItems.map(r => ({
      chemicalId: r.chemical.id,
      chemical: r.chemical,
      quantity: String(r.quantity),
    })))
    setError('')
  }

  function closeEditor() {
    setSelected(null)
    setIsNew(false)
    setError('')
  }

  async function save() {
    if (!editName.trim()) { setError('Shade name is required'); return }
    setSaving(true)
    setError('')

    const recipeItems = editRecipe
      .filter(r => r.chemicalId && parseFloat(r.quantity) > 0)
      .map(r => ({ chemicalId: r.chemicalId!, quantity: parseFloat(r.quantity) }))

    try {
      let res: Response
      if (isNew) {
        res = await fetch('/api/shades', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: editName.trim(), description: editDesc.trim() || null }),
        })
        const newShade = await res.json()
        if (!res.ok) { setError(newShade.error ?? 'Failed'); return }
        // If recipe items exist, save them via PUT
        if (recipeItems.length > 0) {
          await fetch(`/api/shades/${newShade.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: editName.trim(), description: editDesc.trim() || null, recipeItems }),
          })
        }
      } else {
        res = await fetch(`/api/shades/${selected!.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: editName.trim(), description: editDesc.trim() || null, recipeItems }),
        })
        if (!res.ok) { const d = await res.json(); setError(d.error ?? 'Failed'); return }
      }

      await mutate()
      closeEditor()
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!selected) return
    if (!confirm(`Delete shade "${selected.name}"?`)) return
    await fetch(`/api/shades?id=${selected.id}`, { method: 'DELETE' })
    await mutate()
    closeEditor()
  }

  const filtered = (shades ?? []).filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.description ?? '').toLowerCase().includes(search.toLowerCase())
  )

  const editorOpen = isNew || selected !== null

  return (
    <div className="p-4 md:p-8 h-full">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg px-4 py-2 text-sm font-medium transition"
        >
          &larr; Back
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Shade Master</h1>
          <p className="text-sm text-gray-500">{shades?.length ?? 0} shades</p>
        </div>
        <button
          onClick={openNew}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition"
        >
          + New Shade
        </button>
      </div>

      <div className="flex gap-4 h-[calc(100vh-180px)]">
        {/* Left — Shade list */}
        <div className={`flex flex-col ${editorOpen ? 'hidden md:flex md:w-72 lg:w-80' : 'flex-1'} shrink-0`}>
          <input
            type="text"
            placeholder="Search shades..."
            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm mb-3 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />

          {isLoading ? (
            <div className="text-gray-400 text-sm">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-gray-400 py-12 text-sm">No shades found</div>
          ) : (
            <div className="overflow-y-auto space-y-1 flex-1">
              {filtered.map(shade => (
                <button
                  key={shade.id}
                  onClick={() => openEdit(shade)}
                  className={`w-full text-left rounded-xl border px-4 py-3 transition ${
                    selected?.id === shade.id
                      ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-900/30'
                      : 'border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-indigo-200 dark:hover:border-indigo-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{shade.name}</span>
                    {shade.recipeItems.length > 0 && (
                      <span className="text-[10px] bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.5 rounded-full font-medium">
                        {shade.recipeItems.length} chem
                      </span>
                    )}
                  </div>
                  {shade.description && (
                    <p className="text-xs text-gray-400 mt-0.5 truncate">{shade.description}</p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right — Editor */}
        {editorOpen && (
          <div className="flex-1 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden">
            {/* Editor header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-gray-700">
              <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">
                {isNew ? 'New Shade' : 'Edit Shade'}
              </h2>
              <button onClick={closeEditor} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none">×</button>
            </div>

            {/* Editor body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {error && (
                <div className="text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-2 text-sm">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Shade Name *</label>
                <input
                  type="text"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  placeholder="e.g. Red 10"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Description</label>
                <input
                  type="text"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  placeholder="e.g. Deep red reactive dye"
                  value={editDesc}
                  onChange={e => setEditDesc(e.target.value)}
                />
              </div>

              <div className="border-t border-gray-100 dark:border-gray-700 pt-4">
                <RecipeEditor
                  items={editRecipe}
                  chemicals={chemicals ?? []}
                  onChange={setEditRecipe}
                />
              </div>

              {editRecipe.filter(r => r.chemicalId && parseFloat(r.quantity) > 0).length > 0 && (
                <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg px-4 py-3">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Recipe Summary</p>
                  <div className="space-y-1">
                    {editRecipe.filter(r => r.chemicalId && parseFloat(r.quantity) > 0).map((r, i) => (
                      <div key={i} className="flex justify-between text-xs">
                        <span className="text-gray-700 dark:text-gray-300">{r.chemical?.name}</span>
                        <span className="font-medium text-gray-800 dark:text-gray-200">
                          {r.quantity} {r.chemical?.unit} / 100 kg
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Editor footer */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
              {!isNew ? (
                <button onClick={remove} className="text-sm text-red-500 hover:text-red-700 font-medium">
                  Delete
                </button>
              ) : <span />}
              <div className="flex gap-2">
                <button
                  onClick={closeEditor}
                  className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={save}
                  disabled={saving}
                  className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 transition"
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
