'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Stage = 'finish' | 'folding' | null

const LABEL: Record<string, string> = {
  '': 'Default (Grey → Fold → Dye → Finish → Folding → Pack)',
  finish: 'Finish (skip Grey/Fold/Dye)',
  folding: 'Folding (skip up to Finish)',
}

const SHORT: Record<string, string> = {
  '': 'Default',
  finish: 'Finish',
  folding: 'Folding',
}

/**
 * For current-year lots that arrived already-processed (e.g., already dyed)
 * and should skip the upstream pipeline. Writes through to all GreyEntry rows
 * for this lot via /api/lot/[lotNo]/start-stage.
 */
export default function EditStartStage({ lotNo, initial }: { lotNo: string; initial: Stage }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [stage, setStage] = useState<Stage>(initial)
  const [saving, setSaving] = useState(false)

  async function save(next: Stage) {
    setSaving(true)
    try {
      const res = await fetch(`/api/lot/${encodeURIComponent(lotNo)}/start-stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: next }),
      })
      const d = await res.json()
      if (!res.ok) { alert('Save failed: ' + (d.error || res.status)); return }
      setStage(next)
      setOpen(false)
      router.refresh()
    } finally { setSaving(false) }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`text-[11px] font-medium px-2 py-1 rounded-full border ${
          stage
            ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300'
            : 'bg-gray-50 dark:bg-gray-700/30 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300'
        }`}
        title="Skip upstream stages — for lots received already processed"
      >
        Start: <span className="font-semibold">{SHORT[stage ?? '']}</span> <span className="text-[9px] opacity-70">📝</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <div onClick={e => e.stopPropagation()} className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-5 w-full max-w-sm space-y-3">
            <h3 className="text-base font-bold text-gray-800 dark:text-gray-100">Lot Start Stage</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Choose where this lot enters the pipeline. Use <strong>Finish</strong> for material received already-dyed, or
              <strong> Folding</strong> for material that only needs final folding.
            </p>
            {(['', 'finish', 'folding'] as const).map(opt => {
              const value: Stage = opt === '' ? null : opt
              const isCurrent = (stage ?? '') === opt
              return (
                <button
                  key={opt || 'default'}
                  disabled={saving}
                  onClick={() => save(value)}
                  className={`w-full text-left px-3 py-2 rounded-lg border text-sm ${
                    isCurrent
                      ? 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300'
                      : 'bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 hover:border-indigo-300 dark:hover:border-indigo-700'
                  } disabled:opacity-50`}
                >
                  <span className="font-semibold">{SHORT[opt]}</span>
                  <span className="block text-[11px] opacity-70 mt-0.5">{LABEL[opt]}</span>
                </button>
              )
            })}
            <div className="flex gap-2 pt-1">
              <button onClick={() => setOpen(false)} className="flex-1 px-3 py-2 rounded-lg text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200">Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
