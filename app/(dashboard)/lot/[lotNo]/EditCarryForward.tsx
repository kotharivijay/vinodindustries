'use client'

import { useState } from 'react'

interface Props {
  lotNo: string
  weight: string | null
  grayMtr: number | null
}

export default function EditCarryForward({ lotNo, weight: initWeight, grayMtr: initMtr }: Props) {
  const [editing, setEditing] = useState(false)
  const [weight, setWeight] = useState(initWeight || '')
  const [grayMtr, setGrayMtr] = useState(initMtr != null ? String(initMtr) : '')
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/api/grey/carry-forward', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lotNo,
          weight: weight.trim() || null,
          grayMtr: grayMtr.trim() ? parseFloat(grayMtr) : null,
        }),
      })
      if (!res.ok) throw new Error('Failed')
      setEditing(false)
      window.location.reload()
    } catch {
      alert('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <button onClick={() => setEditing(true)} className="text-[10px] text-indigo-500 hover:text-indigo-400 underline">
        Edit
      </button>
    )
  }

  return (
    <div className="flex flex-wrap items-end gap-2 mt-2 p-2 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg border border-indigo-200 dark:border-indigo-800">
      <div>
        <label className="block text-[10px] text-gray-500 mb-0.5">Weight</label>
        <input value={weight} onChange={e => setWeight(e.target.value)} placeholder="e.g. 90g"
          className="w-24 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-800 rounded px-2 py-1" />
      </div>
      <div>
        <label className="block text-[10px] text-gray-500 mb-0.5">Gray Mtr</label>
        <input value={grayMtr} onChange={e => setGrayMtr(e.target.value)} placeholder="e.g. 1250.5" type="number" step="0.1"
          className="w-28 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-800 rounded px-2 py-1" />
      </div>
      <button onClick={save} disabled={saving}
        className="text-xs font-medium bg-indigo-600 text-white px-3 py-1.5 rounded hover:bg-indigo-700 disabled:opacity-50">
        {saving ? 'Saving...' : 'Save'}
      </button>
      <button onClick={() => { setEditing(false); setWeight(initWeight || ''); setGrayMtr(initMtr != null ? String(initMtr) : '') }}
        className="text-xs text-gray-400 hover:text-gray-200">Cancel</button>
    </div>
  )
}
