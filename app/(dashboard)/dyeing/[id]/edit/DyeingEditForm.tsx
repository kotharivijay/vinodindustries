'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'

type StockStatus = 'idle' | 'loading' | 'ok' | 'no_stock' | 'not_found'

interface ChemicalMaster { id: number; name: string; unit: string; currentPrice: number | null }

interface ChemicalRow {
  name: string
  chemicalId: number | null
  quantity: string
  unit: string
  rate: string
  cost: number | null
  matched: boolean
}

export default function DyeingEditForm({ id }: { id: string }) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [originalLot, setOriginalLot] = useState('')
  const [stockStatus, setStockStatus] = useState<StockStatus>('idle')
  const [stockInfo, setStockInfo] = useState<{ stock: number; greyThan: number; despatchThan: number } | null>(null)

  const [form, setForm] = useState({ date: '', slipNo: '', notes: '' })
  const [lots, setLots] = useState<{ lotNo: string; than: string }[]>([{ lotNo: '', than: '' }])

  // Chemicals
  const [chemicals, setChemicals] = useState<ChemicalRow[]>([])
  const [masterChemicals, setMasterChemicals] = useState<ChemicalMaster[]>([])
  const [chemDropIdx, setChemDropIdx] = useState<number | null>(null)
  const [chemSearch, setChemSearch] = useState('')

  const totalCost = useMemo(() => chemicals.reduce((sum, c) => sum + (c.cost ?? 0), 0), [chemicals])

  // Load chemical master
  useEffect(() => {
    fetch('/api/chemicals').then(r => r.json()).then(d => setMasterChemicals(Array.isArray(d) ? d : [])).catch(() => {})
  }, [])

  // Load entry data
  useEffect(() => {
    fetch(`/api/dyeing/${id}`).then(r => r.json()).then(e => {
      setForm({
        date: new Date(e.date).toISOString().split('T')[0],
        slipNo: String(e.slipNo),
        notes: e.notes || '',
      })
      setOriginalLot(e.lotNo)

      // Load lots
      if (e.lots?.length) {
        setLots(e.lots.map((l: any) => ({ lotNo: l.lotNo, than: String(l.than) })))
      } else {
        setLots([{ lotNo: e.lotNo, than: String(e.than) }])
      }

      // Load chemicals
      if (e.chemicals?.length) {
        setChemicals(e.chemicals.map((c: any) => ({
          name: c.name,
          chemicalId: c.chemicalId ?? null,
          quantity: c.quantity != null ? String(c.quantity) : '',
          unit: c.unit || 'kg',
          rate: c.rate != null ? String(c.rate) : '',
          cost: c.cost ?? null,
          matched: c.chemicalId != null,
        })))
      }
      setLoading(false)
    })
  }, [id])

  const set = (field: string, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  function updateLot(i: number, field: 'lotNo' | 'than', value: string) {
    setLots(prev => {
      const updated = [...prev]
      updated[i] = { ...updated[i], [field]: value }
      return updated
    })
    if (field === 'lotNo') { setStockStatus('idle'); setStockInfo(null) }
  }

  function addLotRow() {
    setLots(prev => [...prev, { lotNo: '', than: '' }])
  }

  function removeLotRow(i: number) {
    setLots(prev => prev.filter((_, idx) => idx !== i))
  }

  // ─── Chemical helpers ──────────────────────────────────────────────────────

  function updateChemical(i: number, field: keyof ChemicalRow, value: string) {
    setChemicals(prev => {
      const updated = [...prev]
      updated[i] = { ...updated[i], [field]: value }

      if (field === 'name') {
        const exact = masterChemicals.find(m => m.name.toLowerCase().trim() === value.toLowerCase().trim())
        updated[i].chemicalId = exact?.id ?? null
        updated[i].matched = !!exact
        if (exact?.currentPrice != null) updated[i].rate = String(exact.currentPrice)
      }

      const qty = parseFloat(field === 'quantity' ? value : updated[i].quantity)
      const rate = parseFloat(field === 'rate' ? value : updated[i].rate)
      updated[i].cost = !isNaN(qty) && !isNaN(rate) ? parseFloat((qty * rate).toFixed(2)) : null
      return updated
    })
  }

  function selectMasterChemical(i: number, master: ChemicalMaster) {
    setChemicals(prev => {
      const updated = [...prev]
      updated[i] = {
        ...updated[i],
        name: master.name,
        chemicalId: master.id,
        matched: true,
        rate: master.currentPrice?.toString() ?? updated[i].rate,
      }
      const qty = parseFloat(updated[i].quantity)
      const rate = parseFloat(updated[i].rate)
      updated[i].cost = !isNaN(qty) && !isNaN(rate) ? parseFloat((qty * rate).toFixed(2)) : null
      return updated
    })
    setChemDropIdx(null)
    setChemSearch('')
  }

  function addChemicalRow() {
    setChemicals(prev => [...prev, { name: '', chemicalId: null, quantity: '', unit: 'kg', rate: '', cost: null, matched: false }])
  }

  function removeChemical(i: number) {
    setChemicals(prev => prev.filter((_, idx) => idx !== i))
  }

  // ─── Stock check ───────────────────────────────────────────────────────────

  async function handleLotBlur(lotNo: string) {
    const lot = lotNo.trim()
    if (!lot || lot.toLowerCase() === originalLot.toLowerCase()) return
    setStockStatus('loading')
    const res = await fetch(`/api/grey/stock?lotNo=${encodeURIComponent(lot)}`)
    const data = await res.json()
    if (!data.exists) { setStockStatus('not_found'); setStockInfo(null) }
    else if (data.stock <= 0) { setStockStatus('no_stock'); setStockInfo(data) }
    else { setStockStatus('ok'); setStockInfo(data) }
  }

  // ─── Submit ────────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const validLots = lots.filter(l => l.lotNo.trim() && l.than.trim())
    if (validLots.length === 0) { setError('At least one lot with than is required.'); return }
    if (stockStatus === 'not_found') { setError('Lot not found in Grey register.'); return }
    setSaving(true); setError('')

    const payload = {
      ...form,
      lotNo: validLots[0].lotNo,
      than: validLots.reduce((s, l) => s + (parseInt(l.than) || 0), 0),
      lots: validLots.map(l => ({ lotNo: l.lotNo.trim(), than: parseInt(l.than) || 0 })),
      chemicals: chemicals
        .filter(c => c.name.trim())
        .map(c => ({
          name: c.name.trim(),
          chemicalId: c.chemicalId,
          quantity: c.quantity ? parseFloat(c.quantity) : null,
          unit: c.unit,
          rate: c.rate ? parseFloat(c.rate) : null,
          cost: c.cost,
        })),
    }

    const res = await fetch(`/api/dyeing/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.ok) {
      router.push('/dyeing')
    } else {
      const d = await res.json().catch(() => ({}))
      setError(d.error ?? 'Failed to save')
      setSaving(false)
    }
  }

  if (loading) return <div className="p-8 text-gray-400">Loading...</div>

  return (
    <div className="p-4 md:p-8 max-w-xl">
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-800 text-sm">&larr; Back</button>
        <h1 className="text-xl font-bold text-gray-800">Edit Dyeing Slip</h1>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">{error}</div>}

      <form onSubmit={handleSubmit}>
        {/* ── Slip Details ── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Slip Details</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Date *">
              <input type="date" className={inp} value={form.date} onChange={e => set('date', e.target.value)} required />
            </Field>
            <Field label="Slip No *">
              <input type="number" className={inp} value={form.slipNo} onChange={e => set('slipNo', e.target.value)} required />
            </Field>

            <Field label="Notes">
              <input type="text" className={inp} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Any remarks" />
            </Field>
          </div>
        </div>

        {/* ── Lots ── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">
              Lots
              {lots.length > 1 && <span className="ml-2 text-xs font-normal text-gray-400">{lots.length} lots</span>}
            </h2>
            <button type="button" onClick={addLotRow} className="text-xs text-purple-600 hover:text-purple-800 font-medium">
              + Add Lot
            </button>
          </div>
          <div className="space-y-3">
            {lots.map((lot, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs text-gray-400 w-5 shrink-0">#{i + 1}</span>
                <input
                  type="text" className={inp + ' flex-1'} value={lot.lotNo}
                  onChange={e => updateLot(i, 'lotNo', e.target.value)}
                  onBlur={() => handleLotBlur(lot.lotNo)}
                  placeholder="Lot No" required
                />
                <input
                  type="number" className={inp + ' w-24'} value={lot.than}
                  onChange={e => updateLot(i, 'than', e.target.value)}
                  placeholder="Than" required
                />
                {lots.length > 1 && (
                  <button type="button" onClick={() => removeLotRow(i)} className="text-red-400 hover:text-red-600 text-xl leading-none shrink-0 w-6 text-center">&times;</button>
                )}
              </div>
            ))}
          </div>
          {stockStatus === 'loading' && <p className="text-xs text-gray-400 mt-2">Checking stock...</p>}
          {stockStatus === 'not_found' && <p className="text-xs text-red-500 mt-2">Lot not found in Grey register</p>}
          {stockStatus === 'no_stock' && stockInfo && (
            <p className="text-xs text-amber-600 mt-2">
              No stock — Grey: {stockInfo.greyThan}, Despatched: {stockInfo.despatchThan}, Balance: <strong>{stockInfo.stock}</strong>
            </p>
          )}
          {stockStatus === 'ok' && stockInfo && (
            <p className="text-xs text-green-600 mt-2">
              Stock OK — Grey: {stockInfo.greyThan}, Despatched: {stockInfo.despatchThan}, Balance: <strong>{stockInfo.stock}</strong>
            </p>
          )}
          {lots.length > 1 && (
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
              <span className="text-xs text-gray-500">Total Than</span>
              <span className="text-sm font-bold text-indigo-600">{lots.reduce((s, l) => s + (parseInt(l.than) || 0), 0)}</span>
            </div>
          )}
        </div>

        {/* ── Chemicals ── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">
              Chemicals Used
              {chemicals.length > 0 && <span className="ml-2 text-xs font-normal text-gray-400">{chemicals.length} items</span>}
            </h2>
            <button type="button" onClick={addChemicalRow} className="text-xs text-purple-600 hover:text-purple-800 font-medium">
              + Add Chemical
            </button>
          </div>

          {chemicals.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-4">No chemicals. Click &quot;+ Add Chemical&quot; to add.</p>
          ) : (
            <div className="space-y-3">
              {chemicals.map((c, i) => (
                <div key={i} className="border border-gray-200 rounded-xl p-3 bg-gray-50">
                  {/* Chemical name row */}
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs text-gray-400 w-5 shrink-0">#{i + 1}</span>
                    <div className="flex-1 relative">
                      <div
                        className={`flex items-center gap-2 border rounded-lg px-3 py-2 bg-white cursor-pointer ${chemDropIdx === i ? 'ring-2 ring-purple-400 border-purple-400' : 'border-gray-300'}`}
                        onClick={() => { setChemDropIdx(chemDropIdx === i ? null : i); setChemSearch('') }}
                      >
                        <span className={`flex-1 text-sm ${c.name ? 'font-medium text-gray-800' : 'text-gray-400'}`}>
                          {c.name || 'Select chemical...'}
                        </span>
                        {c.matched && (
                          <span className="text-green-600 text-[10px] font-semibold bg-green-50 border border-green-200 px-1 py-0.5 rounded shrink-0">✓</span>
                        )}
                        {!c.matched && c.name && (
                          <span className="text-amber-600 text-[10px] font-semibold bg-amber-50 border border-amber-200 px-1 py-0.5 rounded shrink-0">New</span>
                        )}
                        <span className="text-gray-400 text-xs shrink-0">&#9660;</span>
                      </div>

                      {/* Searchable dropdown */}
                      {chemDropIdx === i && (
                        <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-20 max-h-60 flex flex-col">
                          <input
                            type="text"
                            autoFocus
                            className="w-full border-b border-gray-200 px-3 py-2 text-sm focus:outline-none rounded-t-lg"
                            placeholder="Search or type new name..."
                            value={chemSearch}
                            onChange={e => setChemSearch(e.target.value)}
                            onClick={e => e.stopPropagation()}
                          />
                          <div className="overflow-y-auto max-h-48">
                            {masterChemicals
                              .filter(m => !chemSearch || m.name.toLowerCase().includes(chemSearch.toLowerCase()))
                              .map(m => (
                                <button
                                  key={m.id}
                                  type="button"
                                  className={`w-full text-left px-3 py-2 text-sm hover:bg-purple-50 flex items-center justify-between ${c.chemicalId === m.id ? 'bg-purple-50 font-medium' : ''}`}
                                  onClick={e => { e.stopPropagation(); selectMasterChemical(i, m) }}
                                >
                                  <span>{m.name}</span>
                                  {m.currentPrice != null && (
                                    <span className="text-xs text-gray-400">&#8377;{m.currentPrice}/{m.unit}</span>
                                  )}
                                </button>
                              ))
                            }
                            {chemSearch.trim() && !masterChemicals.some(m => m.name.toLowerCase() === chemSearch.toLowerCase()) && (
                              <button
                                type="button"
                                className="w-full text-left px-3 py-2 text-sm hover:bg-amber-50 text-amber-700 border-t border-gray-100 flex items-center gap-1"
                                onClick={e => { e.stopPropagation(); updateChemical(i, 'name', chemSearch.trim()); setChemDropIdx(null); setChemSearch('') }}
                              >
                                <span className="text-amber-500">+</span> Add &quot;{chemSearch.trim()}&quot; as new
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeChemical(i)}
                      className="text-red-400 hover:text-red-600 text-xl leading-none shrink-0 w-6 text-center"
                    >&times;</button>
                  </div>

                  {/* Qty / Unit / Rate / Cost row */}
                  <div className="grid grid-cols-2 gap-2 pl-7">
                    <div>
                      <label className="block text-[10px] text-gray-400 mb-0.5">Quantity</label>
                      <input
                        type="number" step="0.001"
                        className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white"
                        value={c.quantity}
                        onChange={e => updateChemical(i, 'quantity', e.target.value)}
                        placeholder="0"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-400 mb-0.5">Unit</label>
                      <select
                        className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none bg-white"
                        value={c.unit}
                        onChange={e => updateChemical(i, 'unit', e.target.value)}
                      >
                        {['kg', 'liter', 'gram', 'ml', 'piece', 'bag'].map(u => <option key={u}>{u}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-400 mb-0.5">Rate (&#8377;/{c.unit})</label>
                      <input
                        type="number" step="0.01"
                        className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white"
                        value={c.rate}
                        onChange={e => updateChemical(i, 'rate', e.target.value)}
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-400 mb-0.5">Cost (&#8377;)</label>
                      <div className={`w-full border rounded-lg px-3 py-1.5 text-sm font-semibold ${c.cost != null ? 'border-purple-200 bg-purple-50 text-purple-700' : 'border-gray-200 bg-white text-gray-400'}`}>
                        {c.cost != null ? `₹${c.cost.toFixed(2)}` : '—'}
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {/* Total cost */}
              {totalCost > 0 && (
                <div className="flex items-center justify-between bg-purple-50 border border-purple-200 rounded-xl px-4 py-3">
                  <span className="text-sm font-semibold text-gray-700">Total Dyeing Cost</span>
                  <span className="text-lg font-bold text-purple-700">&#8377;{totalCost.toFixed(2)}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Actions ── */}
        <div className="flex gap-3 justify-end">
          <button type="button" onClick={() => router.back()} className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
          <button type="submit" disabled={saving || stockStatus === 'not_found'} className="px-6 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-60">
            {saving ? 'Saving...' : 'Update Entry'}
          </button>
        </div>
      </form>
    </div>
  )
}

const inp = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400'
function Field({ label, children, span = 1 }: { label: string; children: React.ReactNode; span?: number }) {
  return (
    <div className={span === 2 ? 'sm:col-span-2' : ''}>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  )
}
