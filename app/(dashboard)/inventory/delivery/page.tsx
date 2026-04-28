'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import useSWR from 'swr'
import BackButton from '../../BackButton'

const fetcher = (url: string) => fetch(url).then(r => r.json())
const fmtINR = (n: number) => '₹' + n.toLocaleString('en-IN')

interface DCItem { itemId: string; itemName: string; unit: string; itemDescription: string; quantity: string; rate: string; categoryName?: string }

export default function DeliveryChallanPage() {
  const { data: deliveries = [], mutate } = useSWR('/api/inventory/delivery', fetcher, { revalidateOnFocus: false })
  // Pull items from EVERY inventory category (Dyes, Packing, Machinery, Fuel,
  // Interlock, Motor, Others) so this single Delivery Challan entry can issue
  // any item.
  const { data: invData } = useSWR('/api/inventory?category=all', fetcher, { revalidateOnFocus: false })
  const { data: pos = [] } = useSWR('/api/inventory/po', fetcher, { revalidateOnFocus: false })
  const { data: ledgers = [] } = useSWR('/api/inventory/po?action=ledgers', fetcher, { revalidateOnFocus: false })
  const items = invData?.items || []

  const [creating, setCreating] = useState(false)
  const [challanNo, setChallanNo] = useState('')
  const [dcDate, setDcDate] = useState(new Date().toISOString().split('T')[0])
  const [partyName, setPartyName] = useState('')
  const [partySearch, setPartySearch] = useState('')
  const [partyDropOpen, setPartyDropOpen] = useState(false)
  const [selectedPoId, setSelectedPoId] = useState('')
  const [dcNotes, setDcNotes] = useState('')
  const [dcItems, setDcItems] = useState<DCItem[]>([])
  const [itemSearch, setItemSearch] = useState('')
  const [itemDropOpen, setItemDropOpen] = useState(false)
  const [aliases, setAliases] = useState<any[]>([])
  const [saving, setSaving] = useState(false)
  const partyRef = useRef<HTMLDivElement>(null)
  const itemRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (partyRef.current && !partyRef.current.contains(e.target as Node)) setPartyDropOpen(false)
      if (itemRef.current && !itemRef.current.contains(e.target as Node)) setItemDropOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filteredParties = useMemo(() => {
    const q = partySearch.toLowerCase()
    return ledgers.filter((l: any) => !q || l.name.toLowerCase().includes(q)).slice(0, 20)
  }, [ledgers, partySearch])

  const filteredItems = useMemo(() => {
    const q = itemSearch.toLowerCase()
    return items.filter((i: any) => !q || i.name.toLowerCase().includes(q)).slice(0, 20)
  }, [items, itemSearch])

  async function selectParty(name: string) {
    setPartyName(name)
    setPartyDropOpen(false)
    setPartySearch('')
    // Fetch aliases for this party
    if (dcItems.length > 0) {
      try {
        const res = await fetch('/api/inventory/po', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'aliases', itemIds: dcItems.map(i => i.itemId), partyName: name }),
        })
        const data = await res.json()
        setAliases(data)
        // Auto-fill aliases
        setDcItems(prev => prev.map(item => {
          const alias = data.find((a: any) => String(a.itemId) === item.itemId)
          return alias ? { ...item, itemDescription: alias.alias } : item
        }))
      } catch {}
    }
  }

  function selectPO(poId: string) {
    setSelectedPoId(poId)
    const po = pos.find((p: any) => p.id === parseInt(poId))
    if (po) {
      setPartyName(po.partyName)
      setDcItems(po.items.map((i: any) => ({
        itemId: String(i.itemId),
        itemName: i.item.name,
        unit: i.item.unit,
        itemDescription: '',
        quantity: String(i.quantity),
        rate: i.rate ? String(i.rate) : '',
      })))
    }
  }

  function addItem(item: any) {
    const alias = aliases.find((a: any) => a.itemId === item.id)
    setDcItems(prev => [...prev, {
      itemId: String(item.id), itemName: item.name, unit: item.unit,
      itemDescription: alias?.alias || item.name, quantity: '', rate: '',
      categoryName: item.categoryName,
    }])
    setItemDropOpen(false)
    setItemSearch('')
  }

  function updateItem(idx: number, field: keyof DCItem, value: string) {
    setDcItems(prev => { const u = [...prev]; u[idx] = { ...u[idx], [field]: value }; return u })
  }

  function removeItem(idx: number) { setDcItems(prev => prev.filter((_, i) => i !== idx)) }

  async function saveDC() {
    if (!challanNo || !partyName || dcItems.length === 0) return
    setSaving(true)
    await fetch('/api/inventory/delivery', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challanNo, date: dcDate, partyName, poId: selectedPoId || null, notes: dcNotes,
        items: dcItems,
      }),
    })
    setSaving(false)
    setCreating(false); setChallanNo(''); setPartyName(''); setDcItems([]); setSelectedPoId(''); setDcNotes('')
    mutate()
  }

  const totalAmount = dcItems.reduce((s, i) => s + (parseFloat(i.quantity) || 0) * (parseFloat(i.rate) || 0), 0)

  return (
    <div className="p-4 md:p-6 dark:text-gray-100">
      <div className="flex items-center gap-4 mb-5">
        <BackButton />
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Delivery Challan</h1>
        <button onClick={() => setCreating(true)} className="ml-auto text-xs bg-emerald-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-emerald-700">+ New Delivery</button>
      </div>

      {/* List */}
      {!creating && (
        <div className="space-y-2">
          {deliveries.length === 0 && <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-8 text-center text-gray-400">No deliveries yet.</div>}
          {deliveries.map((dc: any) => {
            const total = dc.items.reduce((s: number, i: any) => s + (i.amount || 0), 0)
            return (
              <div key={dc.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">DC-{dc.challanNo}</span>
                    {dc.po && <span className="text-[10px] bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 px-1.5 py-0.5 rounded">{dc.po.poNo}</span>}
                    <span className="text-[10px] text-gray-400">{new Date(dc.date).toLocaleDateString('en-IN')}</span>
                  </div>
                  {total > 0 && <span className="text-xs font-bold text-emerald-600">{fmtINR(Math.round(total))}</span>}
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-300 mb-1">{dc.partyName}</p>
                <div className="flex flex-wrap gap-1.5">
                  {dc.items.map((i: any) => (
                    <span key={i.id} className="text-[10px] bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded-full">
                      {i.item.name}{i.itemDescription && i.itemDescription !== i.item.name ? ` (${i.itemDescription})` : ''} — {i.quantity} {i.item.unit}{i.rate ? ` @ ${fmtINR(i.rate)}` : ''}
                    </span>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Create Form */}
      {creating && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border-2 border-emerald-300 dark:border-emerald-700 shadow-lg p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">New Delivery Challan</h2>
            <button onClick={() => { setCreating(false); setDcItems([]) }} className="text-gray-400 text-xl">&times;</button>
          </div>

          {/* Against PO (optional) */}
          <div>
            <label className="block text-[10px] text-gray-500 mb-0.5">Against PO (optional)</label>
            <select value={selectedPoId} onChange={e => selectPO(e.target.value)}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100">
              <option value="">Direct delivery (no PO)</option>
              {pos.filter((p: any) => p.status !== 'delivered').map((p: any) => (
                <option key={p.id} value={p.id}>{p.poNo} — {p.partyName} ({p.items.length} items)</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] text-gray-500 mb-0.5">Challan No</label>
              <input value={challanNo} onChange={e => setChallanNo(e.target.value)} placeholder="e.g. 12345"
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100" />
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 mb-0.5">Date</label>
              <input type="date" value={dcDate} onChange={e => setDcDate(e.target.value)}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100" />
            </div>
          </div>

          {/* Party */}
          <div ref={partyRef} className="relative">
            <label className="block text-[10px] text-gray-500 mb-0.5">Party</label>
            <button onClick={() => { setPartyDropOpen(!partyDropOpen); setPartySearch('') }}
              className="w-full text-left border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100">
              {partyName || 'Select party...'}
            </button>
            {partyDropOpen && (
              <div className="absolute z-30 top-full mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-2xl max-h-52 flex flex-col">
                <input autoFocus placeholder="Search..." value={partySearch} onChange={e => setPartySearch(e.target.value)}
                  className="px-3 py-2 text-sm border-b border-gray-100 dark:border-gray-700 bg-transparent focus:outline-none dark:text-gray-100" />
                <div className="overflow-y-auto flex-1">
                  {filteredParties.map((p: any, i: number) => (
                    <button key={i} onClick={() => selectParty(p.name)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-gray-700 dark:text-gray-200">
                      {p.name} {p.parent && <span className="text-[9px] text-gray-400">({p.parent})</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Add items */}
          <div ref={itemRef} className="relative">
            <label className="block text-[10px] text-gray-500 mb-0.5">Add Items</label>
            <input placeholder="🔍 Search item to add..." value={itemSearch}
              onChange={e => { setItemSearch(e.target.value); setItemDropOpen(true) }}
              onFocus={() => setItemDropOpen(true)}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100" />
            {itemDropOpen && itemSearch && (
              <div className="absolute z-30 top-full mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-xl max-h-40 overflow-y-auto">
                {filteredItems.filter((i: any) => !dcItems.some(d => d.itemId === String(i.id))).map((i: any) => (
                  <button key={i.id} onClick={() => addItem(i)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-gray-700 dark:text-gray-200 flex items-center justify-between gap-2">
                    <span className="truncate">{i.name} <span className="text-[10px] text-gray-400">({i.unit})</span></span>
                    {i.categoryName && (
                      <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 shrink-0">
                        {i.categoryName}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Items list */}
          {dcItems.length > 0 && (
            <div className="space-y-2">
              {dcItems.map((item, idx) => (
                <div key={idx} className="border border-gray-200 dark:border-gray-700 rounded-lg p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">{item.itemName}</span>
                      {item.categoryName && (
                        <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 shrink-0">
                          {item.categoryName}
                        </span>
                      )}
                    </div>
                    <button onClick={() => removeItem(idx)} className="text-red-400 text-sm">×</button>
                  </div>
                  <div className="flex gap-2">
                    <input placeholder="Party name for item" value={item.itemDescription} onChange={e => updateItem(idx, 'itemDescription', e.target.value)}
                      className="flex-1 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs bg-white dark:bg-gray-700 dark:text-gray-100" />
                    <input type="number" step="0.01" placeholder="Qty" value={item.quantity} onChange={e => updateItem(idx, 'quantity', e.target.value)}
                      className="w-16 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs bg-white dark:bg-gray-700 dark:text-gray-100" />
                    <input type="number" step="0.01" placeholder="Rate" value={item.rate} onChange={e => updateItem(idx, 'rate', e.target.value)}
                      className="w-16 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs bg-white dark:bg-gray-700 dark:text-gray-100" />
                  </div>
                </div>
              ))}
              {totalAmount > 0 && (
                <div className="text-right text-sm font-bold text-emerald-600">Total: {fmtINR(Math.round(totalAmount))}</div>
              )}
            </div>
          )}

          <input placeholder="Notes (optional)" value={dcNotes} onChange={e => setDcNotes(e.target.value)}
            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100" />

          <button onClick={saveDC} disabled={saving || !challanNo || !partyName || dcItems.length === 0}
            className="w-full bg-emerald-600 text-white py-2.5 rounded-lg text-sm font-bold hover:bg-emerald-700 disabled:opacity-50">
            {saving ? 'Saving...' : 'Confirm & Save'}
          </button>
        </div>
      )}
    </div>
  )
}
