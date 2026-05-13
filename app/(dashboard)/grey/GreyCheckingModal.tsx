'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'

interface GreyEntry {
  id: number
  date: string
  lotNo: string
  than: number
  bale: number | null
  baleNo: string | null
  transportLrNo: string | null
  party: { name: string }
  quality: { name: string }
  stock: number
}

interface Checker {
  id: number
  name: string
}

const fetcher = (url: string) => fetch(url).then(r => r.json())

function todayISO() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function useDebounce(value: string, delay = 200) {
  const [debounced, setDebounced] = useState(value)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const set = (v: string) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setDebounced(v), delay)
  }
  return [debounced, set] as const
}

export default function GreyCheckingModal({ onClose, onSaved }: {
  onClose: () => void
  onSaved: () => void
}) {
  const { data: entries = [] } = useSWR<GreyEntry[]>('/api/grey', fetcher, { revalidateOnFocus: false })
  const { data: checkers = [], mutate: mutateCheckers } = useSWR<Checker[]>('/api/checkers', fetcher, { revalidateOnFocus: false })
  const { data: nextSlip } = useSWR<{ next: string }>('/api/grey/checking/next-slip-no', fetcher, { revalidateOnFocus: false })

  const [date, setDate] = useState<string>(todayISO())
  const [slipNo, setSlipNo] = useState<string>('')
  const [checkerName, setCheckerName] = useState<string>('Tulsaram')
  const [notes, setNotes] = useState<string>('')

  const [lotSearch, setLotSearch] = useState(''); const [debLot, setDebLot] = useDebounce('')
  const [partySearch, setPartySearch] = useState(''); const [debParty, setDebParty] = useDebounce('')
  const [lrSearch, setLrSearch] = useState(''); const [debLr, setDebLr] = useDebounce('')
  const [baleSearch, setBaleSearch] = useState(''); const [debBale, setDebBale] = useDebounce('')

  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>('')

  useEffect(() => {
    if (!slipNo && nextSlip?.next) setSlipNo(nextSlip.next)
  }, [nextSlip, slipNo])

  const filtered = useMemo(() => {
    const lot = debLot.toLowerCase().trim()
    const party = debParty.toLowerCase().trim()
    const lr = debLr.toLowerCase().trim()
    const bale = debBale.toLowerCase().trim()
    return entries
      .filter(e => e.id > 0) // exclude carry-forward synthetic rows
      .filter(e => e.stock > 0)
      .filter(e => !lot || e.lotNo.toLowerCase().includes(lot))
      .filter(e => !party || e.party.name.toLowerCase().includes(party))
      .filter(e => !lr || (e.transportLrNo ?? '').toLowerCase().includes(lr))
      .filter(e => !bale || (e.baleNo ?? '').toLowerCase().includes(bale))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  }, [entries, debLot, debParty, debLr, debBale])

  const totalThan = useMemo(() =>
    filtered.filter(e => selected.has(e.id)).reduce((s, e) => s + e.than, 0),
    [filtered, selected]
  )

  function toggle(id: number) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleAllVisible() {
    const visibleIds = filtered.map(e => e.id)
    const allOn = visibleIds.every(id => selected.has(id))
    setSelected(prev => {
      const next = new Set(prev)
      if (allOn) visibleIds.forEach(id => next.delete(id))
      else visibleIds.forEach(id => next.add(id))
      return next
    })
  }

  async function handleAddChecker() {
    const name = prompt('New checker name')?.trim()
    if (!name) return
    const res = await fetch('/api/checkers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) { alert('Failed to add checker'); return }
    await mutateCheckers()
    setCheckerName(name)
  }

  async function handleSave() {
    setError('')
    if (!date) return setError('Date required')
    if (!slipNo.trim()) return setError('Slip No required')
    if (!checkerName.trim()) return setError('Checker required')
    if (selected.size === 0) return setError('Select at least one lot')

    setSaving(true)
    try {
      const res = await fetch('/api/grey/checking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slipNo: slipNo.trim(),
          date,
          checkerName: checkerName.trim(),
          notes: notes.trim() || null,
          greyEntryIds: Array.from(selected),
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data?.error ?? 'Save failed'); return }
      onSaved()
    } catch (e: any) {
      setError(e?.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400'

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-3xl my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">🔍 Grey Checking — New Slip</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl leading-none">×</button>
        </div>

        {/* Form fields */}
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Date</label>
              <input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Checking Slip No</label>
              <input type="text" className={inputCls} value={slipNo} onChange={e => setSlipNo(e.target.value)} placeholder="CHK-0001" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Checker Name</label>
              <div className="flex gap-1">
                <select className={inputCls} value={checkerName} onChange={e => {
                  if (e.target.value === '__add__') { handleAddChecker(); return }
                  setCheckerName(e.target.value)
                }}>
                  {checkers.length === 0 && <option value="Tulsaram">Tulsaram</option>}
                  {checkers.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                  <option value="__add__">+ Add new…</option>
                </select>
              </div>
            </div>
          </div>

          {/* Search row */}
          <div>
            <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Select Lots</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <input className={inputCls} placeholder="Lot…"   value={lotSearch}   onChange={e => { setLotSearch(e.target.value);   setDebLot(e.target.value) }} />
              <input className={inputCls} placeholder="Party…" value={partySearch} onChange={e => { setPartySearch(e.target.value); setDebParty(e.target.value) }} />
              <input className={inputCls} placeholder="LR No…" value={lrSearch}    onChange={e => { setLrSearch(e.target.value);    setDebLr(e.target.value) }} />
              <input className={inputCls} placeholder="Bale No…" value={baleSearch} onChange={e => { setBaleSearch(e.target.value); setDebBale(e.target.value) }} />
            </div>
            <div className="flex items-center justify-between mt-2 text-xs text-gray-500 dark:text-gray-400">
              <span>Showing {filtered.length} of {entries.filter(e => e.id > 0 && e.stock > 0).length} in-stock lots</span>
              {filtered.length > 0 && (
                <button onClick={toggleAllVisible} className="text-indigo-600 hover:text-indigo-800 font-medium">
                  {filtered.every(e => selected.has(e.id)) ? 'Unselect all visible' : 'Select all visible'}
                </button>
              )}
            </div>
          </div>

          {/* Lot cards */}
          <div className="max-h-[40vh] overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-700">
            {filtered.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-400 dark:text-gray-500">No matching lots.</div>
            ) : filtered.map(e => {
              const checked = selected.has(e.id)
              return (
                <label
                  key={e.id}
                  className={`flex items-start gap-3 p-3 cursor-pointer transition ${checked ? 'bg-indigo-50 dark:bg-indigo-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}`}
                >
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-indigo-600 shrink-0"
                    checked={checked}
                    onChange={() => toggle(e.id)}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="font-semibold text-indigo-700 dark:text-indigo-400">🔖 {e.lotNo}</span>
                      <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{e.party.name}</span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">· {e.quality.name}</span>
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      LR {e.transportLrNo || '—'} · Bale {e.bale ?? '—'} · Bale No {e.baleNo || '—'}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10px] text-gray-400 uppercase tracking-wide">Than</div>
                    <div className="text-base font-bold text-gray-800 dark:text-gray-100">{e.than}</div>
                  </div>
                </label>
              )
            })}
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Notes (optional)</label>
            <input className={inputCls} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any remarks for this checking slip…" />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between gap-3 bg-gray-50 dark:bg-gray-800/50 rounded-b-xl">
          <div className="text-sm">
            <span className="text-gray-500 dark:text-gray-400">Selected:</span>{' '}
            <span className="font-semibold text-gray-800 dark:text-gray-100">{selected.size}</span>
            <span className="text-gray-400 mx-1">·</span>
            <span className="text-gray-500 dark:text-gray-400">Than:</span>{' '}
            <span className="font-bold text-indigo-700 dark:text-indigo-400">{totalThan}</span>
          </div>
          <div className="flex items-center gap-3">
            {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
            <button onClick={onClose} disabled={saving} className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">Cancel</button>
            <button
              onClick={handleSave}
              disabled={saving || selected.size === 0}
              className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save Checking'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
