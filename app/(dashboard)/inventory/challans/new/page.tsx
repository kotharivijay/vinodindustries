'use client'

import { useState, useMemo } from 'react'
import useSWR from 'swr'
import { useRouter } from 'next/navigation'
import BackButton from '../../../BackButton'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface Item { id: number; displayName: string; unit: string; reviewStatus: string; alias: { gstRate: string; tallyStockItem: string } }
// Sourced from /api/tally/ledgers — firm KSI + hasTags. The "ledger name" is the
// stable identity we send to the challan API; InvParty is find-or-created server-side.
interface Ledger { id: number; name: string; parent: string | null; tags: string[] }

interface Line { itemId: string; itemName: string; unit: string; qty: string; rate: string; reviewStatus?: string }

export default function NewChallanPage() {
  const router = useRouter()
  const { data: ledgerResp } = useSWR<{ ledgers: Ledger[] }>(
    '/api/tally/ledgers?firm=KSI&hasTags=true&limit=500',
    fetcher,
  )
  const ledgers = ledgerResp?.ledgers ?? []
  const { data: nextSeries } = useSWR<{ no: number; fy: string }>('/api/inv/series/next?type=inward', fetcher)

  // ledgerName is the stable identity of the picked party.
  const [ledgerName, setLedgerName] = useState('')
  const [partyQ, setPartyQ] = useState('')
  const [partyOpen, setPartyOpen] = useState(false)
  const [challanNo, setChallanNo] = useState('')
  const [challanDate, setChallanDate] = useState(new Date().toISOString().slice(0, 10))
  const [defaultDiscountPct, setDefaultDiscountPct] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [saving, setSaving] = useState(false)
  const [dupCheck, setDupCheck] = useState<any>(null)

  // Tier-A items for selected party (last 90 days). Falls back to /items search.
  const { data: tierA = [] } = useSWR<Item[]>(
    ledgerName ? `/api/inv/items/by-party?tallyLedger=${encodeURIComponent(ledgerName)}&days=90` : null,
    fetcher,
  )
  const [itemQ, setItemQ] = useState('')
  const [itemOpen, setItemOpen] = useState(false)
  const { data: catalog = [] } = useSWR<Item[]>(itemQ ? `/api/inv/items?q=${encodeURIComponent(itemQ)}` : null, fetcher)
  // Inline "create new item" state — opens when no existing item matches the search
  const [createForm, setCreateForm] = useState<{ aliasId: string } | null>(null)
  const [creating, setCreating] = useState(false)
  const [aliasQ, setAliasQ] = useState('')
  const [aliasOpen, setAliasOpen] = useState(false)
  type AliasRow = { id: number; tallyStockItem: string; gstRate: string | number; hsn: string | null; unit: string }
  // Load the full alias master once when the create form opens.
  const { data: aliases = [] } = useSWR<AliasRow[]>(
    createForm ? '/api/inv/aliases' : null,
    fetcher,
  )
  const filteredAliases = useMemo(() => {
    const q = aliasQ.toLowerCase()
    return aliases.filter(a => !q || a.tallyStockItem.toLowerCase().includes(q)).slice(0, 50)
  }, [aliases, aliasQ])
  const selectedAlias = useMemo(() => {
    if (!createForm?.aliasId) return null
    return aliases.find(a => String(a.id) === createForm.aliasId) || null
  }, [aliases, createForm?.aliasId])
  const itemList = useMemo(() => {
    const seen = new Set<number>()
    const out: Item[] = []
    for (const i of [...(tierA || []), ...(catalog || [])]) {
      if (!seen.has(i.id)) { seen.add(i.id); out.push(i) }
    }
    return itemQ ? out.filter(i => i.displayName.toLowerCase().includes(itemQ.toLowerCase())) : out
  }, [tierA, catalog, itemQ])

  const filteredLedgers = useMemo(() => {
    const q = partyQ.toLowerCase()
    return ledgers.filter(l => !q || l.name.toLowerCase().includes(q)).slice(0, 30)
  }, [ledgers, partyQ])

  const selectedLedger = useMemo(() => {
    if (!ledgerName) return null
    return ledgers.find(l => l.name === ledgerName) || null
  }, [ledgers, ledgerName])

  function pickLedger(l: Ledger) {
    setLedgerName(l.name)
    setPartyQ(l.name)
    setPartyOpen(false)
  }

  function addItem(it: Item) {
    setLines(prev => [...prev, { itemId: String(it.id), itemName: it.displayName, unit: it.unit, qty: '', rate: '', reviewStatus: it.reviewStatus }])
    setItemQ(''); setItemOpen(false); setCreateForm(null)
  }

  async function createItem() {
    if (!itemQ.trim() || !createForm?.aliasId || creating) return
    setCreating(true)
    try {
      const res = await fetch('/api/inv/items', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: itemQ.trim(),
          aliasId: Number(createForm.aliasId),
        }),
      })
      const d = await res.json()
      if (!res.ok) { alert('Create failed: ' + (d.error || res.status)); return }
      addItem({
        id: d.id,
        displayName: d.displayName,
        unit: d.unit,
        reviewStatus: d.reviewStatus,
        alias: { gstRate: d.alias?.gstRate ?? '0', tallyStockItem: d.alias?.tallyStockItem ?? '' },
      })
    } finally { setCreating(false) }
  }

  function updateLine(i: number, k: keyof Line, v: string) {
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, [k]: v } : l))
  }

  function removeLine(i: number) {
    setLines(prev => prev.filter((_, idx) => idx !== i))
  }

  async function checkDup() {
    if (!ledgerName || !challanNo) return
    const res = await fetch('/api/inv/challans/check-duplicate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tallyLedger: ledgerName, challanNo, date: challanDate }),
    })
    const d = await res.json()
    setDupCheck(d.duplicate ? d.dup : null)
  }

  const totalQty = lines.reduce((s, l) => s + (Number(l.qty) || 0), 0)
  const totalAmount = lines.reduce((s, l) => s + ((Number(l.qty) || 0) * (Number(l.rate) || 0)), 0)
  const ratelessLines = lines.filter(l => !l.rate).length

  async function save() {
    if (!ledgerName || !challanNo || !challanDate || !lines.length) {
      alert('Party, Challan No, Date, and at least one line are required.')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/inv/challans', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tallyLedger: ledgerName,
          challanNo, challanDate,
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
            <input value={partyQ} onChange={e => { setPartyQ(e.target.value); setLedgerName(''); setPartyOpen(true) }}
              onFocus={() => setPartyOpen(true)}
              placeholder="Search supplier (Accounts → Ledgers, tagged only)…"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
            {ledgerName && selectedLedger && (
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                {selectedLedger.parent && (
                  <span className="text-gray-500 dark:text-gray-400">Group: <span className="font-medium text-gray-700 dark:text-gray-300">{selectedLedger.parent}</span></span>
                )}
                {selectedLedger.tags?.map(t => (
                  <span key={t} className="bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-medium px-1.5 py-0.5 rounded-full">{t}</span>
                ))}
              </div>
            )}
            {partyOpen && filteredLedgers.length > 0 && !ledgerName && (
              <div className="absolute z-30 top-full mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl max-h-56 overflow-y-auto">
                {filteredLedgers.map(l => (
                  <button key={l.id} onClick={() => pickLedger(l)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 dark:hover:bg-indigo-900/20 flex items-center justify-between gap-2">
                    <span className="flex flex-col min-w-0">
                      <span className="truncate">{l.name}</span>
                      {l.tags?.length > 0 && (
                        <span className="flex flex-wrap gap-1 mt-0.5">
                          {l.tags.map(t => (
                            <span key={t} className="text-[10px] bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-medium px-1 py-0.5 rounded">{t}</span>
                          ))}
                        </span>
                      )}
                    </span>
                    {l.parent && <span className="text-[10px] text-gray-400 dark:text-gray-500 shrink-0">{l.parent}</span>}
                  </button>
                ))}
              </div>
            )}
            {partyOpen && filteredLedgers.length === 0 && (
              <div className="absolute z-30 top-full mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                No tagged ledgers found. Tag suppliers in Accounts → Ledgers to make them appear here.
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

        {/* Discount row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Discount %</label>
            <input value={defaultDiscountPct} onChange={e => setDefaultDiscountPct(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
          </div>
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
            <input value={itemQ} onChange={e => { setItemQ(e.target.value); setItemOpen(true); setCreateForm(null) }}
              onFocus={() => setItemOpen(true)}
              placeholder="🔍 Search item to add (Tier A items appear first when party is selected)…"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
            {itemOpen && itemList.length > 0 && !createForm && (
              <div className="absolute z-30 top-full mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl max-h-64 overflow-y-auto">
                {itemList.slice(0, 30).map(it => (
                  <button key={it.id} onClick={() => addItem(it)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 dark:hover:bg-indigo-900/20 flex items-center justify-between gap-2">
                    <span>{it.displayName} <span className="text-[10px] text-gray-400">({it.unit})</span></span>
                    {it.reviewStatus === 'pending_review' && <span className="text-[10px] font-bold px-1 rounded bg-amber-100 text-amber-700">Pending</span>}
                  </button>
                ))}
                {itemQ.trim() && (
                  <button type="button" onClick={() => setCreateForm({ aliasId: '' })}
                    className="w-full text-left px-3 py-2 text-xs border-t border-gray-100 dark:border-gray-700 text-indigo-600 dark:text-indigo-400 font-semibold hover:bg-indigo-50 dark:hover:bg-indigo-900/20">
                    + Create &ldquo;{itemQ}&rdquo; as a new item
                  </button>
                )}
              </div>
            )}
            {itemOpen && itemList.length === 0 && itemQ.trim() && !createForm && (
              <div className="absolute z-30 top-full mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl px-3 py-3 space-y-2">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  No item named <span className="font-semibold">&ldquo;{itemQ}&rdquo;</span>.
                </p>
                <button type="button" onClick={() => setCreateForm({ aliasId: '' })}
                  className="text-xs text-indigo-600 dark:text-indigo-400 font-semibold hover:underline">
                  + Create &ldquo;{itemQ}&rdquo; as a new item
                </button>
              </div>
            )}
            {itemOpen && createForm && (
              <div className="absolute z-30 top-full mt-1 w-full bg-white dark:bg-gray-800 border border-indigo-300 dark:border-indigo-700 rounded-lg shadow-xl p-3 space-y-2">
                <p className="text-xs text-gray-700 dark:text-gray-200">
                  Creating: <span className="font-semibold">{itemQ}</span>
                </p>
                <div className="block text-[11px] relative">
                  <span className="text-gray-500 dark:text-gray-400">Tally alias *</span>
                  <input
                    type="text"
                    value={selectedAlias ? selectedAlias.tallyStockItem : aliasQ}
                    onChange={e => {
                      setAliasQ(e.target.value)
                      setAliasOpen(true)
                      // Clear selection while user types a new query
                      if (createForm?.aliasId) setCreateForm({ aliasId: '' })
                    }}
                    onFocus={() => setAliasOpen(true)}
                    placeholder={`Search alias master (${aliases.length} items)…`}
                    className="mt-0.5 w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
                  />
                  {selectedAlias && (
                    <p className="mt-1 text-[10px] text-gray-500 dark:text-gray-400">
                      GST {Number(selectedAlias.gstRate).toFixed(0)}% · {selectedAlias.unit}
                      {selectedAlias.hsn ? ` · HSN ${selectedAlias.hsn}` : ''}
                    </p>
                  )}
                  {aliasOpen && !selectedAlias && filteredAliases.length > 0 && (
                    <div className="absolute z-40 top-full mt-1 left-0 right-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl max-h-56 overflow-y-auto">
                      {filteredAliases.map(a => (
                        <button key={a.id} type="button"
                          onClick={() => { setCreateForm({ aliasId: String(a.id) }); setAliasOpen(false); setAliasQ('') }}
                          className="w-full text-left px-2 py-1.5 text-xs hover:bg-indigo-50 dark:hover:bg-indigo-900/20 flex items-center justify-between gap-2">
                          <span className="truncate">{a.tallyStockItem}</span>
                          <span className="text-[10px] text-gray-400 dark:text-gray-500 shrink-0">
                            {Number(a.gstRate).toFixed(0)}% · {a.unit}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  {aliasOpen && !selectedAlias && filteredAliases.length === 0 && aliasQ.trim() && (
                    <div className="absolute z-40 top-full mt-1 left-0 right-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl px-2 py-1.5 text-[11px] text-gray-500 dark:text-gray-400">
                      No alias matches &ldquo;{aliasQ}&rdquo;. Try a shorter search.
                    </div>
                  )}
                </div>
                <p className="text-[10px] text-gray-500 dark:text-gray-400">
                  Unit, GST rate and HSN will be inherited from the picked alias. The item will be marked
                  <span className="font-semibold"> Pending Review</span> for the manager to approve.
                </p>
                <div className="flex gap-2">
                  <button type="button" onClick={createItem} disabled={!createForm.aliasId || creating}
                    className="flex-1 px-2 py-1.5 rounded bg-indigo-600 text-white text-xs font-semibold disabled:opacity-50">
                    {creating ? 'Creating…' : 'Create + Add to Challan'}
                  </button>
                  <button type="button" onClick={() => { setCreateForm(null); setAliasQ(''); setAliasOpen(false) }}
                    className="px-2 py-1.5 rounded bg-gray-200 dark:bg-gray-700 text-xs">
                    Cancel
                  </button>
                </div>
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
