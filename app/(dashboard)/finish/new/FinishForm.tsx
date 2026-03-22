'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'

// Types
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

interface MarkaEntry {
  lotNo: string
  than: string
  meter: string
  stockStatus: StockStatus
  stockInfo: { stock: number; greyThan: number; despatchThan: number } | null
}

export default function FinishForm() {
  const router = useRouter()

  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0],
    slipNo: '',
    notes: '',
  })
  const [mandi, setMandi] = useState('')

  const [markaEntries, setMarkaEntries] = useState<MarkaEntry[]>([
    { lotNo: '', than: '', meter: '', stockStatus: 'idle', stockInfo: null },
  ])

  const [chemicals, setChemicals] = useState<ChemicalRow[]>([])
  const [masterChemicals, setMasterChemicals] = useState<ChemicalMaster[]>([])
  const [availableLots, setAvailableLots] = useState<{ lotNo: string; greyThan: number; despatchThan: number; stock: number }[]>([])

  const [chemDropIdx, setChemDropIdx] = useState<number | null>(null)
  const [chemSearch, setChemSearch] = useState('')
  const [lotDropIdx, setLotDropIdx] = useState<number | null>(null)
  const [lotSearch, setLotSearch] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const totalCost = useMemo(() => chemicals.reduce((sum, c) => sum + (c.cost ?? 0), 0), [chemicals])

  // Load chemical master
  useEffect(() => {
    fetch('/api/chemicals').then(r => r.json()).then(d => setMasterChemicals(Array.isArray(d) ? d : [])).catch(() => {})
  }, [])

  // Load available lots
  useEffect(() => {
    fetch('/api/grey/lots').then(r => r.json()).then(d => setAvailableLots(Array.isArray(d) ? d : [])).catch(() => {})
  }, [])

  const set = (field: string, value: string) => setForm(prev => ({ ...prev, [field]: value }))

  // Lot helpers
  function updateMarka(i: number, field: 'lotNo' | 'than' | 'meter', value: string) {
    setMarkaEntries(prev => {
      const updated = [...prev]
      updated[i] = { ...updated[i], [field]: value }
      return updated
    })
  }

  function addMarkaRow() {
    setMarkaEntries(prev => [...prev, { lotNo: '', than: '', meter: '', stockStatus: 'idle', stockInfo: null }])
  }

  function removeMarkaRow(i: number) {
    setMarkaEntries(prev => prev.filter((_, idx) => idx !== i))
  }

  function selectLot(lotIdx: number, lot: { lotNo: string; greyThan: number; despatchThan: number; stock: number }) {
    setMarkaEntries(prev => {
      const updated = [...prev]
      updated[lotIdx] = {
        ...updated[lotIdx],
        lotNo: lot.lotNo,
        stockStatus: lot.stock > 0 ? 'ok' : 'no_stock',
        stockInfo: { stock: lot.stock, greyThan: lot.greyThan, despatchThan: lot.despatchThan },
      }
      return updated
    })
    setLotDropIdx(null)
    setLotSearch('')
  }

  async function handleLotBlur(lotNo: string, idx: number) {
    const lot = lotNo.trim()
    if (!lot) return
    setMarkaEntries(prev => {
      const updated = [...prev]
      updated[idx] = { ...updated[idx], stockStatus: 'loading' }
      return updated
    })
    try {
      const res = await fetch(`/api/grey/stock?lotNo=${encodeURIComponent(lot)}`)
      const data = await res.json()
      setMarkaEntries(prev => {
        const updated = [...prev]
        if (!data.exists) {
          updated[idx] = { ...updated[idx], stockStatus: 'not_found', stockInfo: null }
        } else if (data.stock <= 0) {
          updated[idx] = { ...updated[idx], stockStatus: 'no_stock', stockInfo: data }
        } else {
          updated[idx] = { ...updated[idx], stockStatus: 'ok', stockInfo: data }
        }
        return updated
      })
    } catch {
      setMarkaEntries(prev => {
        const updated = [...prev]
        updated[idx] = { ...updated[idx], stockStatus: 'idle' }
        return updated
      })
    }
  }

  // Chemical helpers
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

  // Submit
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const validLots = markaEntries.filter(m => m.lotNo.trim() && m.than.trim())
    if (validLots.length === 0) { setError('At least one lot with than is required.'); return }
    setSaving(true); setError('')

    const totalMeter = validLots.reduce((s, l) => s + (parseFloat(l.meter) || 0), 0)

    const payload = {
      date: form.date,
      slipNo: form.slipNo,
      notes: form.notes,
      mandi: mandi || null,
      lotNo: validLots[0].lotNo,
      than: String(validLots[0].than),
      totalMeter: totalMeter || null,
      marka: validLots.map(l => ({
        lotNo: l.lotNo.trim(),
        than: parseInt(l.than) || 0,
        meter: parseFloat(l.meter) || null,
      })),
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

    try {
      const res = await fetch('/api/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        router.push('/finish')
      } else {
        const d = await res.json().catch(() => ({}))
        setError(d.error ?? 'Failed to save')
        setSaving(false)
      }
    } catch {
      setError('Network error')
      setSaving(false)
    }
  }

  const inp = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400'

  return (
    <div className="p-4 md:p-8 max-w-xl">
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 rounded-lg px-4 py-2 text-sm font-medium transition">&larr; Back</button>
        <h1 className="text-xl font-bold text-gray-800">New Finish Slip</h1>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">{error}</div>}

      <form onSubmit={handleSubmit}>
        {/* Slip Details */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Slip Details</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Date *</label>
              <input type="date" className={inp} value={form.date} onChange={e => set('date', e.target.value)} required />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Slip No *</label>
              <input type="number" className={inp} value={form.slipNo} onChange={e => set('slipNo', e.target.value)} required />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Mandi (liters)</label>
              <input type="number" step="0.1" className={inp} value={mandi} onChange={e => setMandi(e.target.value)} placeholder="Liters" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
              <input type="text" className={inp} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Any remarks" />
            </div>
          </div>
        </div>

        {/* Lots */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">
              Lots
              {markaEntries.length > 1 && <span className="ml-2 text-xs font-normal text-gray-400">{markaEntries.length} lots</span>}
            </h2>
            <button type="button" onClick={addMarkaRow} className="text-xs text-teal-600 hover:text-teal-800 font-medium">
              + Add Lot
            </button>
          </div>
          <div className="space-y-3">
            {markaEntries.map((lot, i) => {
              const selectedLotNos = markaEntries.map((e, idx) => idx !== i ? e.lotNo : '').filter(Boolean)
              const filteredLots = availableLots
                .filter(l => !selectedLotNos.includes(l.lotNo))
                .filter(l => !lotSearch || l.lotNo.toLowerCase().includes(lotSearch.toLowerCase()))
              return (
              <div key={i} className="border border-gray-200 rounded-xl p-3 bg-gray-50">
                {/* Row 1: # + Lot selector + remove */}
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs text-gray-400 w-5 shrink-0">#{i + 1}</span>
                  <div className="flex-1 relative">
                    <div
                      className={`flex items-center gap-2 border rounded-lg px-3 py-2 bg-white cursor-pointer ${lotDropIdx === i ? 'ring-2 ring-teal-400 border-teal-400' : 'border-gray-300'}`}
                      onClick={() => { setLotDropIdx(lotDropIdx === i ? null : i); setLotSearch('') }}
                    >
                      <span className={`flex-1 text-sm ${lot.lotNo ? 'font-medium text-gray-800' : 'text-gray-400'}`}>
                        {lot.lotNo || 'Select lot...'}
                      </span>
                      {lot.stockStatus === 'ok' && (
                        <span className="text-green-600 text-[10px] font-semibold bg-green-50 border border-green-200 px-1 py-0.5 rounded shrink-0">OK</span>
                      )}
                      {lot.stockStatus === 'no_stock' && (
                        <span className="text-amber-600 text-[10px] font-semibold bg-amber-50 border border-amber-200 px-1 py-0.5 rounded shrink-0">Low</span>
                      )}
                      {lot.stockStatus === 'not_found' && (
                        <span className="text-red-600 text-[10px] font-semibold bg-red-50 border border-red-200 px-1 py-0.5 rounded shrink-0">N/A</span>
                      )}
                      <span className="text-gray-400 text-xs shrink-0">&#9660;</span>
                    </div>

                    {/* Searchable lot dropdown */}
                    {lotDropIdx === i && (
                      <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-20 max-h-60 flex flex-col">
                        <input
                          type="text"
                          autoFocus
                          className="w-full border-b border-gray-200 px-3 py-2 text-sm focus:outline-none rounded-t-lg"
                          placeholder="Search lot number..."
                          value={lotSearch}
                          onChange={e => setLotSearch(e.target.value)}
                          onClick={e => e.stopPropagation()}
                        />
                        <div className="overflow-y-auto max-h-48">
                          {filteredLots.map(l => (
                            <button
                              key={l.lotNo}
                              type="button"
                              className={`w-full text-left px-3 py-2 text-sm hover:bg-teal-50 flex items-center justify-between ${lot.lotNo === l.lotNo ? 'bg-teal-50 font-medium' : ''}`}
                              onClick={e => { e.stopPropagation(); selectLot(i, l) }}
                            >
                              <span className="font-medium">{l.lotNo}</span>
                              <span className="text-xs text-gray-400">Stock: {l.stock} than</span>
                            </button>
                          ))}
                          {filteredLots.length === 0 && !lotSearch && (
                            <p className="px-3 py-2 text-xs text-gray-400">No lots with available stock</p>
                          )}
                          {filteredLots.length === 0 && lotSearch && (
                            <button
                              type="button"
                              className="w-full text-left px-3 py-2 text-sm hover:bg-amber-50 text-amber-700 border-t border-gray-100 flex items-center gap-1"
                              onClick={e => {
                                e.stopPropagation()
                                updateMarka(i, 'lotNo', lotSearch.trim())
                                setLotDropIdx(null)
                                setLotSearch('')
                                setTimeout(() => handleLotBlur(lotSearch.trim(), i), 100)
                              }}
                            >
                              <span className="text-amber-500">+</span> Use &quot;{lotSearch.trim()}&quot; manually
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  {markaEntries.length > 1 && (
                    <button type="button" onClick={() => removeMarkaRow(i)} className="text-red-400 hover:text-red-600 text-xl leading-none shrink-0 w-6 text-center">&times;</button>
                  )}
                </div>

                {/* Stock info line */}
                {lot.stockStatus === 'loading' && <p className="text-xs text-gray-400 pl-7 mb-2">Checking stock...</p>}
                {lot.stockStatus === 'not_found' && <p className="text-xs text-red-500 pl-7 mb-2">Lot not found in Grey register</p>}
                {lot.stockStatus === 'no_stock' && lot.stockInfo && (
                  <p className="text-xs text-amber-600 pl-7 mb-2">
                    Grey: {lot.stockInfo.greyThan} | Despatched: {lot.stockInfo.despatchThan} | Balance: <strong>{lot.stockInfo.stock}</strong>
                  </p>
                )}
                {lot.stockStatus === 'ok' && lot.stockInfo && (
                  <p className="text-xs text-green-600 pl-7 mb-2">
                    Grey: {lot.stockInfo.greyThan} | Despatched: {lot.stockInfo.despatchThan} | Balance: <strong>{lot.stockInfo.stock}</strong>
                  </p>
                )}

                {/* Than + Meter inputs */}
                <div className="pl-7 grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-gray-400 mb-0.5">Than *</label>
                    <input
                      type="number"
                      className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
                      value={lot.than}
                      onChange={e => updateMarka(i, 'than', e.target.value)}
                      required
                      placeholder="Qty"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 mb-0.5">Meter</label>
                    <input
                      type="number"
                      step="0.01"
                      className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
                      value={lot.meter}
                      onChange={e => updateMarka(i, 'meter', e.target.value)}
                      placeholder="Meters"
                    />
                  </div>
                </div>
              </div>
              )
            })}
          </div>
          {markaEntries.length > 1 && (
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
              <span className="text-xs text-gray-500">Total</span>
              <span className="text-sm font-bold text-emerald-600">
                {markaEntries.reduce((s, l) => s + (parseInt(l.than) || 0), 0)} than
                {' / '}
                {markaEntries.reduce((s, l) => s + (parseFloat(l.meter) || 0), 0).toFixed(1)} m
              </span>
            </div>
          )}
        </div>

        {/* Chemicals */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">
              Chemicals Used
              {chemicals.length > 0 && <span className="ml-2 text-xs font-normal text-gray-400">{chemicals.length} items</span>}
            </h2>
            <button type="button" onClick={addChemicalRow} className="text-xs text-teal-600 hover:text-teal-800 font-medium">
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
                        className={`flex items-center gap-2 border rounded-lg px-3 py-2 bg-white cursor-pointer ${chemDropIdx === i ? 'ring-2 ring-teal-400 border-teal-400' : 'border-gray-300'}`}
                        onClick={() => { setChemDropIdx(chemDropIdx === i ? null : i); setChemSearch('') }}
                      >
                        <span className={`flex-1 text-sm ${c.name ? 'font-medium text-gray-800' : 'text-gray-400'}`}>
                          {c.name || 'Select chemical...'}
                        </span>
                        {c.matched && (
                          <span className="text-green-600 text-[10px] font-semibold bg-green-50 border border-green-200 px-1 py-0.5 rounded shrink-0">&#10003;</span>
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
                                  className={`w-full text-left px-3 py-2 text-sm hover:bg-teal-50 flex items-center justify-between ${c.chemicalId === m.id ? 'bg-teal-50 font-medium' : ''}`}
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
                    <button type="button" onClick={() => removeChemical(i)} className="text-red-400 hover:text-red-600 text-xl leading-none shrink-0 w-6 text-center">&times;</button>
                  </div>

                  {/* Qty / Unit / Rate / Cost row */}
                  <div className="grid grid-cols-2 gap-2 pl-7">
                    <div>
                      <label className="block text-[10px] text-gray-400 mb-0.5">Quantity</label>
                      <input
                        type="number" step="0.001"
                        className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
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
                        className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
                        value={c.rate}
                        onChange={e => updateChemical(i, 'rate', e.target.value)}
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-400 mb-0.5">Cost (&#8377;)</label>
                      <div className={`w-full border rounded-lg px-3 py-1.5 text-sm font-semibold ${c.cost != null ? 'border-teal-200 bg-teal-50 text-teal-700' : 'border-gray-200 bg-white text-gray-400'}`}>
                        {c.cost != null ? `\u20B9${c.cost.toFixed(2)}` : '\u2014'}
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {/* Total cost */}
              {totalCost > 0 && (
                <div className="flex items-center justify-between bg-teal-50 border border-teal-200 rounded-xl px-4 py-3">
                  <span className="text-sm font-semibold text-gray-700">Total Finish Cost</span>
                  <span className="text-lg font-bold text-teal-700">&#8377;{totalCost.toFixed(2)}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3 justify-end">
          <button type="button" onClick={() => router.back()} className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
          <button type="submit" disabled={saving} className="px-6 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 disabled:opacity-60">
            {saving ? 'Saving...' : 'Save Entry'}
          </button>
        </div>
      </form>
    </div>
  )
}
