'use client'

import { useState, useMemo } from 'react'
import useSWR from 'swr'
import { useRouter } from 'next/navigation'
import BackButton from '../../../BackButton'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface Item { id: number; displayName: string; unit: string; reviewStatus: string; alias: { gstRate: string; tallyStockItem: string } }
interface Party { id: number; displayName: string }

interface Line { itemId: string; itemName: string; unit: string; qty: string; rate: string; reviewStatus?: string }

export default function NewChallanPage() {
  const router = useRouter()
  const { data: parties = [] } = useSWR<Party[]>('/api/inv/parties', fetcher)
  const { data: nextSeries } = useSWR<{ no: number; fy: string }>('/api/inv/series/next?type=inward', fetcher)

  const [partyId, setPartyId] = useState('')
  const [partyQ, setPartyQ] = useState('')
  const [partyOpen, setPartyOpen] = useState(false)
  const [challanNo, setChallanNo] = useState('')
  const [challanDate, setChallanDate] = useState(new Date().toISOString().slice(0, 10))
  const [biltyNo, setBiltyNo] = useState('')
  const [vehicleNo, setVehicleNo] = useState('')
  const [transporter, setTransporter] = useState('')
  const [defaultDiscountPct, setDefaultDiscountPct] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [saving, setSaving] = useState(false)
  const [dupCheck, setDupCheck] = useState<any>(null)

  // Tier-A items for selected party (last 90 days). Falls back to /items search.
  const { data: tierA = [] } = useSWR<Item[]>(partyId ? `/api/inv/items/by-party?partyId=${partyId}&days=90` : null, fetcher)
  const [itemQ, setItemQ] = useState('')
  const [itemOpen, setItemOpen] = useState(false)
  const { data: catalog = [] } = useSWR<Item[]>(itemQ ? `/api/inv/items?q=${encodeURIComponent(itemQ)}` : null, fetcher)
  const itemList = useMemo(() => {
    const seen = new Set<number>()
    const out: Item[] = []
    for (const i of [...(tierA || []), ...(catalog || [])]) {
      if (!seen.has(i.id)) { seen.add(i.id); out.push(i) }
    }
    return itemQ ? out.filter(i => i.displayName.toLowerCase().includes(itemQ.toLowerCase())) : out
  }, [tierA, catalog, itemQ])

  const filteredParties = useMemo(() => {
    const q = partyQ.toLowerCase()
    return (parties || []).filter(p => !q || p.displayName.toLowerCase().includes(q)).slice(0, 30)
  }, [parties, partyQ])

  function pickParty(p: Party) {
    setPartyId(String(p.id))
    setPartyQ(p.displayName)
    setPartyOpen(false)
  }

  function addItem(it: Item) {
    setLines(prev => [...prev, { itemId: String(it.id), itemName: it.displayName, unit: it.unit, qty: '', rate: '', reviewStatus: it.reviewStatus }])
    setItemQ(''); setItemOpen(false)
  }

  function updateLine(i: number, k: keyof Line, v: string) {
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, [k]: v } : l))
  }

  function removeLine(i: number) {
    setLines(prev => prev.filter((_, idx) => idx !== i))
  }

  async function checkDup() {
    if (!partyId || !challanNo) return
    const res = await fetch('/api/inv/challans/check-duplicate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partyId: Number(partyId), challanNo, date: challanDate }),
    })
    const d = await res.json()
    setDupCheck(d.duplicate ? d.dup : null)
  }

  const totalQty = lines.reduce((s, l) => s + (Number(l.qty) || 0), 0)
  const totalAmount = lines.reduce((s, l) => s + ((Number(l.qty) || 0) * (Number(l.rate) || 0)), 0)
  const ratelessLines = lines.filter(l => !l.rate).length

  async function save() {
    if (!partyId || !challanNo || !challanDate || !lines.length) {
      alert('Party, Challan No, Date, and at least one line are required.')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/inv/challans', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partyId: Number(partyId),
          challanNo, challanDate, biltyNo, vehicleNo, transporter,
          defaultDiscountPct: defaultDiscountPct || null,
          notes,
          lines: lines.map(l => ({ itemId: l.itemId, qty: l.qty, rate: l.rate || null, unit: l.unit })),
        }),
      })
      const d = await res.json()
      if (!res.ok) { alert('Save failed: ' + (d.error || res.status)); return }
      router.push(`/inventory/challans/${d.id}`)
    } finally { setSaving(false) }
  }

  return (
    <div className="p-4 md:p-8 max-w-4xl">
      <div className="flex items-center gap-3 mb-5">
        <BackButton />
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">New Inward Challan</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Will be assigned: <span className="font-mono font-bold">KSI/IN/{nextSeries?.fy}/{String(nextSeries?.no || 0).padStart(4, '0')}</span>
          </p>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-4">
        {/* Party + Challan no row */}
        <div className="grid md:grid-cols-2 gap-3">
          <div className="relative">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Party *</label>
            <input value={partyQ} onChange={e => { setPartyQ(e.target.value); setPartyId(''); setPartyOpen(true) }}
              onFocus={() => setPartyOpen(true)}
              placeholder="Search supplier…"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
            {partyOpen && filteredParties.length > 0 && !partyId && (
              <div className="absolute z-30 top-full mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl max-h-56 overflow-y-auto">
                {filteredParties.map(p => (
                  <button key={p.id} onClick={() => pickParty(p)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 dark:hover:bg-indigo-900/20">
                    {p.displayName}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Challan No *</label>
              <input value={challanNo} onChange={e => setChallanNo(e.target.value)} onBlur={checkDup}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Date *</label>
              <input type="date" value={challanDate} onChange={e => setChallanDate(e.target.value)} onBlur={checkDup}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
            </div>
          </div>
        </div>
        {dupCheck && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700 rounded-lg p-3 text-xs text-red-700 dark:text-red-300">
            ⚠️ Duplicate within ±3 days: existing series {dupCheck.seriesFy}/{dupCheck.internalSeriesNo} on {new Date(dupCheck.challanDate).toLocaleDateString('en-IN')} ({dupCheck.status})
          </div>
        )}

        {/* Transport row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            ['Bilty/LR No', biltyNo, setBiltyNo],
            ['Vehicle No', vehicleNo, setVehicleNo],
            ['Transporter', transporter, setTransporter],
            ['Discount %', defaultDiscountPct, setDefaultDiscountPct],
          ].map(([label, val, set]: any) => (
            <div key={label}>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{label}</label>
              <input value={val} onChange={e => set(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
            </div>
          ))}
        </div>

        {/* Items */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Lines</label>
            {ratelessLines > 0 && (
              <span className="text-[10px] text-amber-600 dark:text-amber-400">⚠️ {ratelessLines} line(s) without rate</span>
            )}
          </div>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-5 text-sm">
                  <span className="font-medium text-gray-800 dark:text-gray-100">{l.itemName}</span>
                  {l.reviewStatus === 'pending_review' && (
                    <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">Pending</span>
                  )}
                </div>
                <input type="number" step="0.001" placeholder="Qty" value={l.qty} onChange={e => updateLine(i, 'qty', e.target.value)}
                  className="col-span-2 px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
                <span className="col-span-1 text-xs text-gray-500">{l.unit}</span>
                <input type="number" step="0.0001" placeholder="Rate" value={l.rate} onChange={e => updateLine(i, 'rate', e.target.value)}
                  className="col-span-2 px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
                <span className="col-span-1 text-xs text-right text-gray-700 dark:text-gray-200">
                  {l.qty && l.rate ? '₹' + (Number(l.qty) * Number(l.rate)).toFixed(2) : '—'}
                </span>
                <button onClick={() => removeLine(i)} className="col-span-1 text-red-500 text-sm">×</button>
              </div>
            ))}
          </div>
          {/* Add-line picker */}
          <div className="relative mt-2">
            <input value={itemQ} onChange={e => { setItemQ(e.target.value); setItemOpen(true) }}
              onFocus={() => setItemOpen(true)}
              placeholder="🔍 Search item to add (Tier A items appear first when party is selected)…"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
            {itemOpen && itemList.length > 0 && (
              <div className="absolute z-30 top-full mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl max-h-64 overflow-y-auto">
                {itemList.slice(0, 30).map(it => (
                  <button key={it.id} onClick={() => addItem(it)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 dark:hover:bg-indigo-900/20 flex items-center justify-between gap-2">
                    <span>{it.displayName} <span className="text-[10px] text-gray-400">({it.unit})</span></span>
                    {it.reviewStatus === 'pending_review' && <span className="text-[10px] font-bold px-1 rounded bg-amber-100 text-amber-700">Pending</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Notes + totals */}
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
          </div>
          <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-3 text-sm space-y-1">
            <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Total qty:</span><span className="font-bold">{totalQty.toFixed(3)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Total amount:</span><span className="font-bold">₹{totalAmount.toLocaleString('en-IN')}</span></div>
          </div>
        </div>

        <div className="flex gap-2 justify-end pt-2 border-t border-gray-200 dark:border-gray-700">
          <button onClick={save} disabled={saving || !!dupCheck}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-6 py-2 rounded-lg text-sm font-semibold">
            {saving ? 'Saving…' : 'Save Draft'}
          </button>
        </div>
      </div>
    </div>
  )
}
