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
  marka: string | null
  party: { name: string; tag?: string | null }
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

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
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
  // For each lot, track how much than has already been checked across every
  // saved slip. Non-PC-Job lots check all-or-nothing in one slip, so this
  // matches the previous "is this lot on a slip" behavior. Pali PC Job lots
  // can be checked partially across multiple slips, so we sum than per lot
  // and only hide the lot once the running total reaches the grey total.
  const { data: existingSlips = [] } = useSWR<{ lots: { lotNo: string; than: number }[] }[]>(
    '/api/grey/checking', fetcher, { revalidateOnFocus: false }
  )
  const checkedThanByLot = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of existingSlips) {
      for (const l of s.lots) {
        const k = l.lotNo.toLowerCase()
        m.set(k, (m.get(k) || 0) + (l.than || 0))
      }
    }
    return m
  }, [existingSlips])
  const isPcJob = (e: GreyEntry) => e.party.tag === 'Pali PC Job'
  const remainingThan = (e: GreyEntry) =>
    Math.max(0, e.than - (checkedThanByLot.get(e.lotNo.toLowerCase()) || 0))

  const [date, setDate] = useState<string>(todayISO())
  const [slipNo, setSlipNo] = useState<string>('')
  const [checkerName, setCheckerName] = useState<string>('Tulsaram')
  const [notes, setNotes] = useState<string>('')

  const [lotSearch, setLotSearch] = useState(''); const [debLot, setDebLot] = useDebounce('')
  const [partySearch, setPartySearch] = useState(''); const [debParty, setDebParty] = useDebounce('')
  const [lrSearch, setLrSearch] = useState(''); const [debLr, setDebLr] = useDebounce('')
  const [baleSearch, setBaleSearch] = useState(''); const [debBale, setDebBale] = useDebounce('')

  // Selection now carries the than value to be recorded per lot. For non-PC-Job
  // lots this is always entry.than (full lot). For Pali PC Job lots it defaults
  // to remainingThan(entry) and the operator can lower it via the input on the
  // card before saving.
  const [selected, setSelected] = useState<Map<number, number>>(new Map())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>('')
  // Tab inside the modal: 'save' = create a checking slip in DB
  //                       'program' = share an as-yet-unchecked lot list on WhatsApp (no DB write)
  const [innerTab, setInnerTab] = useState<'save' | 'program'>('save')
  const [sharing, setSharing] = useState(false)

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
      .filter(e => remainingThan(e) > 0) // hide once the lot's check-than is fully recorded
      .filter(e => !lot || e.lotNo.toLowerCase().includes(lot))
      .filter(e => !party || e.party.name.toLowerCase().includes(party))
      .filter(e => !lr || (e.transportLrNo ?? '').toLowerCase().includes(lr))
      .filter(e => !bale || (e.baleNo ?? '').toLowerCase().includes(bale))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  }, [entries, debLot, debParty, debLr, debBale, checkedThanByLot])

  // Sum across ALL selected lots' chosen than (not the lot total). For PC Job
  // partials, this reflects the actual than being recorded on this slip.
  const totalThan = useMemo(() => {
    let s = 0
    for (const v of selected.values()) s += v
    return s
  }, [selected])

  // Default than for a fresh selection — full lot for normal parties,
  // remaining-than for PC Job (so partial checks pre-fill the typical case).
  const defaultThanFor = (e: GreyEntry) => isPcJob(e) ? remainingThan(e) : e.than

  // Toggle selection at the LOT level (still — even with partial than, the lot
  // is the atomic selection unit; the than amount is just editable on PC Job).
  function toggle(id: number) {
    const e = entries.find(x => x.id === id)
    if (!e) return
    const sameLot = entries.filter(x => x.lotNo.toLowerCase() === e.lotNo.toLowerCase())
    setSelected(prev => {
      const next = new Map(prev)
      const turnOff = sameLot.every(x => next.has(x.id))
      if (turnOff) sameLot.forEach(x => next.delete(x.id))
      else sameLot.forEach(x => next.set(x.id, defaultThanFor(x)))
      return next
    })
  }

  // Update the editable than for a PC Job lot (clamps to [1, remainingThan]).
  function setEntryThan(id: number, raw: number) {
    const e = entries.find(x => x.id === id)
    if (!e) return
    const max = remainingThan(e)
    const clamped = Math.max(1, Math.min(max, Math.floor(raw) || 0))
    setSelected(prev => {
      const next = new Map(prev)
      if (next.has(id)) next.set(id, clamped)
      return next
    })
  }

  function toggleAllVisible() {
    const visibleLots = new Set(filtered.map(e => e.lotNo.toLowerCase()))
    const lotEntries = entries.filter(e => visibleLots.has(e.lotNo.toLowerCase()))
    const allOn = lotEntries.every(e => selected.has(e.id))
    setSelected(prev => {
      const next = new Map(prev)
      if (allOn) lotEntries.forEach(e => next.delete(e.id))
      else lotEntries.forEach(e => next.set(e.id, defaultThanFor(e)))
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

  // Render the selected lots as a portrait PNG and share via WhatsApp.
  // Canvas-drawn (no html2canvas) — mirrors the pattern used in
  // app/(dashboard)/vi/orders/page.tsx and app/(dashboard)/vi/outstanding/page.tsx.
  async function handleShareProgram() {
    setError('')
    if (selected.size === 0) { setError('Select at least one lot'); return }
    setSharing(true)
    try {
      // Each selected entry carries its checking-than (full lot for non-PC-Job,
      // possibly partial for PC Job). The PNG reflects the actual than the
      // checker will record, not the lot's full than.
      const rows = entries
        .filter(e => selected.has(e.id))
        .map(e => ({ ...e, checkThan: selected.get(e.id) ?? e.than }))
      rows.sort((a, b) => a.lotNo.localeCompare(b.lotNo))
      const totalThan = rows.reduce((s, r) => s + r.checkThan, 0)
      const W = 720
      const headerH = 90
      const tableHeaderH = 28
      const baseRowH = 32
      const lineH = 14 // height of each extra wrapped LR line
      const footerH = 70
      const padY = 8

      // Pre-compute the wrapped LR lines per row. LR values like
      // "2606696,2606907,2611255,2611256" arrive comma-joined for multi-LR
      // shipments — split each onto its own line so the operator can read
      // every number without truncation.
      const lrLinesByRow: string[][] = rows.map(r => {
        const raw = (r.transportLrNo || '—').trim()
        if (raw === '—') return ['—']
        return raw.split(',').map(s => s.trim()).filter(Boolean)
      })
      const rowHeights: number[] = lrLinesByRow.map(lines =>
        Math.max(baseRowH, baseRowH + (lines.length - 1) * lineH)
      )
      const tableBodyH = rowHeights.reduce((s, h) => s + h, 0)
      const H = headerH + tableHeaderH + tableBodyH + footerH + padY * 2

      const canvas = document.createElement('canvas')
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = W * dpr
      canvas.height = H * dpr
      canvas.style.width = W + 'px'
      canvas.style.height = H + 'px'
      const ctx = canvas.getContext('2d')!
      ctx.scale(dpr, dpr)

      // Background
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, W, H)

      // Header band
      ctx.fillStyle = '#1e293b'
      ctx.fillRect(0, 0, W, headerH)
      ctx.fillStyle = '#e94560'
      ctx.fillRect(0, headerH, W, 3)

      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 22px Arial'
      ctx.fillText('KSI — Grey Checking Program', 16, 34)
      const dateLabel = new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
      ctx.font = '14px Arial'
      ctx.fillText('Date: ' + dateLabel, 16, 58)
      ctx.fillText(`${rows.length} bale${rows.length === 1 ? '' : 's'} · ${new Set(rows.map(r => r.lotNo)).size} lots`, 16, 78)

      // Table header. Marka is added between Bale and Than — narrow on
      // non-PC-Job rows (often blank), important on PC Job rows.
      const cols = { sn: 16, lot: 50, party: 150, qual: 310, lr: 430, bale: 490, marka: 575, than: 704 }
      const tHeaderY = headerH + padY
      ctx.fillStyle = '#f1f5f9'
      ctx.fillRect(0, tHeaderY, W, tableHeaderH)
      ctx.fillStyle = '#475569'
      ctx.font = 'bold 12px Arial'
      ctx.fillText('#', cols.sn, tHeaderY + 18)
      ctx.fillText('Lot', cols.lot, tHeaderY + 18)
      ctx.fillText('Party', cols.party, tHeaderY + 18)
      ctx.fillText('Quality', cols.qual, tHeaderY + 18)
      ctx.fillText('LR', cols.lr, tHeaderY + 18)
      ctx.fillText('Bale', cols.bale, tHeaderY + 18)
      ctx.fillText('Marka', cols.marka, tHeaderY + 18)
      ctx.textAlign = 'right'
      ctx.fillText('Than', cols.than, tHeaderY + 18)
      ctx.textAlign = 'left'

      // Rows — variable height: each extra LR line adds lineH px.
      ctx.font = '13px Arial'
      let rowY = tHeaderY + tableHeaderH
      rows.forEach((r, i) => {
        const h = rowHeights[i]
        if (i % 2 === 0) {
          ctx.fillStyle = '#fafafa'
          ctx.fillRect(0, rowY, W, h)
        }
        ctx.fillStyle = '#0f172a'
        const baseY = rowY + 20 // baseline of first text line
        ctx.fillText(String(i + 1), cols.sn, baseY)
        ctx.fillStyle = '#4338ca'
        ctx.font = 'bold 13px Arial'
        ctx.fillText(truncate(r.lotNo, 12), cols.lot, baseY)
        ctx.fillStyle = '#0f172a'
        ctx.font = '13px Arial'
        ctx.fillText(truncate(r.party.name, 20), cols.party, baseY)
        ctx.fillText(truncate(r.quality.name, 14), cols.qual, baseY)
        // LR — wrap each comma-separated value onto its own line, no truncate
        ctx.fillStyle = '#64748b'
        const lrLines = lrLinesByRow[i]
        lrLines.forEach((line, li) => {
          ctx.fillText(line, cols.lr, baseY + li * lineH)
        })
        ctx.fillText(truncate(r.baleNo || '—', 11), cols.bale, baseY)
        // Marka — highlight when present so PC Job markings stand out
        if (r.marka) {
          ctx.fillStyle = '#b45309'
          ctx.font = 'bold 13px Arial'
        } else {
          ctx.fillStyle = '#cbd5e1'
        }
        ctx.fillText(truncate(r.marka || '—', 13), cols.marka, baseY)
        ctx.fillStyle = '#0f172a'
        ctx.font = 'bold 13px Arial'
        ctx.textAlign = 'right'
        ctx.fillText(String(r.checkThan), cols.than, baseY)
        ctx.textAlign = 'left'
        ctx.font = '13px Arial'
        rowY += h
      })

      // Footer
      const fy = tHeaderY + tableHeaderH + tableBodyH + padY
      ctx.fillStyle = '#1e293b'
      ctx.fillRect(0, fy, W, footerH)
      ctx.fillStyle = '#e94560'
      ctx.fillRect(0, fy, W, 2)
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 16px Arial'
      ctx.fillText(`TOTAL  (${rows.length} bales)`, 16, fy + 28)
      ctx.textAlign = 'right'
      ctx.font = 'bold 22px Arial'
      ctx.fillText('Than ' + totalThan, W - 16, fy + 32)
      ctx.textAlign = 'left'
      ctx.font = '12px Arial'
      ctx.fillStyle = '#cbd5e1'
      ctx.fillText('Please check & report findings.', 16, fy + 56)

      // Convert to PNG and share
      const blob: Blob = await new Promise((resolve) => canvas.toBlob(b => resolve(b!), 'image/png'))
      const fname = `grey-checking-program-${date}.png`
      const file = new File([blob], fname, { type: 'image/png' })

      // Mobile: native share sheet → WhatsApp
      if ((navigator as any).share && (navigator as any).canShare?.({ files: [file] })) {
        try {
          await (navigator as any).share({ files: [file], title: 'Grey Checking Program' })
          return
        } catch { /* user cancelled — fall through */ }
      }

      // Desktop fallback: download PNG + open WhatsApp Web with message
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fname
      a.click()
      URL.revokeObjectURL(url)
      const msg = `KSI — Grey Checking Program (${dateLabel})\n${rows.length} bales · ${totalThan} than\n(Image attached)`
      window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
    } catch (e: any) {
      setError(e?.message ?? 'Share failed')
    } finally {
      setSharing(false)
    }
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
          lots: Array.from(selected.entries()).map(([greyEntryId, than]) => ({ greyEntryId, than })),
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
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">
            🔍 Grey Checking — {innerTab === 'save' ? 'New Slip' : 'Checking Program'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl leading-none">×</button>
        </div>

        {/* Inner tabs */}
        <div className="px-5 pt-3 border-b border-gray-100 dark:border-gray-700 flex gap-1">
          <button
            onClick={() => setInnerTab('save')}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${innerTab === 'save' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            ✏️ Save Slip
          </button>
          <button
            onClick={() => setInnerTab('program')}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${innerTab === 'program' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            📋 Checking Program
          </button>
        </div>

        {/* Form fields */}
        <div className="p-5 space-y-4">
          <div className={`grid grid-cols-1 gap-3 ${innerTab === 'save' ? 'sm:grid-cols-3' : 'sm:grid-cols-1'}`}>
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Date</label>
              <input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} />
            </div>
            {innerTab === 'save' && (<>
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
            </>)}
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
              <span>Showing {filtered.length} of {entries.filter(e => e.id > 0 && e.stock > 0 && remainingThan(e) > 0).length} lots with than to check</span>
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
              const pcJob = isPcJob(e)
              const remaining = remainingThan(e)
              const alreadyChecked = e.than - remaining
              const currentThan = selected.get(e.id) ?? remaining
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
                      {pcJob && (
                        <span className="text-[10px] font-semibold bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded-full">
                          PC JOB
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      LR {e.transportLrNo || '—'} · Bale {e.bale ?? '—'} · Bale No {e.baleNo || '—'}
                      {e.marka && (
                        <span className="ml-1">· Marka <span className="font-semibold text-amber-700 dark:text-amber-400">{e.marka}</span></span>
                      )}
                    </div>
                    {pcJob && (
                      <div className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5">
                        Remaining: <strong>{remaining}</strong> / {e.than}
                        {alreadyChecked > 0 && <span className="text-gray-400 dark:text-gray-500"> · {alreadyChecked} already checked</span>}
                      </div>
                    )}
                    {pcJob && checked && (
                      <div
                        className="mt-2 flex items-center gap-2"
                        onClick={ev => ev.preventDefault()}
                      >
                        <span className="text-[11px] text-gray-600 dark:text-gray-300">Checking now:</span>
                        <input
                          type="number"
                          min={1}
                          max={remaining}
                          value={currentThan}
                          onClick={ev => ev.stopPropagation()}
                          onChange={ev => setEntryThan(e.id, parseInt(ev.target.value, 10))}
                          className="w-20 border border-amber-300 dark:border-amber-600 rounded px-2 py-0.5 text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-amber-400"
                        />
                        <span className="text-[11px] text-gray-400">than (max {remaining})</span>
                      </div>
                    )}
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
          <div className="flex items-baseline gap-3">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Selected <span className="font-semibold text-gray-800 dark:text-gray-100">{selected.size}</span> lot{selected.size === 1 ? '' : 's'}
            </span>
            <span className="text-gray-300 dark:text-gray-600">·</span>
            <span className="text-sm text-gray-500 dark:text-gray-400">Total Than</span>
            <span className="text-xl font-bold text-indigo-700 dark:text-indigo-400 leading-none">{totalThan}</span>
          </div>
          <div className="flex items-center gap-3">
            {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
            <button onClick={onClose} disabled={saving || sharing} className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">Cancel</button>
            {innerTab === 'save' ? (
              <button
                onClick={handleSave}
                disabled={saving || selected.size === 0}
                className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save Checking'}
              </button>
            ) : (
              <button
                onClick={handleShareProgram}
                disabled={sharing || selected.size === 0}
                className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 flex items-center gap-1"
              >
                {sharing ? 'Rendering…' : '📤 Share on WhatsApp'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
