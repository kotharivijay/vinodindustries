'use client'

import { useState } from 'react'

interface Allocation {
  id?: number
  stage: string
  than: number
  notes?: string | null
}

interface Props {
  balanceId: number
  openingThan: number
  initialAllocations: Allocation[]
}

const STAGES = [
  { value: 'dyed', label: 'Dyed (ready for finish)', color: 'text-pink-600 dark:text-pink-400' },
  { value: 'finished', label: 'Finished (ready for packing)', color: 'text-teal-600 dark:text-teal-400' },
  { value: 'packed', label: 'Packed (ready for despatch)', color: 'text-orange-600 dark:text-orange-400' },
]

export default function EditAllocations({ balanceId, openingThan, initialAllocations }: Props) {
  const [editing, setEditing] = useState(false)
  const [allocs, setAllocs] = useState<Allocation[]>(
    initialAllocations.length > 0
      ? initialAllocations.map(a => ({ stage: a.stage, than: a.than, notes: a.notes }))
      : []
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const totalAllocated = allocs.reduce((s, a) => s + (a.than || 0), 0)
  const remaining = openingThan - totalAllocated
  const overAllocated = totalAllocated > openingThan

  function addAlloc(stage: string) {
    setAllocs(prev => [...prev, { stage, than: Math.max(remaining, 1), notes: null }])
  }

  function updateAlloc(i: number, field: keyof Allocation, value: any) {
    setAllocs(prev => {
      const next = [...prev]
      next[i] = { ...next[i], [field]: field === 'than' ? parseInt(value) || 0 : value }
      return next
    })
  }

  function removeAlloc(i: number) {
    setAllocs(prev => prev.filter((_, idx) => idx !== i))
  }

  async function save() {
    if (overAllocated) { setError(`Over-allocated by ${totalAllocated - openingThan}`); return }
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/grey/ob-allocations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          balanceId,
          allocations: allocs.filter(a => a.than > 0).map(a => ({ stage: a.stage, than: a.than, notes: a.notes || null })),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Save failed')
      setEditing(false)
      window.location.reload()
    } catch (e: any) {
      setError(e.message || 'Failed')
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    const summary = initialAllocations.length > 0
      ? initialAllocations.map(a => `${a.than} ${a.stage}`).join(' · ')
      : 'No allocations (all as grey)'
    return (
      <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">Stage Allocation</span>
            <p className="text-xs text-gray-700 dark:text-gray-300 mt-0.5">{summary}</p>
          </div>
          <button onClick={() => setEditing(true)} className="text-[10px] bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-900/40 border border-purple-200 dark:border-purple-800 px-2.5 py-1 rounded-lg font-medium">
            Edit stages
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
      <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-xl p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-purple-700 dark:text-purple-400 uppercase tracking-wide">Allocate {openingThan} to stages</span>
          <button onClick={() => { setEditing(false); setError('') }} className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">Cancel</button>
        </div>

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2">{error}</div>
        )}

        {allocs.length === 0 && (
          <p className="text-xs text-gray-500 dark:text-gray-400 italic">No allocations. Lot is fully grey. Add a stage below.</p>
        )}

        {allocs.map((a, i) => (
          <div key={i} className="flex items-center gap-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-2">
            <select
              value={a.stage}
              onChange={e => updateAlloc(i, 'stage', e.target.value)}
              className="text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100"
            >
              {STAGES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <input
              type="number"
              value={a.than || ''}
              onChange={e => updateAlloc(i, 'than', e.target.value)}
              placeholder="Than"
              className="w-16 text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100"
            />
            <span className="text-[10px] text-gray-500">T</span>
            <input
              type="text"
              value={a.notes || ''}
              onChange={e => updateAlloc(i, 'notes', e.target.value)}
              placeholder="Notes (optional)"
              className="flex-1 text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100"
            />
            <button onClick={() => removeAlloc(i)} className="text-red-500 hover:text-red-700 text-lg leading-none">&times;</button>
          </div>
        ))}

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-gray-500">+ Add:</span>
          {STAGES.map(s => (
            <button key={s.value} onClick={() => addAlloc(s.value)}
              className={`text-[10px] ${s.color} border border-current hover:bg-current hover:text-white px-2 py-0.5 rounded-full font-medium transition`}
            >
              {s.value}
            </button>
          ))}
        </div>

        <div className={`text-xs flex items-center justify-between pt-2 border-t border-purple-200 dark:border-purple-800 ${overAllocated ? 'text-red-600' : 'text-gray-600 dark:text-gray-400'}`}>
          <span>
            Allocated: <strong>{totalAllocated}</strong> / {openingThan}
            {remaining > 0 && <span className="ml-2 text-gray-400">(remaining {remaining} = grey)</span>}
            {overAllocated && <span className="ml-2 text-red-600">(OVER by {-remaining})</span>}
          </span>
          <button
            onClick={save}
            disabled={saving || overAllocated}
            className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-xs font-medium px-3 py-1 rounded-lg"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
