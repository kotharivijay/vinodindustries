'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import useSWR from 'swr'
import BackButton from '../../BackButton'

const fetcher = (url: string) => fetch(url).then(r => r.json())

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

interface Recipe {
  id: number
  partyId: number
  qualityId: number
  party: { id: number; name: string }
  quality: { id: number; name: string }
  finishWidth: string | null
  finalWidth: string | null
  shortage: string | null
  notes: string | null
  items: RecipeItem[]
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
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<{ name: string; chemicalId: number | null; quantity: string; unit: string }[]>([])
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [message, setMessage] = useState('')
  const [searchTerm, setSearchTerm] = useState('')

  // Load qualities when party changes
  useEffect(() => {
    if (!selectedPartyId) { setPartyQualities([]); return }
    setLoadingQualities(true)
    setSelectedQualityId(null)
    setRecipe(null)
    // Fetch qualities that exist in grey entries for this party
    fetch(`/api/finish/recipe?partyId=${selectedPartyId}`)
      .then(r => r.json())
      .then(() => {
        // Fetch all grey entries for this party to get unique qualities
        fetch(`/api/masters/qualities`)
          .then(r => r.json())
          .then((qs: Quality[]) => {
            setPartyQualities(Array.isArray(qs) ? qs : [])
            setLoadingQualities(false)
          })
          .catch(() => setLoadingQualities(false))
      })
      .catch(() => setLoadingQualities(false))
  }, [selectedPartyId])

  // Load recipe when both party and quality selected
  useEffect(() => {
    if (!selectedPartyId || !selectedQualityId) { setRecipe(null); return }
    setLoadingRecipe(true)
    setMessage('')
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

  // Filter all recipes for bottom list
  const filteredRecipes = useMemo(() => {
    if (!allRecipes) return []
    const term = searchTerm.toLowerCase()
    if (!term) return allRecipes
    return allRecipes.filter(r =>
      r.party.name.toLowerCase().includes(term) ||
      r.quality.name.toLowerCase().includes(term)
    )
  }, [allRecipes, searchTerm])

  const masterChemicals = chemicals ?? []

  const inputClass = "w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-teal-400"

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <BackButton />
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Finish Recipe Master</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Manage finish recipes by party and quality</p>
        </div>
      </div>

      {/* Party + Quality dropdowns */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Party</label>
          <select
            value={selectedPartyId ?? ''}
            onChange={e => setSelectedPartyId(e.target.value ? parseInt(e.target.value) : null)}
            className={inputClass}
          >
            <option value="">Select party...</option>
            {(parties ?? []).map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Quality</label>
          <select
            value={selectedQualityId ?? ''}
            onChange={e => setSelectedQualityId(e.target.value ? parseInt(e.target.value) : null)}
            disabled={!selectedPartyId || loadingQualities}
            className={inputClass + ' disabled:opacity-50'}
          >
            <option value="">Select quality...</option>
            {partyQualities.map(q => (
              <option key={q.id} value={q.id}>{q.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Recipe Editor */}
      {selectedPartyId && selectedQualityId && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5 mb-6 space-y-4">
          {loadingRecipe ? (
            <div className="p-8 text-center text-gray-400 dark:text-gray-500">Loading recipe...</div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">
                  {recipe ? `Edit Recipe #${recipe.id}` : 'New Recipe'}
                </h2>
                {recipe && (
                  <span className="text-[10px] text-gray-400 dark:text-gray-500">
                    Updated: {new Date(recipe.updatedAt).toLocaleDateString('en-IN')}
                  </span>
                )}
              </div>

              {message && (
                <div className={`rounded-lg px-4 py-3 text-sm ${message.includes('success') || message.includes('saved') ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300' : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'}`}>
                  {message}
                </div>
              )}

              {/* Width fields */}
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
                      <div key={i} className="flex items-center gap-2">
                        <div className="relative flex-1">
                          <input type="text" placeholder="Chemical name" value={item.name}
                            onChange={e => updateItem(i, 'name', e.target.value)}
                            className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-teal-400"
                            list={`recipe-chem-${i}`} />
                          <datalist id={`recipe-chem-${i}`}>
                            {masterChemicals.map(m => (
                              <option key={m.id} value={m.name} />
                            ))}
                          </datalist>
                        </div>
                        <input type="number" step="0.01" placeholder="Qty" value={item.quantity}
                          onChange={e => updateItem(i, 'quantity', e.target.value)}
                          className="w-20 border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-teal-400" />
                        <select value={item.unit} onChange={e => updateItem(i, 'unit', e.target.value)}
                          className="w-16 border border-gray-300 dark:border-gray-600 rounded px-1 py-1.5 text-xs bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-teal-400">
                          <option value="kg">kg</option>
                          <option value="ltr">ltr</option>
                          <option value="gm">gm</option>
                          <option value="ml">ml</option>
                        </select>
                        <button type="button" onClick={() => removeItem(i)}
                          className="text-red-400 hover:text-red-600 text-lg leading-none">&times;</button>
                      </div>
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
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
