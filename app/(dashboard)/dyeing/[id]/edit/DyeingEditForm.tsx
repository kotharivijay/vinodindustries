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
  processTag: string | null
}

interface MachineOption { id: number; number: number; name: string; isActive: boolean }
interface OperatorOption { id: number; name: string; mobileNo: string | null; isActive: boolean }

export default function DyeingEditForm({ id }: { id: string }) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [originalLot, setOriginalLot] = useState('')
  const [stockStatus, setStockStatus] = useState<StockStatus>('idle')
  const [stockInfo, setStockInfo] = useState<{ stock: number; greyThan: number; despatchThan: number } | null>(null)

  const [form, setForm] = useState({ date: '', slipNo: '', notes: '' })
  const [lots, setLots] = useState<{ lotNo: string; than: string; quality?: string; stockStatus?: StockStatus; stockInfo?: { stock: number; greyThan: number; despatchThan: number } | null }[]>([{ lotNo: '', than: '', stockStatus: 'idle', stockInfo: null }])

  // Available lots for searchable dropdown
  const [availableLots, setAvailableLots] = useState<{ lotNo: string; greyThan: number; despatchThan: number; stock: number; quality: string }[]>([])
  const [lotDropIdx, setLotDropIdx] = useState<number | null>(null)
  const [lotSearch, setLotSearch] = useState('')

  // Chemicals
  const [chemicals, setChemicals] = useState<ChemicalRow[]>([])
  const [masterChemicals, setMasterChemicals] = useState<ChemicalMaster[]>([])
  const [chemDropIdx, setChemDropIdx] = useState<number | null>(null)
  const [chemSearch, setChemSearch] = useState('')

  const totalCost = useMemo(() => chemicals.reduce((sum, c) => sum + (c.cost ?? 0), 0), [chemicals])

  // Save to Shade Master
  const [showSaveShade, setShowSaveShade] = useState(false)
  const [shadeNameInput, setShadeNameInput] = useState('')
  const [shadeDescInput, setShadeDescInput] = useState('')
  const [lotWeights, setLotWeights] = useState<{ lotNo: string; weightPerThan: number; quality: string }[]>([])
  const [loadingWeights, setLoadingWeights] = useState(false)
  const [savingShade, setSavingShade] = useState(false)
  const [shadeError, setShadeError] = useState('')
  const [shadeSaved, setShadeSaved] = useState(false)

  // Machine & Operator
  const [machines, setMachines] = useState<MachineOption[]>([])
  const [operators, setOperators] = useState<OperatorOption[]>([])
  const [selectedMachineId, setSelectedMachineId] = useState<number | null>(null)
  const [selectedOperatorId, setSelectedOperatorId] = useState<number | null>(null)
  const [shadeName, setShadeName] = useState('')
  const [allShades, setAllShades] = useState<any[]>([])
  const [shadeSearch, setShadeSearch] = useState('')
  const [showShadePicker, setShowShadePicker] = useState(false)

  // Load chemical master + machines + operators + shades
  useEffect(() => {
    fetch('/api/chemicals').then(r => r.json()).then(d => setMasterChemicals(Array.isArray(d) ? d : [])).catch(() => {})
    fetch('/api/dyeing/machines').then(r => r.json()).then(d => setMachines(Array.isArray(d) ? d.filter((m: any) => m.isActive) : [])).catch(() => {})
    fetch('/api/dyeing/operators?active=true').then(r => r.json()).then(d => setOperators(Array.isArray(d) ? d : [])).catch(() => {})
    fetch('/api/shades').then(r => r.json()).then(d => setAllShades(Array.isArray(d) ? d : [])).catch(() => {})
  }, [])

  function applyShadeRecipe(shade: any) {
    const totalThan = lots.reduce((s, l) => s + (parseInt(l.than) || 0), 0)
    // Fetch weight per lot for batch weight calculation
    const lotNos = lots.map(l => l.lotNo).filter(Boolean).join(',')
    fetch(`/api/grey/lot-weight?lots=${encodeURIComponent(lotNos)}`)
      .then(r => r.json())
      .then((weights: any[]) => {
        let batchWeight = 0
        for (const l of lots) {
          const w = weights.find((wt: any) => wt.lotNo.toLowerCase() === l.lotNo.toLowerCase())
          batchWeight += (w?.weightPerThan || 0) * (parseInt(l.than) || 0)
        }
        if (batchWeight <= 0) batchWeight = totalThan * 30 // fallback ~30 kg/than

        const newChems: ChemicalRow[] = (shade.recipeItems || []).map((item: any) => {
          const qtyPer100 = item.quantity || 0
          const calc = (qtyPer100 / 100) * batchWeight
          const rate = item.chemical?.currentPrice ?? masterChemicals.find(m => m.id === item.chemicalId)?.currentPrice ?? null
          return {
            name: item.chemical?.name || item.name || '',
            chemicalId: item.chemicalId,
            quantity: calc.toFixed(3),
            unit: item.chemical?.unit || 'kg',
            rate: rate != null ? String(rate) : '',
            cost: rate != null ? Math.round(calc * rate * 1000) / 1000 : null,
            matched: true,
            processTag: 'shade',
          }
        })
        setChemicals(newChems)
        setShadeName(shade.name + (shade.description ? ' — ' + shade.description : ''))
        setShowShadePicker(false)
        setShadeSearch('')
      })
      .catch(() => {
        // Fallback: just set chemicals without weight calc
        const newChems: ChemicalRow[] = (shade.recipeItems || []).map((item: any) => ({
          name: item.chemical?.name || '',
          chemicalId: item.chemicalId,
          quantity: String(item.quantity || 0),
          unit: item.chemical?.unit || 'kg',
          rate: '',
          cost: null,
          matched: true,
          processTag: 'shade',
        }))
        setChemicals(newChems)
        setShadeName(shade.name + (shade.description ? ' — ' + shade.description : ''))
        setShowShadePicker(false)
        setShadeSearch('')
      })
  }

  // Load available lots on mount
  useEffect(() => {
    fetch('/api/grey/lots').then(r => r.json()).then(d => setAvailableLots(Array.isArray(d) ? d : [])).catch(() => {})
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

      // Load machine/operator/shade
      if (e.machineId) setSelectedMachineId(e.machineId)
      if (e.operatorId) setSelectedOperatorId(e.operatorId)
      if (e.shadeName) setShadeName(e.shadeName)

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
          processTag: c.processTag ?? null,
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

  function selectLot(lotIdx: number, lot: { lotNo: string; greyThan: number; despatchThan: number; stock: number; quality: string }) {
    setLots(prev => {
      const updated = [...prev]
      updated[lotIdx] = {
        ...updated[lotIdx],
        lotNo: lot.lotNo,
        quality: lot.quality,
        stockStatus: lot.stock > 0 ? 'ok' : 'no_stock',
        stockInfo: { stock: lot.stock, greyThan: lot.greyThan, despatchThan: lot.despatchThan },
      }
      return updated
    })
    setLotDropIdx(null)
    setLotSearch('')
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
    setChemicals(prev => [...prev, { name: '', chemicalId: null, quantity: '', unit: 'kg', rate: '', cost: null, matched: false, processTag: null }])
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

  // ─── Save to Shade Master ─────────────────────────────────────────────────

  async function openSaveShade() {
    setShowSaveShade(true); setShadeSaved(false); setShadeError('')
    setShadeNameInput(''); setShadeDescInput(''); setLotWeights([])
    setLoadingWeights(true)
    const validLots = lots.filter(l => l.lotNo.trim())
    if (!validLots.length) { setLoadingWeights(false); return }
    const res = await fetch(`/api/grey/lot-weight?lots=${encodeURIComponent(validLots.map(l => l.lotNo.trim()).join(','))}`)
    const data = await res.json()
    setLotWeights(Array.isArray(data.lots) ? data.lots : [])
    setLoadingWeights(false)
  }

  const batchWeight = lots.reduce((sum, l) => {
    const lw = lotWeights.find(w => w.lotNo === l.lotNo.trim())
    return sum + (lw?.weightPerThan ?? 0) * (parseFloat(l.than) || 0)
  }, 0)

  const normalizedChemicals = chemicals
    .filter(c => c.chemicalId && parseFloat(c.quantity) > 0)
    .map(c => ({ ...c, normQty: batchWeight > 0 ? Math.round((parseFloat(c.quantity) / batchWeight) * 100 * 1000) / 1000 : 0 }))

  async function saveToShade() {
    if (!shadeNameInput.trim()) { setShadeError('Shade name is required'); return }
    if (batchWeight <= 0) { setShadeError('Cannot compute batch weight — check lot data in Grey register'); return }
    if (!normalizedChemicals.length) { setShadeError('No matched chemicals to save'); return }
    setSavingShade(true); setShadeError('')
    const res = await fetch('/api/shades', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: shadeNameInput.trim(),
        description: shadeDescInput.trim() || null,
        recipeItems: normalizedChemicals.map(c => ({ chemicalId: c.chemicalId!, quantity: c.normQty })),
      }),
    })
    const data = await res.json()
    if (!res.ok) { setShadeError(data.error ?? 'Failed to save'); setSavingShade(false); return }
    setSavingShade(false); setShadeSaved(true)
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
          processTag: c.processTag || null,
        })),
      shadeName: shadeName.trim() || null,
      machineId: selectedMachineId,
      operatorId: selectedOperatorId,
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

  if (loading) return <div className="p-8 text-gray-500">Loading...</div>

  return (
    <div className="p-4 md:p-8 max-w-xl">

      {/* ── Save to Shade Master Modal ── */}
      {showSaveShade && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 shrink-0">
              <div>
                <h2 className="text-base font-bold text-white">Save to Shade Master</h2>
                <p className="text-xs text-gray-500 mt-0.5">Normalises chemical quantities to per 100 kg</p>
              </div>
              <button onClick={() => setShowSaveShade(false)} className="text-gray-500 hover:text-gray-300 text-2xl leading-none">×</button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {shadeError && <p className="text-xs text-red-400 bg-red-900/30 border border-red-700 rounded-lg px-3 py-2">{shadeError}</p>}
              {shadeSaved && (
                <div className="text-sm text-emerald-400 bg-emerald-900/30 border border-emerald-700 rounded-lg px-4 py-3 font-medium">
                  ✓ Shade &quot;{shadeNameInput}&quot; saved to Shade Master!
                </div>
              )}
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="block text-xs font-medium text-white mb-1">Shade Name *</label>
                  <input type="text" value={shadeNameInput} onChange={e => setShadeNameInput(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-600 text-gray-100 placeholder-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    placeholder="e.g. APC1, Navy Blue 12..." />
                </div>
                <div>
                  <label className="block text-xs font-medium text-white mb-1">Description (optional)</label>
                  <input type="text" value={shadeDescInput} onChange={e => setShadeDescInput(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-600 text-gray-100 placeholder-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    placeholder="e.g. 4% shade, reactive dye..." />
                </div>
              </div>

              <div className="bg-gray-800 border border-gray-700 rounded-xl p-3">
                <p className="text-xs font-semibold text-white mb-2">Batch Weight Calculation</p>
                {loadingWeights ? (
                  <p className="text-xs text-gray-500 animate-pulse">Loading lot data...</p>
                ) : (
                  <>
                    <div className="space-y-1 mb-2">
                      {lots.filter(l => l.lotNo.trim()).map((l, i) => {
                        const lw = lotWeights.find(w => w.lotNo === l.lotNo.trim())
                        const quality = lw?.quality || l.quality || availableLots.find(a => a.lotNo === l.lotNo.trim())?.quality
                        const than = parseFloat(l.than) || 0
                        const weight = (lw?.weightPerThan ?? 0) * than
                        return (
                          <div key={i} className="flex items-center justify-between text-xs">
                            <span className="font-medium text-gray-300">
                              {l.lotNo}
                              {quality && <span className="block text-[10px] text-indigo-400 font-normal">{quality}</span>}
                            </span>
                            <span className="text-gray-500">{than} than × {lw?.weightPerThan ?? '?'} kg/than</span>
                            <span className={`font-semibold ${weight > 0 ? 'text-gray-200' : 'text-red-400'}`}>
                              {weight > 0 ? `${weight.toFixed(1)} kg` : 'No data'}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                    <div className="flex items-center justify-between border-t border-gray-700 pt-2">
                      <span className="text-xs font-semibold text-white">Total Batch Weight</span>
                      <span className={`text-sm font-bold ${batchWeight > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {batchWeight > 0 ? `${batchWeight.toFixed(2)} kg` : 'Cannot compute'}
                      </span>
                    </div>
                  </>
                )}
              </div>

              {batchWeight > 0 && normalizedChemicals.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-white mb-2">Normalized Recipe (per 100 kg fabric)</p>
                  <div className="border border-gray-700 rounded-xl overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-800 border-b border-gray-700">
                        <tr>
                          <th className="text-left px-3 py-2 font-semibold text-gray-400">Chemical</th>
                          <th className="text-right px-3 py-2 font-semibold text-gray-400">Slip Qty</th>
                          <th className="text-right px-3 py-2 font-semibold text-emerald-400">Per 100 kg</th>
                        </tr>
                      </thead>
                      <tbody>
                        {normalizedChemicals.map((c, i) => (
                          <tr key={i} className={i % 2 === 0 ? 'bg-gray-900' : 'bg-gray-800'}>
                            <td className="px-3 py-2 font-medium text-gray-200">{c.name}</td>
                            <td className="px-3 py-2 text-right text-gray-500">{c.quantity} {c.unit}</td>
                            <td className="px-3 py-2 text-right font-semibold text-emerald-400">{c.normQty} {c.unit}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3 justify-end px-5 py-4 border-t border-gray-700 shrink-0">
              <button type="button" onClick={() => setShowSaveShade(false)}
                className="px-4 py-2 border border-gray-600 rounded-lg text-sm text-gray-400 hover:bg-gray-800">
                {shadeSaved ? 'Close' : 'Cancel'}
              </button>
              {!shadeSaved && (
                <button type="button" onClick={saveToShade} disabled={savingShade || batchWeight <= 0 || loadingWeights}
                  className="px-5 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50">
                  {savingShade ? 'Saving...' : '💾 Save to Shade Master'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-gray-400 hover:text-gray-100 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg px-4 py-2 text-sm font-medium transition">&larr; Back</button>
        <h1 className="text-xl font-bold text-gray-100">Edit Dyeing Slip</h1>
      </div>

      {error && <div className="bg-red-900/30 border border-red-700 text-red-400 rounded-lg px-4 py-3 mb-4 text-sm">{error}</div>}

      <form onSubmit={handleSubmit}>
        {/* ── Slip Details ── */}
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-5 mb-4">
          <h2 className="text-sm font-semibold text-white mb-3">Slip Details</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Date *">
              <input type="date" className={inp} value={form.date} onChange={e => set('date', e.target.value)} required />
            </Field>
            <Field label="Slip No *">
              <input type="number" className={inp} value={form.slipNo} onChange={e => set('slipNo', e.target.value)} required />
            </Field>
            <Field label="Machine">
              <select className={inp} value={selectedMachineId ?? ''} onChange={e => setSelectedMachineId(e.target.value ? parseInt(e.target.value) : null)}>
                <option value="">-- Select Machine --</option>
                {machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </Field>
            <Field label="Operator">
              <select className={inp} value={selectedOperatorId ?? ''} onChange={e => setSelectedOperatorId(e.target.value ? parseInt(e.target.value) : null)}>
                <option value="">-- Select Operator --</option>
                {operators.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </Field>
            <Field label="Shade Name">
              <div className="flex items-center gap-2">
                <input type="text" className={`${inp} flex-1`} value={shadeName} onChange={e => setShadeName(e.target.value)} placeholder="Shade name" />
                <button type="button" onClick={() => setShowShadePicker(true)}
                  className="text-[10px] font-medium bg-indigo-900/40 text-indigo-300 hover:bg-indigo-900/60 border border-indigo-700 px-2.5 py-1.5 rounded-lg whitespace-nowrap">
                  Change Shade
                </button>
              </div>
            </Field>
            <Field label="Notes">
              <input type="text" className={inp} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Any remarks" />
            </Field>
          </div>
        </div>

        {/* ── Lots ── */}
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-5 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-white">
              Lots
              {lots.length > 1 && <span className="ml-2 text-xs font-normal text-gray-500">{lots.length} lots</span>}
            </h2>
            <button type="button" onClick={addLotRow} className="text-xs text-purple-400 hover:text-purple-200 font-medium">
              + Add Lot
            </button>
          </div>
          <div className="space-y-3">
            {lots.map((lot, i) => {
              const selectedLotNos = lots.map((e, idx) => idx !== i ? e.lotNo : '').filter(Boolean)
              const filteredLots = availableLots
                .filter(l => !selectedLotNos.includes(l.lotNo))
                .filter(l => !lotSearch || l.lotNo.toLowerCase().includes(lotSearch.toLowerCase()))
              return (
              <div key={i} className="border border-gray-700 rounded-xl p-3 bg-gray-700/40">
                {/* Row 1: # + Lot selector + remove */}
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs text-gray-600 w-5 shrink-0">#{i + 1}</span>
                  <div className="flex-1 relative">
                    <div
                      className={`flex items-center gap-2 border rounded-lg px-3 py-2 bg-gray-800 cursor-pointer ${lotDropIdx === i ? 'ring-2 ring-purple-500 border-purple-500' : 'border-gray-600'}`}
                      onClick={() => { setLotDropIdx(lotDropIdx === i ? null : i); setLotSearch('') }}
                    >
                      <span className={`flex-1 text-sm flex items-center gap-1.5 ${lot.lotNo ? 'font-medium text-gray-100' : 'text-gray-600'}`}>
                        {lot.lotNo || 'Select lot...'}
                        {lot.lotNo && lot.quality && (
                          <span className="text-[10px] font-normal text-indigo-400 bg-indigo-900/40 border border-indigo-700 px-1.5 py-0.5 rounded">{lot.quality}</span>
                        )}
                      </span>
                      {lot.stockStatus === 'ok' && (
                        <span className="text-green-400 text-[10px] font-semibold bg-green-900/40 border border-green-700 px-1 py-0.5 rounded shrink-0">OK</span>
                      )}
                      {lot.stockStatus === 'no_stock' && (
                        <span className="text-amber-400 text-[10px] font-semibold bg-amber-900/40 border border-amber-700 px-1 py-0.5 rounded shrink-0">Low</span>
                      )}
                      {lot.stockStatus === 'not_found' && (
                        <span className="text-red-400 text-[10px] font-semibold bg-red-900/40 border border-red-700 px-1 py-0.5 rounded shrink-0">N/A</span>
                      )}
                      <span className="text-gray-600 text-xs shrink-0">&#9660;</span>
                    </div>

                    {/* Searchable lot dropdown */}
                    {lotDropIdx === i && (
                      <div className="absolute left-0 right-0 top-full mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-2xl z-20 max-h-60 flex flex-col">
                        <input
                          type="text"
                          autoFocus
                          className="w-full border-b border-gray-700 bg-transparent text-gray-100 placeholder-gray-600 px-3 py-2 text-sm focus:outline-none rounded-t-lg"
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
                              className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-700 flex items-center justify-between ${lot.lotNo === l.lotNo ? 'bg-purple-900/40 font-medium' : ''}`}
                              onClick={e => { e.stopPropagation(); selectLot(i, l) }}
                            >
                              <span className="font-medium text-gray-200 flex items-center gap-1.5">
                                {l.lotNo}
                                {l.quality && <span className="text-[10px] font-normal text-indigo-400 bg-indigo-900/40 border border-indigo-800 px-1 py-0.5 rounded">{l.quality}</span>}
                              </span>
                              <span className="text-xs text-gray-500">Stock: {l.stock} than</span>
                            </button>
                          ))}
                          {filteredLots.length === 0 && !lotSearch && (
                            <p className="px-3 py-2 text-xs text-gray-600">No lots with available stock</p>
                          )}
                          {filteredLots.length === 0 && lotSearch && (
                            <button
                              type="button"
                              className="w-full text-left px-3 py-2 text-sm hover:bg-amber-900/30 text-amber-400 border-t border-gray-700 flex items-center gap-1"
                              onClick={e => {
                                e.stopPropagation()
                                updateLot(i, 'lotNo', lotSearch.trim())
                                setLotDropIdx(null)
                                setLotSearch('')
                                setTimeout(() => handleLotBlur(lotSearch.trim()), 100)
                              }}
                            >
                              <span className="text-amber-500">+</span> Use &quot;{lotSearch.trim()}&quot; manually
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  {lots.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeLotRow(i)}
                      className="text-red-500 hover:text-red-400 text-xl leading-none shrink-0 w-6 text-center"
                    >&times;</button>
                  )}
                </div>

                {/* Row 2: Stock info line */}
                {lot.stockStatus === 'loading' && <p className="text-xs text-gray-500 pl-7 mb-2">Checking stock...</p>}
                {lot.stockStatus === 'not_found' && <p className="text-xs text-red-400 pl-7 mb-2">Lot not found in Grey register</p>}
                {lot.stockStatus === 'no_stock' && lot.stockInfo && (
                  <p className="text-xs text-amber-400 pl-7 mb-2">
                    Grey: {lot.stockInfo.greyThan} | Despatched: {lot.stockInfo.despatchThan} | Balance: <strong>{lot.stockInfo.stock}</strong>
                  </p>
                )}
                {lot.stockStatus === 'ok' && lot.stockInfo && (
                  <p className="text-xs text-green-400 pl-7 mb-2">
                    Grey: {lot.stockInfo.greyThan} | Despatched: {lot.stockInfo.despatchThan} | Balance: <strong>{lot.stockInfo.stock}</strong>
                  </p>
                )}

                {/* Row 3: Than input */}
                <div className="pl-7">
                  <label className="block text-[10px] text-white mb-0.5">Than *</label>
                  <input
                    type="number"
                    className="w-full bg-gray-800 border border-gray-600 text-gray-100 placeholder-gray-600 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    value={lot.than}
                    onChange={e => updateLot(i, 'than', e.target.value)}
                    required
                    placeholder="Qty"
                  />
                </div>
              </div>
              )
            })}
          </div>
          {lots.length > 1 && (
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-700">
              <span className="text-xs text-white">Total Than</span>
              <span className="text-sm font-bold text-indigo-400">{lots.reduce((s, l) => s + (parseInt(l.than) || 0), 0)}</span>
            </div>
          )}
        </div>

        {/* ── Chemicals ── */}
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-5 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-white">
              Chemicals Used
              {chemicals.length > 0 && <span className="ml-2 text-xs font-normal text-gray-500">{chemicals.length} items</span>}
            </h2>
            <div className="flex items-center gap-2">
              {chemicals.some(c => c.chemicalId) && (
                <button type="button" onClick={openSaveShade}
                  className="text-xs text-emerald-400 hover:text-emerald-200 font-medium bg-emerald-900/30 border border-emerald-700 rounded-lg px-2.5 py-1 hover:bg-emerald-900/50 transition">
                  💾 Save to Shade
                </button>
              )}
              <button type="button" onClick={addChemicalRow} className="text-xs text-purple-400 hover:text-purple-200 font-medium">
                + Add Chemical
              </button>
            </div>
          </div>

          {chemicals.length === 0 ? (
            <p className="text-xs text-gray-600 text-center py-4">No chemicals. Click &quot;+ Add Chemical&quot; to add.</p>
          ) : (
            <div className="space-y-3">
              {chemicals.map((c, i) => (
                <div key={i} className="border border-gray-700 rounded-xl p-3 bg-gray-700/40">
                  {/* Chemical name row */}
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs text-gray-600 w-5 shrink-0">#{i + 1}</span>
                    <div className="flex-1 relative">
                      <div
                        className={`flex items-center gap-2 border rounded-lg px-3 py-2 bg-gray-800 cursor-pointer ${chemDropIdx === i ? 'ring-2 ring-purple-500 border-purple-500' : 'border-gray-600'}`}
                        onClick={() => { setChemDropIdx(chemDropIdx === i ? null : i); setChemSearch('') }}
                      >
                        <span className={`flex-1 text-sm ${c.name ? 'font-medium text-gray-100' : 'text-gray-600'}`}>
                          {c.name || 'Select chemical...'}
                        </span>
                        {c.matched && (
                          <span className="text-green-400 text-[10px] font-semibold bg-green-900/40 border border-green-700 px-1 py-0.5 rounded shrink-0">✓</span>
                        )}
                        {!c.matched && c.name && (
                          <span className="text-amber-400 text-[10px] font-semibold bg-amber-900/40 border border-amber-700 px-1 py-0.5 rounded shrink-0">New</span>
                        )}
                        <span className="text-gray-600 text-xs shrink-0">&#9660;</span>
                      </div>

                      {/* Searchable dropdown */}
                      {chemDropIdx === i && (
                        <div className="absolute left-0 right-0 top-full mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-2xl z-20 max-h-60 flex flex-col">
                          <input
                            type="text"
                            autoFocus
                            className="w-full border-b border-gray-700 bg-transparent text-gray-100 placeholder-gray-600 px-3 py-2 text-sm focus:outline-none rounded-t-lg"
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
                                  className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-700 flex items-center justify-between ${c.chemicalId === m.id ? 'bg-purple-900/40 font-medium' : ''}`}
                                  onClick={e => { e.stopPropagation(); selectMasterChemical(i, m) }}
                                >
                                  <span className="text-gray-200">{m.name}</span>
                                  {m.currentPrice != null && (
                                    <span className="text-xs text-gray-500">&#8377;{m.currentPrice}/{m.unit}</span>
                                  )}
                                </button>
                              ))
                            }
                            {chemSearch.trim() && !masterChemicals.some(m => m.name.toLowerCase() === chemSearch.toLowerCase()) && (
                              <button
                                type="button"
                                className="w-full text-left px-3 py-2 text-sm hover:bg-amber-900/30 text-amber-400 border-t border-gray-700 flex items-center gap-1"
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
                      className="text-red-500 hover:text-red-400 text-xl leading-none shrink-0 w-6 text-center"
                    >&times;</button>
                  </div>

                  {/* Qty / Unit / Rate / Cost row */}
                  <div className="grid grid-cols-2 gap-2 pl-7">
                    <div>
                      <label className="block text-[10px] text-white mb-0.5">Quantity</label>
                      <input
                        type="number" step="0.001"
                        className="w-full bg-gray-800 border border-gray-600 text-gray-100 placeholder-gray-600 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                        value={c.quantity}
                        onChange={e => updateChemical(i, 'quantity', e.target.value)}
                        placeholder="0"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-white mb-0.5">Unit</label>
                      <select
                        className="w-full bg-gray-800 border border-gray-600 text-gray-100 rounded-lg px-3 py-1.5 text-sm focus:outline-none"
                        value={c.unit}
                        onChange={e => updateChemical(i, 'unit', e.target.value)}
                      >
                        {['kg', 'liter', 'gram', 'ml', 'piece', 'bag'].map(u => <option key={u} className="bg-gray-800">{u}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-white mb-0.5">Rate (&#8377;/{c.unit})</label>
                      <input
                        type="number" step="0.01"
                        className="w-full bg-gray-800 border border-gray-600 text-gray-100 placeholder-gray-600 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                        value={c.rate}
                        onChange={e => updateChemical(i, 'rate', e.target.value)}
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-white mb-0.5">Cost (&#8377;)</label>
                      <div className={`w-full border rounded-lg px-3 py-1.5 text-sm font-semibold ${c.cost != null ? 'border-purple-700 bg-purple-900/30 text-purple-300' : 'border-gray-700 bg-gray-800 text-gray-600'}`}>
                        {c.cost != null ? `₹${c.cost.toFixed(2)}` : '—'}
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {/* Total cost */}
              {totalCost > 0 && (() => {
                const totalThan = lots.reduce((s, l) => s + (parseInt(l.than) || 0), 0)
                const costPerThan = totalThan > 0 ? totalCost / totalThan : 0
                return (
                  <div className="bg-purple-900/30 border border-purple-700 rounded-xl px-4 py-3 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-white">Total Dyeing Cost</span>
                      <span className="text-lg font-bold text-purple-300">&#8377;{totalCost.toFixed(2)}</span>
                    </div>
                    {totalThan > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-purple-200">Cost per Than ({totalThan})</span>
                        <span className="text-sm font-semibold text-purple-300">&#8377;{costPerThan.toFixed(2)}</span>
                      </div>
                    )}
                  </div>
                )
              })()}
            </div>
          )}
        </div>

        {/* ── Actions ── */}
        <div className="flex gap-3 justify-end">
          <button type="button" onClick={() => router.back()} className="px-4 py-2 border border-gray-600 rounded-lg text-sm text-gray-400 hover:bg-gray-800">Cancel</button>
          <button type="submit" disabled={saving || stockStatus === 'not_found'} className="px-6 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50">
            {saving ? 'Saving...' : 'Update Entry'}
          </button>
        </div>
      </form>

      {/* Shade Picker Modal */}
      {showShadePicker && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-8 bg-black/50 p-4" onClick={() => setShowShadePicker(false)}>
          <div className="bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col border border-gray-700" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
              <div>
                <h3 className="text-base font-bold text-white">Change Shade</h3>
                <p className="text-xs text-gray-400 mt-0.5">Select shade — chemicals will be replaced with recipe</p>
              </div>
              <button onClick={() => setShowShadePicker(false)} className="text-gray-400 hover:text-gray-200 text-xl leading-none">&times;</button>
            </div>
            <div className="px-5 py-3 border-b border-gray-700">
              <input
                type="text"
                value={shadeSearch}
                onChange={e => setShadeSearch(e.target.value)}
                placeholder="Search shade name..."
                autoFocus
                className="w-full bg-gray-700 border border-gray-600 text-gray-100 placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
              {allShades
                .filter(s => {
                  const q = shadeSearch.toLowerCase().trim()
                  return !q || s.name.toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q)
                })
                .map(s => (
                  <button
                    key={s.id}
                    onClick={() => {
                      if (chemicals.length > 0 && !confirm(`Replace all ${chemicals.length} chemicals with "${s.name}" recipe (${s.recipeItems?.length || 0} items)?`)) return
                      applyShadeRecipe(s)
                    }}
                    className="w-full text-left bg-gray-700/50 hover:bg-purple-900/30 border border-gray-600 hover:border-purple-600 rounded-xl p-3 transition"
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-sm font-semibold text-white">{s.name}</span>
                      <span className="text-[10px] text-gray-400">{s.recipeItems?.length || 0} items</span>
                    </div>
                    {s.description && <p className="text-xs text-gray-400">{s.description}</p>}
                    {s.recipeItems?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {s.recipeItems.slice(0, 5).map((item: any, i: number) => (
                          <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-gray-600 text-gray-300">
                            {item.chemical?.name || 'Unknown'} ({item.quantity})
                          </span>
                        ))}
                        {s.recipeItems.length > 5 && <span className="text-[9px] text-gray-500">+{s.recipeItems.length - 5}</span>}
                      </div>
                    )}
                  </button>
                ))
              }
              {allShades.filter(s => {
                const q = shadeSearch.toLowerCase().trim()
                return !q || s.name.toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q)
              }).length === 0 && (
                <div className="text-center text-gray-500 py-8">No shades found</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const inp = 'w-full bg-gray-700 border border-gray-600 text-gray-100 placeholder-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500'
function Field({ label, children, span = 1 }: { label: string; children: React.ReactNode; span?: number }) {
  return (
    <div className={span === 2 ? 'sm:col-span-2' : ''}>
      <label className="block text-xs font-medium text-white mb-1">{label}</label>
      {children}
    </div>
  )
}
