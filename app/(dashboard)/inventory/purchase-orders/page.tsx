'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import BackButton from '../../BackButton'

const fetcher = (url: string) => fetch(url).then(r => r.json())
const fmtINR = (n: number) => '₹' + n.toLocaleString('en-IN')

interface POItem { itemId: number; itemName: string; unit: string; quantity: string; rate: string; notes: string; aliasName: string }

export default function PurchaseOrdersPage() {
  const { data: pos = [], mutate } = useSWR('/api/inventory/po', fetcher, { revalidateOnFocus: false })
  const { data: invData } = useSWR('/api/inventory?category=Dyes%20%26%20Auxiliary', fetcher, { revalidateOnFocus: false })
  const items = invData?.items || []

  const [creating, setCreating] = useState(false)
  const [partyName, setPartyName] = useState('')
  const [partyMobile, setPartyMobile] = useState('')
  const [partySearch, setPartySearch] = useState('')
  const [partyDropOpen, setPartyDropOpen] = useState(false)
  const [poNotes, setPoNotes] = useState('')
  const [poItems, setPoItems] = useState<POItem[]>([])
  const [itemSearch, setItemSearch] = useState('')
  const [itemDropOpen, setItemDropOpen] = useState(false)
  const [selectedItemIds, setSelectedItemIds] = useState<Set<number>>(new Set())
  const [history, setHistory] = useState<any[]>([])
  const [aliases, setAliases] = useState<any[]>([])
  const [saving, setSaving] = useState(false)
  const partyRef = useRef<HTMLDivElement>(null)
  const itemRef = useRef<HTMLDivElement>(null)

  // Unique party names from inventory transactions
  const { data: parties = [] } = useSWR('/api/masters/parties', fetcher, { revalidateOnFocus: false })
  const filteredParties = useMemo(() => {
    const q = partySearch.toLowerCase()
    return parties.filter((p: any) => !q || p.name.toLowerCase().includes(q)).slice(0, 20)
  }, [parties, partySearch])

  const filteredItems = useMemo(() => {
    const q = itemSearch.toLowerCase()
    return items.filter((i: any) => !q || i.name.toLowerCase().includes(q)).slice(0, 20)
  }, [items, itemSearch])

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (partyRef.current && !partyRef.current.contains(e.target as Node)) setPartyDropOpen(false)
      if (itemRef.current && !itemRef.current.contains(e.target as Node)) setItemDropOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Fetch mobile when party selected
  async function selectParty(name: string) {
    setPartyName(name)
    setPartyDropOpen(false)
    setPartySearch('')
    try {
      const res = await fetch('/api/inventory/po', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'party-mobile', partyName: name }),
      })
      const d = await res.json()
      if (d.mobile) setPartyMobile(d.mobile)
    } catch {}
    // Fetch aliases for selected items
    if (selectedItemIds.size > 0) fetchAliases(name, Array.from(selectedItemIds))
  }

  async function fetchAliases(party: string, itemIds: number[]) {
    try {
      const res = await fetch('/api/inventory/po', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'aliases', itemIds, partyName: party }),
      })
      setAliases(await res.json())
    } catch {}
  }

  async function fetchHistory(itemIds: number[]) {
    try {
      const res = await fetch('/api/inventory/po', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'history', itemIds }),
      })
      setHistory(await res.json())
    } catch {}
  }

  function toggleItem(item: any) {
    const next = new Set(selectedItemIds)
    if (next.has(item.id)) {
      next.delete(item.id)
      setPoItems(prev => prev.filter(p => p.itemId !== item.id))
    } else {
      next.add(item.id)
      // Find most recent alias for this party
      const alias = aliases.find((a: any) => a.itemId === item.id)
      setPoItems(prev => [...prev, { itemId: item.id, itemName: item.name, unit: item.unit, quantity: '', rate: '', notes: '', aliasName: alias?.alias || item.name }])
    }
    setSelectedItemIds(next)
    fetchHistory(Array.from(next))
    if (partyName) fetchAliases(partyName, Array.from(next))
  }

  function updatePoItem(idx: number, field: keyof POItem, value: string) {
    setPoItems(prev => { const u = [...prev]; u[idx] = { ...u[idx], [field]: value }; return u })
  }

  async function savePO() {
    if (!partyName || poItems.length === 0) return
    setSaving(true)
    const res = await fetch('/api/inventory/po', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partyName, partyMobile, notes: poNotes, items: poItems }),
    })
    if (res.ok) {
      setCreating(false); setPartyName(''); setPartyMobile(''); setPoNotes('')
      setPoItems([]); setSelectedItemIds(new Set()); setHistory([]); setAliases([])
      mutate()
    }
    setSaving(false)
  }

  function shareWhatsApp(po: any) {
    const lines = [
      '🏭 *KOTHARI SYNTHETIC INDUSTRIES*',
      '📋 *Purchase Order*',
      '━━━━━━━━━━━━━━━━━━',
      `📅 Date: ${new Date(po.date).toLocaleDateString('en-IN')}`,
      `📄 PO No: ${po.poNo}`,
      `👤 Party: ${po.partyName}`,
      '',
      '*Items:*',
    ]
    let total = 0
    po.items.forEach((i: any, idx: number) => {
      const rate = i.rate ? ` @ ${fmtINR(i.rate)}/${i.item.unit}` : ''
      const amt = i.rate && i.quantity ? i.rate * i.quantity : 0
      total += amt
      lines.push(`${idx + 1}. ${i.item.name} — ${i.quantity} ${i.item.unit}${rate}`)
    })
    if (total > 0) { lines.push(''); lines.push(`💰 *Total: ${fmtINR(Math.round(total))}*`) }
    if (po.notes) { lines.push(''); lines.push(`📝 Notes: ${po.notes}`) }
    lines.push('', '━━━━━━━━━━━━━━━━━━', 'Kothari Synthetic Industries', 'Jasol, Rajasthan')

    const text = encodeURIComponent(lines.join('\n'))
    const mobile = po.partyMobile ? `91${po.partyMobile.replace(/\D/g, '').slice(-10)}` : ''
    window.open(`https://wa.me/${mobile}?text=${text}`, '_blank')
  }

  return (
    <div className="p-4 md:p-6 dark:text-gray-100">
      <div className="flex items-center gap-4 mb-5">
        <BackButton />
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Purchase Orders</h1>
        <button onClick={() => setCreating(true)} className="ml-auto text-xs bg-purple-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-purple-700">+ New PO</button>
      </div>

      {/* PO List */}
      {!creating && (
        <div className="space-y-2">
          {pos.length === 0 && <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-8 text-center text-gray-400">No purchase orders yet.</div>}
          {pos.map((po: any) => {
            const total = po.items.reduce((s: number, i: any) => s + (i.rate && i.quantity ? i.rate * i.quantity : 0), 0)
            return (
              <div key={po.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-purple-600 dark:text-purple-400">{po.poNo}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${po.status === 'delivered' ? 'bg-green-100 text-green-700' : po.status === 'sent' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{po.status}</span>
                    <span className="text-[10px] text-gray-400">{new Date(po.date).toLocaleDateString('en-IN')}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {total > 0 && <span className="text-xs font-bold text-emerald-600">{fmtINR(Math.round(total))}</span>}
                    <button onClick={() => shareWhatsApp(po)} className="text-xs bg-green-600 text-white px-2 py-1 rounded font-medium hover:bg-green-700">📱 WhatsApp</button>
                    {po.partyMobile && <a href={`tel:${po.partyMobile}`} className="text-xs bg-blue-600 text-white px-2 py-1 rounded font-medium hover:bg-blue-700">📞 Call</a>}
                  </div>
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-300 mb-1">{po.partyName}</p>
                <div className="flex flex-wrap gap-1.5">
                  {po.items.map((i: any) => (
                    <span key={i.id} className="text-[10px] bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded-full">{i.item.name} ({i.quantity} {i.item.unit})</span>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Create PO Form */}
      {creating && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border-2 border-purple-300 dark:border-purple-700 shadow-lg p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">New Purchase Order</h2>
            <button onClick={() => { setCreating(false); setPoItems([]); setSelectedItemIds(new Set()) }} className="text-gray-400 text-xl">&times;</button>
          </div>

          {/* Party selector */}
          <div ref={partyRef} className="relative">
            <label className="block text-[10px] text-gray-500 mb-0.5">Party</label>
            <div className="flex gap-2">
              <button onClick={() => { setPartyDropOpen(!partyDropOpen); setPartySearch('') }}
                className="flex-1 text-left border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100">
                {partyName || 'Select party...'}
              </button>
              {partyMobile && (
                <a href={`tel:${partyMobile}`} className="text-xs bg-blue-600 text-white px-3 py-2 rounded-lg font-medium hover:bg-blue-700 flex items-center">📞 {partyMobile}</a>
              )}
            </div>
            {partyDropOpen && (
              <div className="absolute z-30 top-full mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-2xl max-h-52 flex flex-col">
                <input autoFocus type="text" placeholder="Search party..." value={partySearch} onChange={e => setPartySearch(e.target.value)}
                  className="px-3 py-2 text-sm border-b border-gray-100 dark:border-gray-700 bg-transparent focus:outline-none dark:text-gray-100" />
                <div className="overflow-y-auto flex-1">
                  {filteredParties.map((p: any) => (
                    <button key={p.id} onClick={() => selectParty(p.name)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-purple-50 dark:hover:bg-purple-900/20 text-gray-700 dark:text-gray-200">
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Item selector */}
          <div ref={itemRef} className="relative">
            <label className="block text-[10px] text-gray-500 mb-0.5">Select Items</label>
            <button onClick={() => { setItemDropOpen(!itemDropOpen); setItemSearch('') }}
              className="w-full text-left border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100">
              {selectedItemIds.size > 0 ? `${selectedItemIds.size} items selected` : 'Search & select items...'}
            </button>
            {itemDropOpen && (
              <div className="absolute z-30 top-full mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-2xl max-h-52 flex flex-col">
                <input autoFocus type="text" placeholder="Search item..." value={itemSearch} onChange={e => setItemSearch(e.target.value)}
                  className="px-3 py-2 text-sm border-b border-gray-100 dark:border-gray-700 bg-transparent focus:outline-none dark:text-gray-100" />
                <div className="overflow-y-auto flex-1">
                  {filteredItems.map((i: any) => (
                    <button key={i.id} onClick={() => toggleItem(i)}
                      className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between ${selectedItemIds.has(i.id) ? 'bg-purple-50 dark:bg-purple-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-700/40'}`}>
                      <span>{selectedItemIds.has(i.id) ? '☑' : '☐'} {i.name}</span>
                      <span className="text-[10px] text-gray-400">{i.unit} | Stock: {i.calculatedStock}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Selected items with qty/rate */}
          {poItems.length > 0 && (
            <div className="space-y-2">
              <label className="text-[10px] text-gray-500 font-medium">Items Detail</label>
              {poItems.map((pi, idx) => (
                <div key={idx} className="border border-gray-200 dark:border-gray-700 rounded-lg p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-200">{pi.itemName}</span>
                    <span className="text-[10px] text-gray-400">{pi.unit}</span>
                  </div>
                  <div className="flex gap-2">
                    <input type="text" placeholder="Alias name" value={pi.aliasName} onChange={e => updatePoItem(idx, 'aliasName', e.target.value)}
                      className="flex-1 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs bg-white dark:bg-gray-700 dark:text-gray-100" />
                    <input type="number" step="0.01" placeholder="Qty" value={pi.quantity} onChange={e => updatePoItem(idx, 'quantity', e.target.value)}
                      className="w-16 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs bg-white dark:bg-gray-700 dark:text-gray-100" />
                    <input type="number" step="0.01" placeholder="Rate" value={pi.rate} onChange={e => updatePoItem(idx, 'rate', e.target.value)}
                      className="w-16 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs bg-white dark:bg-gray-700 dark:text-gray-100" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Purchase History */}
          {history.length > 0 && (
            <div>
              <label className="text-[10px] text-gray-500 font-medium">Purchase History</label>
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden mt-1">
                <div className="divide-y divide-gray-50 dark:divide-gray-700 max-h-40 overflow-y-auto">
                  {history.map((h: any) => (
                    <div key={h.id} className="px-3 py-1.5 flex items-center justify-between text-[10px]">
                      <div>
                        <span className="font-medium text-gray-700 dark:text-gray-200">{h.item.name}</span>
                        <span className="text-gray-400 ml-2">{new Date(h.date).toLocaleDateString('en-IN')}</span>
                        {h.reference && <span className="text-gray-400 ml-1">#{h.reference}</span>}
                      </div>
                      <div>
                        <span className="text-gray-500">{h.quantity} {h.item.unit}</span>
                        {h.rate && <span className="text-emerald-600 ml-2">@ {fmtINR(h.rate)}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Notes */}
          <input type="text" placeholder="Notes (optional)" value={poNotes} onChange={e => setPoNotes(e.target.value)}
            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100" />

          {/* Save */}
          <button onClick={savePO} disabled={saving || !partyName || poItems.length === 0}
            className="w-full bg-purple-600 text-white py-2.5 rounded-lg text-sm font-bold hover:bg-purple-700 disabled:opacity-50">
            {saving ? 'Saving...' : 'Create Purchase Order'}
          </button>
        </div>
      )}
    </div>
  )
}
