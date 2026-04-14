'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import useSWR from 'swr'
import BackButton from '../../BackButton'

const fetcher = (url: string) => fetch(url).then(r => r.json())

// ── Searchable Dropdown Component ─────────────────────────────────────────
function SearchDropdown({ value, items, onChange, placeholder, disabled }: {
  value: number | null
  items: { id: number; name: string }[]
  onChange: (id: number | null) => void
  placeholder: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const selected = items.find(i => i.id === value)

  useEffect(() => {
    const handler = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) {
      document.addEventListener('mousedown', handler)
      document.addEventListener('touchstart', handler as EventListener)
    }
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('touchstart', handler as EventListener)
    }
  }, [open])

  const filtered = useMemo(() => {
    if (!search) return items
    const q = search.toLowerCase()
    return items.filter(i => i.name.toLowerCase().includes(q))
  }, [items, search])

  return (
    <div ref={ref} className="relative">
      <div
        onClick={() => { if (!disabled) { setOpen(!open); setSearch('') } }}
        className={`flex items-center justify-between border rounded-lg px-3 py-2 text-sm cursor-pointer transition ${
          disabled ? 'opacity-50 cursor-not-allowed' : ''
        } ${open ? 'ring-2 ring-teal-400 border-teal-400' : 'border-gray-300 dark:border-gray-600'
        } bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100`}
      >
        <span className={selected ? '' : 'text-gray-400 dark:text-gray-500'}>
          {selected?.name || placeholder}
        </span>
        <span className="text-gray-400 text-xs">{'\u25BE'}</span>
      </div>
      {open && !disabled && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl z-30 max-h-60 flex flex-col">
          <input
            type="text"
            autoFocus
            className="w-full border-b border-gray-200 dark:border-gray-700 bg-transparent text-sm px-3 py-2 focus:outline-none dark:text-gray-100 dark:placeholder-gray-500"
            placeholder="Search..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            onClick={e => e.stopPropagation()}
          />
          <div className="overflow-y-auto max-h-48">
            {value && (
              <button
                type="button"
                onClick={() => { onChange(null); setOpen(false); setSearch('') }}
                className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 border-b border-gray-100 dark:border-gray-700"
              >
                {'\u2715'} Clear selection
              </button>
            )}
            {filtered.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => { onChange(item.id); setOpen(false); setSearch('') }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-teal-50 dark:hover:bg-teal-900/20 transition ${
                  item.id === value ? 'bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 font-medium' : 'text-gray-800 dark:text-gray-200'
                }`}
              >
                {item.name}
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-3 text-xs text-gray-400 text-center">No results</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Chemical Row with searchable dropdown ──────────────────────────────────
function ChemicalRow({ item, index, chemicals, onUpdate, onRemove }: {
  item: { name: string; chemicalId: number | null; quantity: string; unit: string }
  index: number
  chemicals: { id: number; name: string; unit: string }[]
  onUpdate: (i: number, field: string, value: string) => void
  onRemove: (i: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) {
      document.addEventListener('mousedown', handler)
      document.addEventListener('touchstart', handler as EventListener)
    }
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('touchstart', handler as EventListener)
    }
  }, [open])

  const filtered = useMemo(() => {
    const q = (open ? search : '').toLowerCase()
    if (!q) return chemicals.slice(0, 50)
    return chemicals.filter(c => c.name.toLowerCase().includes(q))
  }, [chemicals, search, open])

  return (
    <div className="flex items-center gap-2">
      <div ref={ref} className="relative flex-1">
        <div
          onClick={() => { setOpen(!open); setSearch('') }}
          className={`flex items-center justify-between border rounded px-2 py-1.5 text-sm cursor-pointer ${
            open ? 'ring-1 ring-teal-400 border-teal-400' : 'border-gray-300 dark:border-gray-600'
          } bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100`}
        >
          <span className={item.name ? '' : 'text-gray-400 dark:text-gray-500'}>
            {item.name || 'Select chemical...'}
          </span>
          <span className="text-gray-400 text-[10px]">{'\u25BE'}</span>
        </div>
        {open && (
          <div className="absolute left-0 right-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl z-30 max-h-48 flex flex-col">
            <input
              type="text"
              autoFocus
              className="w-full border-b border-gray-200 dark:border-gray-700 bg-transparent text-sm px-2 py-1.5 focus:outline-none dark:text-gray-100 dark:placeholder-gray-500"
              placeholder="Search chemical..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              onClick={e => e.stopPropagation()}
            />
            <div className="overflow-y-auto max-h-36">
              {filtered.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => { onUpdate(index, 'name', c.name); setOpen(false); setSearch('') }}
                  className={`w-full text-left px-2 py-1.5 text-sm hover:bg-teal-50 dark:hover:bg-teal-900/20 ${
                    item.name === c.name ? 'bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 font-medium' : 'text-gray-800 dark:text-gray-200'
                  }`}
                >
                  {c.name} <span className="text-[10px] text-gray-400">{c.unit}</span>
                </button>
              ))}
              {filtered.length === 0 && search && (
                <button
                  type="button"
                  onClick={() => { onUpdate(index, 'name', search.trim()); setOpen(false); setSearch('') }}
                  className="w-full text-left px-2 py-1.5 text-sm text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                >
                  + Use &quot;{search.trim()}&quot;
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      <input type="number" step="0.01" placeholder="Qty" value={item.quantity}
        onChange={e => onUpdate(index, 'quantity', e.target.value)}
        className="w-20 border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-teal-400" />
      <select value={item.unit} onChange={e => onUpdate(index, 'unit', e.target.value)}
        className="w-16 border border-gray-300 dark:border-gray-600 rounded px-1 py-1.5 text-xs bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-teal-400">
        <option value="kg">kg</option>
        <option value="ltr">ltr</option>
        <option value="gm">gm</option>
        <option value="ml">ml</option>
      </select>
      <button type="button" onClick={() => onRemove(index)}
        className="text-red-400 hover:text-red-600 text-lg leading-none">&times;</button>
    </div>
  )
}

interface Party { id: number; name: string }
interface Quality { id: number; name: string }
interface ChemicalMaster { id: number; name: string; unit: string; currentPrice: number | null }

interface RecipeItem {
  id?: number
  chemicalId: number | null
  chemical?: { id: number; name: string; currentPrice: number | null } | null
  name: string
  quantity: number | string
  unit: string
}

interface RecipeTag {
  id: number
  partyId: number
  qualityId: number
  quality: { id: number; name: string }
  party: { id: number; name: string }
}

interface Recipe {
  id: number
  partyId: number
  qualityId: number
  variant?: string
  isDefault?: boolean
  party: { id: number; name: string }
  quality: { id: number; name: string }
  finishWidth: string | null
  finalWidth: string | null
  shortage: string | null
  notes: string | null
  items: RecipeItem[]
  tags?: RecipeTag[]
  variants?: { id: number; variant: string; isDefault: boolean }[]
  isTagged?: boolean
  taggedFrom?: string
  updatedAt: string
}

export default function FinishRecipeMasterPage() {
  const { data: parties } = useSWR<Party[]>('/api/masters/parties', fetcher)
  const { data: chemicals } = useSWR<ChemicalMaster[]>('/api/chemicals', fetcher)
  const { data: allRecipes, mutate: mutateRecipes } = useSWR<Recipe[]>('/api/finish/recipe', fetcher)

  const [selectedPartyId, setSelectedPartyId] = useState<number | null>(null)
  const [selectedQualityId, setSelectedQualityId] = useState<number | null>(null)
  const [partyQualities, setPartyQualities] = useState<Quality[]>([])
  const [loadingQualities, setLoadingQualities] = useState(false)

  // Recipe editor state
  const [recipe, setRecipe] = useState<Recipe | null>(null)
  const [loadingRecipe, setLoadingRecipe] = useState(false)
  const [finishWidth, setFinishWidth] = useState('')
  const [finalWidth, setFinalWidth] = useState('')
  const [shortage, setShortage] = useState('')
  const [variantName, setVariantName] = useState('Standard')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<{ name: string; chemicalId: number | null; quantity: string; unit: string }[]>([])
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [message, setMessage] = useState('')
  const [searchTerm, setSearchTerm] = useState('')

  // Tag state
  const [showTagUI, setShowTagUI] = useState(false)
  const [partyRecipes, setPartyRecipes] = useState<Recipe[]>([])
  const [loadingPartyRecipes, setLoadingPartyRecipes] = useState(false)
  const [selectedTagRecipeId, setSelectedTagRecipeId] = useState<number | null>(null)
  const [tagging, setTagging] = useState(false)
  const [showNewRecipe, setShowNewRecipe] = useState(false)

  // Load qualities when party changes — only qualities related to this party
  useEffect(() => {
    if (!selectedPartyId) { setPartyQualities([]); return }
    setLoadingQualities(true)
    setSelectedQualityId(null)
    setRecipe(null)
    setShowTagUI(false)
    setShowNewRecipe(false)
    // Fetch qualities from grey entries + OB for this party
    fetch(`/api/finish/recipe?partyId=${selectedPartyId}&action=party-qualities`)
      .then(r => r.json())
      .then((qs: Quality[]) => {
        setPartyQualities(Array.isArray(qs) ? qs : [])
        setLoadingQualities(false)
      })
      .catch(() => setLoadingQualities(false))
  }, [selectedPartyId])

  // Load recipe when both party and quality selected
  useEffect(() => {
    if (!selectedPartyId || !selectedQualityId) {
      setRecipe(null)
      setShowTagUI(false)
      setShowNewRecipe(false)
      return
    }
    setLoadingRecipe(true)
    setMessage('')
    setShowTagUI(false)
    setShowNewRecipe(false)
    fetch(`/api/finish/recipe?partyId=${selectedPartyId}&qualityId=${selectedQualityId}`)
      .then(r => r.json())
      .then((data: Recipe | null) => {
        if (data && data.id) {
          setRecipe(data)
          setFinishWidth(data.finishWidth || '')
          setFinalWidth(data.finalWidth || '')
          setShortage(data.shortage || '')
          setNotes(data.notes || '')
          setItems(data.items.map(i => ({
            name: i.name,
            chemicalId: i.chemicalId,
            quantity: String(i.quantity),
            unit: i.unit,
          })))
        } else {
          // No recipe found — show tag/create options
          setRecipe(null)
          setFinishWidth('')
          setFinalWidth('')
          setShortage('')
          setNotes('')
          setItems([])
        }
        setLoadingRecipe(false)
      })
      .catch(() => setLoadingRecipe(false))
  }, [selectedPartyId, selectedQualityId])

  // Fetch party recipes for tagging
  const fetchPartyRecipesForTag = useCallback(async () => {
    if (!selectedPartyId) return
    setLoadingPartyRecipes(true)
    setSelectedTagRecipeId(null)
    try {
      const res = await fetch(`/api/finish/recipe?partyId=${selectedPartyId}`)
      const data = await res.json()
      setPartyRecipes(Array.isArray(data) ? data : [])
    } catch {
      setPartyRecipes([])
    }
    setLoadingPartyRecipes(false)
  }, [selectedPartyId])

  const handleTagToExisting = useCallback(() => {
    setShowTagUI(true)
    setShowNewRecipe(false)
    fetchPartyRecipesForTag()
  }, [fetchPartyRecipesForTag])

  const handleCreateNew = useCallback(() => {
    setShowNewRecipe(true)
    setShowTagUI(false)
  }, [])

  const handleSaveTag = useCallback(async () => {
    if (!selectedPartyId || !selectedQualityId || !selectedTagRecipeId) return
    setTagging(true)
    setMessage('')
    try {
      const res = await fetch('/api/finish/recipe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'tag',
          partyId: selectedPartyId,
          qualityId: selectedQualityId,
          recipeId: selectedTagRecipeId,
        }),
      })
      if (res.ok) {
        setMessage('Tagged successfully!')
        setShowTagUI(false)
        mutateRecipes()
        // Re-fetch the recipe for this combo (will now resolve via tag)
        const recipeRes = await fetch(`/api/finish/recipe?partyId=${selectedPartyId}&qualityId=${selectedQualityId}`)
        const data = await recipeRes.json()
        if (data && data.id) {
          setRecipe(data)
          setFinishWidth(data.finishWidth || '')
          setFinalWidth(data.finalWidth || '')
          setShortage(data.shortage || '')
          setNotes(data.notes || '')
          setItems(data.items.map((i: RecipeItem) => ({
            name: i.name,
            chemicalId: i.chemicalId,
            quantity: String(i.quantity),
            unit: i.unit,
          })))
        }
      } else {
        const err = await res.json()
        setMessage(err.error || 'Failed to create tag.')
      }
    } catch {
      setMessage('Network error.')
    }
    setTagging(false)
  }, [selectedPartyId, selectedQualityId, selectedTagRecipeId, mutateRecipes])

  const handleRemoveTag = useCallback(async (tagId: number) => {
    try {
      const res = await fetch(`/api/finish/recipe?tagId=${tagId}`, { method: 'DELETE' })
      if (res.ok) {
        mutateRecipes()
        // Re-fetch current recipe to refresh tags
        if (selectedPartyId && selectedQualityId) {
          const recipeRes = await fetch(`/api/finish/recipe?partyId=${selectedPartyId}&qualityId=${selectedQualityId}`)
          const data = await recipeRes.json()
          if (data && data.id) setRecipe(data)
        }
      }
    } catch { /* ignore */ }
  }, [mutateRecipes, selectedPartyId, selectedQualityId])

  const addItem = useCallback(() => {
    setItems(prev => [...prev, { name: '', chemicalId: null, quantity: '', unit: 'kg' }])
  }, [])

  const removeItem = useCallback((i: number) => {
    setItems(prev => prev.filter((_, idx) => idx !== i))
  }, [])

  const updateItem = useCallback((i: number, field: string, value: string) => {
    setItems(prev => {
      const updated = [...prev]
      updated[i] = { ...updated[i], [field]: value }
      if (field === 'name' && chemicals) {
        const exact = chemicals.find(m => m.name.toLowerCase().trim() === value.toLowerCase().trim())
        updated[i].chemicalId = exact?.id ?? null
      }
      return updated
    })
  }, [chemicals])

  const handleSave = useCallback(async () => {
    if (!selectedPartyId || !selectedQualityId) return
    setSaving(true)
    setMessage('')
    try {
      const res = await fetch('/api/finish/recipe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partyId: selectedPartyId,
          qualityId: selectedQualityId,
          variant: variantName || 'Standard',
          finishWidth: finishWidth || null,
          finalWidth: finalWidth || null,
          shortage: shortage || null,
          notes: notes || null,
          items: items.filter(i => i.name.trim()).map(i => ({
            name: i.name.trim(),
            chemicalId: i.chemicalId,
            quantity: parseFloat(i.quantity) || 0,
            unit: i.unit,
          })),
        }),
      })
      if (res.ok) {
        const data = await res.json()
        setRecipe(data)
        setShowNewRecipe(false)
        setMessage('Recipe saved successfully!')
        mutateRecipes()
      } else {
        setMessage('Failed to save recipe.')
      }
    } catch {
      setMessage('Network error.')
    }
    setSaving(false)
  }, [selectedPartyId, selectedQualityId, finishWidth, finalWidth, shortage, notes, items, mutateRecipes])

  const handleDelete = useCallback(async () => {
    if (!recipe) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/finish/recipe?id=${recipe.id}`, { method: 'DELETE' })
      if (res.ok) {
        setRecipe(null)
        setFinishWidth('')
        setFinalWidth('')
        setShortage('')
        setNotes('')
        setItems([])
        setDeleteConfirm(false)
        setMessage('Recipe deleted.')
        mutateRecipes()
      }
    } catch { /* ignore */ }
    setDeleting(false)
  }, [recipe, mutateRecipes])

  // Filter all recipes for bottom list — by selected party or search
  const filteredRecipes = useMemo(() => {
    if (!allRecipes) return []
    let list = allRecipes
    if (selectedPartyId) list = list.filter(r => r.party.id === selectedPartyId)
    const term = searchTerm.toLowerCase()
    if (term) list = list.filter(r => r.party.name.toLowerCase().includes(term) || r.quality.name.toLowerCase().includes(term))
    return list
  }, [allRecipes, searchTerm, selectedPartyId])

  const masterChemicals = chemicals ?? []

  const inputClass = "w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-teal-400"

  // Should we show the "no recipe" options?
  const noRecipeFound = selectedPartyId && selectedQualityId && !loadingRecipe && !recipe

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <BackButton />
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Finish Recipe Master</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Manage finish recipes by party and quality</p>
        </div>
      </div>

      {/* Party + Quality searchable dropdowns */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Party</label>
          <SearchDropdown
            value={selectedPartyId}
            items={(parties ?? []).map(p => ({ id: p.id, name: p.name }))}
            onChange={id => setSelectedPartyId(id)}
            placeholder="Search party..."
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Quality</label>
          <SearchDropdown
            value={selectedQualityId}
            items={partyQualities.map(q => ({ id: q.id, name: q.name }))}
            onChange={id => setSelectedQualityId(id)}
            placeholder={loadingQualities ? 'Loading...' : 'Search quality...'}
            disabled={!selectedPartyId || loadingQualities}
          />
        </div>
      </div>

      {/* No recipe found — Tag or Create options */}
      {noRecipeFound && !showTagUI && !showNewRecipe && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-amber-200 dark:border-amber-800 shadow-sm p-5 mb-6">
          <p className="text-sm text-amber-700 dark:text-amber-300 mb-4">
            No recipe found for this party + quality combination.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={handleTagToExisting}
              className="flex-1 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 px-4 py-3 rounded-lg text-sm font-bold hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition"
            >
              Tag to Existing Recipe
            </button>
            <button
              onClick={handleCreateNew}
              className="flex-1 bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 text-teal-700 dark:text-teal-300 px-4 py-3 rounded-lg text-sm font-bold hover:bg-teal-100 dark:hover:bg-teal-900/30 transition"
            >
              Create New Recipe
            </button>
          </div>
        </div>
      )}

      {/* Tag to Existing Recipe UI */}
      {noRecipeFound && showTagUI && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-indigo-200 dark:border-indigo-800 shadow-sm p-5 mb-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">Tag to Existing Recipe</h2>
            <button onClick={() => setShowTagUI(false)} className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">Cancel</button>
          </div>

          {message && (
            <div className={`rounded-lg px-4 py-3 text-sm ${message.includes('success') || message.includes('Tagged') ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300' : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'}`}>
              {message}
            </div>
          )}

          {loadingPartyRecipes ? (
            <div className="p-4 text-center text-gray-400 dark:text-gray-500">Loading recipes...</div>
          ) : partyRecipes.length === 0 ? (
            <div className="p-4 text-center text-gray-400 dark:text-gray-500">
              No existing recipes for this party. Create a new one instead.
            </div>
          ) : (
            <>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {partyRecipes.map(r => (
                  <label
                    key={r.id}
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition ${
                      selectedTagRecipeId === r.id
                        ? 'border-indigo-400 dark:border-indigo-600 bg-indigo-50 dark:bg-indigo-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:border-indigo-300 dark:hover:border-indigo-700'
                    }`}
                  >
                    <input
                      type="radio"
                      name="tagRecipe"
                      checked={selectedTagRecipeId === r.id}
                      onChange={() => setSelectedTagRecipeId(r.id)}
                      className="mt-0.5 accent-indigo-600"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{r.quality.name}</span>
                        <span className="text-xs text-gray-400 dark:text-gray-500">{r.items.length} chemical{r.items.length !== 1 ? 's' : ''}</span>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-1 text-xs text-gray-500 dark:text-gray-400">
                        {r.finishWidth && <span>FW: {r.finishWidth}</span>}
                        {r.finalWidth && <span>Final: {r.finalWidth}</span>}
                      </div>
                      {r.items.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {r.items.slice(0, 5).map((item, i) => (
                            <span key={i} className="inline-flex items-center gap-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-[10px] px-1.5 py-0.5 rounded-full">
                              {item.name} ({item.quantity} {item.unit})
                            </span>
                          ))}
                          {r.items.length > 5 && (
                            <span className="text-[10px] text-gray-400 dark:text-gray-500">+{r.items.length - 5} more</span>
                          )}
                        </div>
                      )}
                    </div>
                  </label>
                ))}
              </div>
              <button
                onClick={handleSaveTag}
                disabled={!selectedTagRecipeId || tagging}
                className="bg-indigo-600 text-white px-6 py-2.5 rounded-lg text-sm font-bold hover:bg-indigo-700 disabled:opacity-50 transition"
              >
                {tagging ? 'Tagging...' : 'Tag to Selected'}
              </button>
            </>
          )}
        </div>
      )}

      {/* Recipe Editor — shown when recipe exists OR when user clicks "Create New" */}
      {selectedPartyId && selectedQualityId && (recipe || showNewRecipe) && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5 mb-6 space-y-4">
          {loadingRecipe ? (
            <div className="p-8 text-center text-gray-400 dark:text-gray-500">Loading recipe...</div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">
                  {recipe ? (
                    recipe.isTagged
                      ? `Recipe (tagged from ${recipe.taggedFrom})`
                      : `Edit Recipe — ${recipe.variant || 'Standard'}`
                  ) : 'New Recipe'}
                </h2>
                <div className="flex items-center gap-3">
                  {recipe && (
                    <span className="text-[10px] text-gray-400 dark:text-gray-500">
                      Updated: {new Date(recipe.updatedAt).toLocaleDateString('en-IN')}
                    </span>
                  )}
                  {showNewRecipe && !recipe && (
                    <button onClick={() => setShowNewRecipe(false)} className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">Cancel</button>
                  )}
                </div>
              </div>

              {/* Variant selector + add new variant */}
              {recipe?.variants && recipe.variants.length > 1 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] text-gray-500">Variants:</span>
                  {recipe.variants.map((v: any) => (
                    <button key={v.id} onClick={() => {
                      setVariantName(v.variant)
                      // Reload this variant
                      fetch(`/api/finish/recipe?partyId=${selectedPartyId}&qualityId=${selectedQualityId}&variant=${encodeURIComponent(v.variant)}`)
                        .then(r => r.json()).then(d => { if (d?.id) setRecipe(d) })
                    }}
                      className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${v.variant === (recipe.variant || 'Standard')
                        ? 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 border-teal-300 dark:border-teal-700'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-600'}`}>
                      {v.variant}{v.isDefault ? ' ★' : ''}
                    </button>
                  ))}
                  <button onClick={() => { setShowNewRecipe(true); setRecipe(null); setVariantName(''); setItems([{ name: '', chemicalId: null, quantity: '', unit: 'kg' }]) }}
                    className="text-[10px] text-teal-600 dark:text-teal-400 hover:text-teal-700 font-medium">+ New Variant</button>
                </div>
              )}

              {/* Variant name input for new recipe */}
              {!recipe && showNewRecipe && (
                <div>
                  <label className="block text-[10px] text-gray-500 mb-0.5">Variant Name</label>
                  <input value={variantName} onChange={e => setVariantName(e.target.value)} placeholder="e.g. Standard, Premium Soft, Extra Calender"
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-teal-400" />
                </div>
              )}

              {/* Add variant button when only 1 exists */}
              {recipe && !recipe.isTagged && (!recipe.variants || recipe.variants.length <= 1) && (
                <button onClick={() => { setShowNewRecipe(true); setRecipe(null); setVariantName(''); setItems([{ name: '', chemicalId: null, quantity: '', unit: 'kg' }]) }}
                  className="text-xs text-teal-600 dark:text-teal-400 hover:text-teal-700 font-medium">+ Add Another Variant</button>
              )}

              {/* Tagged recipe info banner */}
              {recipe?.isTagged && (
                <div className="rounded-lg px-4 py-3 text-sm bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300">
                  This quality uses the recipe from <span className="font-bold">{recipe.taggedFrom}</span>. The recipe is read-only here.
                </div>
              )}

              {/* Also used by (tags) */}
              {recipe && !recipe.isTagged && recipe.tags && recipe.tags.length > 0 && (
                <div className="rounded-lg px-4 py-3 bg-gray-50 dark:bg-gray-900/30 border border-gray-200 dark:border-gray-700">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Also used by:</p>
                  <div className="flex flex-wrap gap-2">
                    {recipe.tags.map(tag => (
                      <span key={tag.id} className="inline-flex items-center gap-1.5 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 text-xs px-2.5 py-1 rounded-full border border-indigo-200 dark:border-indigo-800">
                        {tag.quality.name}
                        <button
                          onClick={() => handleRemoveTag(tag.id)}
                          className="text-indigo-400 hover:text-red-500 dark:hover:text-red-400 text-sm leading-none"
                          title="Remove tag"
                        >
                          &times;
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {message && (
                <div className={`rounded-lg px-4 py-3 text-sm ${message.includes('success') || message.includes('saved') || message.includes('Tagged') ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300' : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'}`}>
                  {message}
                </div>
              )}

              {/* Width fields — editable only if not tagged */}
              {!recipe?.isTagged && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Finish Width</label>
                      <input type="text" value={finishWidth} onChange={e => setFinishWidth(e.target.value)}
                        placeholder="e.g. 44 inch" className={inputClass} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Final Width</label>
                      <input type="text" value={finalWidth} onChange={e => setFinalWidth(e.target.value)}
                        placeholder="e.g. 42 inch" className={inputClass} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Shortage</label>
                      <input type="text" value={shortage} onChange={e => setShortage(e.target.value)}
                        placeholder="e.g. 3 mtr" className={inputClass} />
                    </div>
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Notes</label>
                    <textarea value={notes} onChange={e => setNotes(e.target.value)}
                      rows={2} placeholder="Optional notes..."
                      className={inputClass + ' resize-none'} />
                  </div>

                  {/* Chemical items */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Chemicals</label>
                      <button type="button" onClick={addItem}
                        className="text-xs text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300 font-medium">
                        + Add Chemical
                      </button>
                    </div>
                    {items.length > 0 ? (
                      <div className="space-y-2">
                        {items.map((item, i) => (
                          <ChemicalRow key={i} item={item} index={i} chemicals={masterChemicals} onUpdate={updateItem} onRemove={removeItem} />
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400 dark:text-gray-500 italic">No chemicals added yet. Click + Add Chemical.</p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-3 pt-2 flex-wrap">
                    <button onClick={handleSave} disabled={saving}
                      className="bg-teal-600 text-white px-6 py-2.5 rounded-lg text-sm font-bold hover:bg-teal-700 disabled:opacity-50 transition">
                      {saving ? 'Saving...' : recipe ? 'Update Recipe' : 'Save Recipe'}
                    </button>
                    {recipe && !deleteConfirm && (
                      <button onClick={() => setDeleteConfirm(true)}
                        className="text-sm text-red-400 hover:text-red-600 dark:hover:text-red-300 font-medium">
                        Delete Recipe
                      </button>
                    )}
                    {deleteConfirm && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-red-600 dark:text-red-400">Confirm delete?</span>
                        <button onClick={handleDelete} disabled={deleting}
                          className="text-xs text-red-600 dark:text-red-400 font-bold hover:text-red-700 disabled:opacity-50">
                          {deleting ? 'Deleting...' : 'Yes, Delete'}
                        </button>
                        <button onClick={() => setDeleteConfirm(false)}
                          className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">Cancel</button>
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Read-only view for tagged recipe */}
              {recipe?.isTagged && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                    {recipe.finishWidth && (
                      <div>
                        <span className="text-xs text-gray-500 dark:text-gray-400">Finish Width:</span>
                        <p className="text-gray-800 dark:text-gray-100">{recipe.finishWidth}</p>
                      </div>
                    )}
                    {recipe.finalWidth && (
                      <div>
                        <span className="text-xs text-gray-500 dark:text-gray-400">Final Width:</span>
                        <p className="text-gray-800 dark:text-gray-100">{recipe.finalWidth}</p>
                      </div>
                    )}
                    {recipe.shortage && (
                      <div>
                        <span className="text-xs text-gray-500 dark:text-gray-400">Shortage:</span>
                        <p className="text-gray-800 dark:text-gray-100">{recipe.shortage}</p>
                      </div>
                    )}
                  </div>
                  {recipe.items.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Chemicals:</p>
                      <div className="flex flex-wrap gap-1.5">
                        {recipe.items.map((item, i) => (
                          <span key={i} className="inline-flex items-center gap-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-[11px] px-2 py-0.5 rounded-full">
                            {item.name} <span className="text-gray-400 dark:text-gray-500">({item.quantity} {item.unit})</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* All saved recipes list */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">All Saved Recipes</h2>
          <input
            type="text"
            placeholder="Search party or quality..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-teal-400 w-48"
          />
        </div>
        {!allRecipes ? (
          <div className="p-8 text-center text-gray-400 dark:text-gray-500">Loading...</div>
        ) : filteredRecipes.length === 0 ? (
          <div className="p-8 text-center text-gray-400 dark:text-gray-500">No recipes found.</div>
        ) : (
          <div className="space-y-2">
            {filteredRecipes.map(r => (
              <div
                key={r.id}
                onClick={() => {
                  setSelectedPartyId(r.partyId)
                  // Need to wait for qualities to load, then set quality
                  setTimeout(() => setSelectedQualityId(r.qualityId), 300)
                }}
                className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4 cursor-pointer hover:border-teal-300 dark:hover:border-teal-700 transition"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-bold text-gray-800 dark:text-gray-100">{r.party.name}</span>
                    <span className="text-gray-300 dark:text-gray-600 mx-2">/</span>
                    <span className="text-sm text-gray-600 dark:text-gray-300">{r.quality.name}</span>
                    {r.variant && r.variant !== 'Standard' && (
                      <span className="ml-2 text-[10px] bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 px-1.5 py-0.5 rounded">{r.variant}</span>
                    )}
                  </div>
                  <span className="text-xs text-gray-400 dark:text-gray-500">{r.items.length} chemical{r.items.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="flex flex-wrap gap-3 mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                  {r.finishWidth && <span>FW: {r.finishWidth}</span>}
                  {r.finalWidth && <span>Final: {r.finalWidth}</span>}
                  {r.shortage && <span>Shortage: {r.shortage}</span>}
                </div>
                {r.items.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {r.items.map((item, i) => (
                      <span key={i} className="inline-flex items-center gap-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-[11px] px-2 py-0.5 rounded-full">
                        {item.name} <span className="text-gray-400 dark:text-gray-500">({item.quantity} {item.unit})</span>
                      </span>
                    ))}
                  </div>
                )}
                {/* Show tags below recipe in list */}
                {r.tags && r.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 mr-0.5">Also:</span>
                    {r.tags.map(tag => (
                      <span key={tag.id} className="inline-flex items-center bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-300 text-[10px] px-1.5 py-0.5 rounded-full border border-indigo-200 dark:border-indigo-800">
                        {tag.quality.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
