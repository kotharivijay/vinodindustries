'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Image Zoom Modal ─────────────────────────────────────────────────────────

function ZoomModal({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-2"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-white text-3xl leading-none z-10"
      >&times;</button>
      <img
        src={src}
        alt="Dyeing slip"
        className="max-w-full max-h-full object-contain rounded-lg"
        onClick={e => e.stopPropagation()}
        style={{ touchAction: 'pinch-zoom' }}
      />
    </div>
  )
}

// ─── Main Form ────────────────────────────────────────────────────────────────

export default function DyeingForm() {
  const router = useRouter()

  // Image state
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [imageBase64, setImageBase64] = useState<string | null>(null)
  const [imageType, setImageType] = useState<string>('image/jpeg')
  const [showZoom, setShowZoom] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Voice note state
  const [voiceText, setVoiceText] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [speechSupported, setSpeechSupported] = useState(false)
  const recognitionRef = useRef<any>(null)

  // Extraction state
  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState('')
  const [extracted, setExtracted] = useState(false)

  // Form state
  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0],
    slipNo: '',
    lotNo: '',
    than: '',
    notes: '',
  })

  // Chemicals state
  const [chemicals, setChemicals] = useState<ChemicalRow[]>([])
  const [masterChemicals, setMasterChemicals] = useState<ChemicalMaster[]>([])

  // Lot stock check
  const [stockStatus, setStockStatus] = useState<StockStatus>('idle')
  const [stockInfo, setStockInfo] = useState<{ stock: number; greyThan: number; despatchThan: number } | null>(null)

  // Save state
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Load chemical master on mount
  useEffect(() => {
    fetch('/api/chemicals')
      .then(r => r.json())
      .then(d => setMasterChemicals(Array.isArray(d) ? d : []))
      .catch(() => {})
  }, [])

  // Check speech recognition support
  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    setSpeechSupported(!!SR)
  }, [])

  // ─── Image Handling ────────────────────────────────────────────────────────

  function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const type = file.type || 'image/jpeg'
    setImageType(type)
    const reader = new FileReader()
    reader.onload = ev => {
      const result = ev.target?.result as string
      setImagePreview(result)
      // Strip data URL prefix to get pure base64
      setImageBase64(result.split(',')[1])
      setExtracted(false)
      setExtractError('')
    }
    reader.readAsDataURL(file)
  }

  // ─── Voice Note ────────────────────────────────────────────────────────────

  function toggleRecording() {
    if (!speechSupported) return
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition

    if (isRecording) {
      recognitionRef.current?.stop()
      setIsRecording(false)
      return
    }

    const recognition = new SR()
    recognition.lang = 'en-IN'
    recognition.continuous = false
    recognition.interimResults = false

    recognition.onresult = (e: any) => {
      const transcript = Array.from(e.results as any[])
        .map((r: any) => r[0].transcript)
        .join(' ')
      setVoiceText(prev => prev ? prev + ' ' + transcript : transcript)
    }
    recognition.onend = () => setIsRecording(false)
    recognition.onerror = () => setIsRecording(false)

    recognitionRef.current = recognition
    recognition.start()
    setIsRecording(true)
  }

  // ─── OCR / AI Extraction ──────────────────────────────────────────────────

  function matchToMaster(name: string): { chemicalId: number | null; rate: string } {
    const norm = (s: string) => s.toLowerCase().trim()
    const match = masterChemicals.find(c => norm(c.name) === norm(name))
    if (match) return { chemicalId: match.id, rate: match.currentPrice?.toString() ?? '' }
    // Partial match
    const partial = masterChemicals.find(c =>
      norm(c.name).includes(norm(name)) || norm(name).includes(norm(c.name))
    )
    if (partial) return { chemicalId: partial.id, rate: partial.currentPrice?.toString() ?? '' }
    return { chemicalId: null, rate: '' }
  }

  async function handleExtract() {
    if (!imageBase64) return
    setExtracting(true); setExtractError('')

    const res = await fetch('/api/dyeing/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64, mediaType: imageType, voiceNote: voiceText || null }),
    })

    const data = await res.json()
    if (!res.ok) {
      setExtractError(data.error ?? 'Extraction failed')
      setExtracting(false)
      return
    }

    // Auto-fill form fields
    setForm(prev => ({
      date: data.date
        ? (() => {
            const [d, m, y] = data.date.split('/')
            return `${y}-${m?.padStart(2, '0')}-${d?.padStart(2, '0')}`
          })()
        : prev.date,
      slipNo: data.slipNo ?? prev.slipNo,
      lotNo: data.lotNo ?? prev.lotNo,
      than: data.than?.toString() ?? prev.than,
      notes: data.notes ?? prev.notes,
    }))

    // Trigger lot check if lot extracted
    if (data.lotNo) checkLotStock(data.lotNo)

    // Build chemical rows
    if (data.chemicals?.length) {
      const rows: ChemicalRow[] = data.chemicals.map((c: any) => {
        const { chemicalId, rate } = matchToMaster(c.name)
        const qty = c.quantity != null ? String(c.quantity) : ''
        const rateNum = parseFloat(rate)
        const qtyNum = parseFloat(qty)
        const cost = !isNaN(rateNum) && !isNaN(qtyNum) ? parseFloat((rateNum * qtyNum).toFixed(2)) : null
        return {
          name: c.name,
          chemicalId,
          quantity: qty,
          unit: c.unit || 'kg',
          rate,
          cost,
          matched: chemicalId !== null,
        }
      })
      setChemicals(rows)
    }

    setExtracted(true)
    setExtracting(false)

    // Show confidence warning
    if (data.confidence === 'low') {
      setExtractError('⚠ Low confidence — image may be unclear. Please verify all fields.')
    }
  }

  // ─── Lot Stock Check ──────────────────────────────────────────────────────

  const checkLotStock = useCallback(async (lot: string) => {
    if (!lot.trim()) return
    setStockStatus('loading')
    const res = await fetch(`/api/grey/stock?lotNo=${encodeURIComponent(lot.trim())}`)
    const data = await res.json()
    if (!data.exists) { setStockStatus('not_found'); setStockInfo(null) }
    else if (data.stock <= 0) { setStockStatus('no_stock'); setStockInfo(data) }
    else { setStockStatus('ok'); setStockInfo(data) }
  }, [])

  function handleLotChange(val: string) {
    setForm(prev => ({ ...prev, lotNo: val }))
    setStockStatus('idle'); setStockInfo(null)
  }

  // ─── Chemical Row Editing ─────────────────────────────────────────────────

  function updateChemical(i: number, field: keyof ChemicalRow, value: string) {
    setChemicals(prev => {
      const updated = [...prev]
      updated[i] = { ...updated[i], [field]: value }
      // Recalculate cost
      const qty = parseFloat(field === 'quantity' ? value : updated[i].quantity)
      const rate = parseFloat(field === 'rate' ? value : updated[i].rate)
      updated[i].cost = !isNaN(qty) && !isNaN(rate) ? parseFloat((qty * rate).toFixed(2)) : null
      return updated
    })
  }

  function addChemicalRow() {
    setChemicals(prev => [...prev, { name: '', chemicalId: null, quantity: '', unit: 'kg', rate: '', cost: null, matched: false }])
  }

  function removeChemical(i: number) {
    setChemicals(prev => prev.filter((_, idx) => idx !== i))
  }

  // ─── Submit ───────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (stockStatus === 'not_found') { setError('Lot not found in Grey register.'); return }
    setSaving(true); setError('')

    const payload = {
      ...form,
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

    const res = await fetch('/api/dyeing', {
      method: 'POST',
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

  // ─── Derived ──────────────────────────────────────────────────────────────

  const totalCost = chemicals.reduce((sum, c) => sum + (c.cost ?? 0), 0)
  const set = (field: string, value: string) => setForm(prev => ({ ...prev, [field]: value }))

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="p-4 md:p-8 max-w-3xl">
      {showZoom && imagePreview && <ZoomModal src={imagePreview} onClose={() => setShowZoom(false)} />}

      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-800 text-sm">← Back</button>
        <h1 className="text-2xl font-bold text-gray-800">New Dyeing Slip</h1>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">{error}</div>}

      {/* ── Section 1: Image + AI ── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Step 1 — Upload Slip Image (optional)</h2>

        <div className="flex gap-3 flex-wrap">
          {/* Image preview or upload button */}
          {imagePreview ? (
            <div className="relative">
              <img
                src={imagePreview}
                alt="Slip preview"
                className="h-36 w-28 object-cover rounded-lg border border-gray-200 cursor-pointer"
                onClick={() => setShowZoom(true)}
              />
              <button
                type="button"
                onClick={() => setShowZoom(true)}
                className="absolute bottom-1.5 right-1.5 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded"
              >
                Zoom
              </button>
              <button
                type="button"
                onClick={() => { setImagePreview(null); setImageBase64(null); setExtracted(false) }}
                className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs leading-none"
              >
                &times;
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="h-36 w-28 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center gap-1 text-gray-400 hover:border-purple-400 hover:text-purple-500 transition"
            >
              <span className="text-2xl">📷</span>
              <span className="text-xs text-center leading-tight">Camera / Gallery</span>
            </button>
          )}

          {/* Action buttons */}
          <div className="flex flex-col justify-between gap-2 flex-1 min-w-[160px]">
            {/* Voice note */}
            <div>
              <button
                type="button"
                onClick={toggleRecording}
                disabled={!speechSupported}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition w-full justify-center ${
                  isRecording
                    ? 'bg-red-500 text-white animate-pulse'
                    : speechSupported
                    ? 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                }`}
              >
                <span>{isRecording ? '⏹ Stop' : '🎤 Voice Note'}</span>
              </button>
              {!speechSupported && <p className="text-xs text-gray-400 mt-1 text-center">Use Chrome for voice</p>}
            </div>

            {/* Voice text area */}
            {(voiceText || isRecording) && (
              <textarea
                className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-600 resize-none w-full"
                rows={3}
                placeholder="Voice note transcript..."
                value={voiceText}
                onChange={e => setVoiceText(e.target.value)}
              />
            )}

            {/* Extract button */}
            {imageBase64 && !extracted && (
              <button
                type="button"
                onClick={handleExtract}
                disabled={extracting}
                className="bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {extracting ? (
                  <><span className="animate-spin">⟳</span> Extracting...</>
                ) : (
                  '✨ Extract with AI'
                )}
              </button>
            )}

            {extracted && (
              <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg px-3 py-2 text-xs font-medium text-center">
                ✅ Fields auto-filled from slip
              </div>
            )}
          </div>
        </div>

        {extractError && (
          <div className="mt-3 bg-amber-50 border border-amber-200 text-amber-700 rounded-lg px-3 py-2 text-xs">
            {extractError}
          </div>
        )}
      </div>

      {/* ── Section 2: Form Fields ── */}
      <form onSubmit={handleSubmit}>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Step 2 — Slip Details</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Date *">
              <input type="date" className={inp} value={form.date} onChange={e => set('date', e.target.value)} required />
            </Field>
            <Field label="Slip No *">
              <input type="number" className={inp} value={form.slipNo} onChange={e => set('slipNo', e.target.value)} required placeholder="e.g. 266" />
            </Field>

            <Field label="Lot No *" span={2}>
              <input
                type="text" className={inp} value={form.lotNo}
                onChange={e => handleLotChange(e.target.value)}
                onBlur={() => checkLotStock(form.lotNo)}
                required placeholder="e.g. PS-502"
              />
              {stockStatus === 'loading' && <p className="text-xs text-gray-400 mt-1">Checking stock...</p>}
              {stockStatus === 'not_found' && <p className="text-xs text-red-500 mt-1">⚠ Lot not found in Grey register</p>}
              {stockStatus === 'no_stock' && stockInfo && (
                <p className="text-xs text-amber-600 mt-1">
                  ⚠ No stock — Grey: {stockInfo.greyThan}, Despatched: {stockInfo.despatchThan}, Balance: <strong>{stockInfo.stock}</strong>
                </p>
              )}
              {stockStatus === 'ok' && stockInfo && (
                <p className="text-xs text-green-600 mt-1">
                  ✓ Stock OK — Grey: {stockInfo.greyThan}, Despatched: {stockInfo.despatchThan}, Balance: <strong>{stockInfo.stock}</strong>
                </p>
              )}
            </Field>

            <Field label="Than *">
              <input type="number" className={inp} value={form.than} onChange={e => set('than', e.target.value)} required placeholder="Quantity" />
            </Field>

            <Field label="Notes">
              <input type="text" className={inp} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Any remarks from slip" />
            </Field>
          </div>
        </div>

        {/* ── Section 3: Chemicals ── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">
              Step 3 — Chemicals Used
              {chemicals.length > 0 && <span className="ml-2 text-xs font-normal text-gray-400">{chemicals.length} items</span>}
            </h2>
            <button type="button" onClick={addChemicalRow} className="text-xs text-purple-600 hover:text-purple-800 font-medium">
              + Add Row
            </button>
          </div>

          {chemicals.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-4">
              No chemicals added yet. Upload a slip image and click &quot;Extract with AI&quot;, or click &quot;+ Add Row&quot; to enter manually.
            </p>
          ) : (
            <>
              <div className="overflow-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-2 py-2 text-left text-gray-500 font-medium">Chemical</th>
                      <th className="px-2 py-2 text-left text-gray-500 font-medium w-20">Qty</th>
                      <th className="px-2 py-2 text-left text-gray-500 font-medium w-16">Unit</th>
                      <th className="px-2 py-2 text-left text-gray-500 font-medium w-20">Rate (₹)</th>
                      <th className="px-2 py-2 text-right text-gray-500 font-medium w-20">Cost (₹)</th>
                      <th className="w-6" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {chemicals.map((c, i) => (
                      <tr key={i}>
                        <td className="px-2 py-1.5">
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-purple-300"
                              value={c.name}
                              onChange={e => updateChemical(i, 'name', e.target.value)}
                              placeholder="Chemical name"
                            />
                            {c.matched && (
                              <span className="text-green-500 shrink-0" title="Matched to master">✓</span>
                            )}
                            {!c.matched && c.name && (
                              <span className="text-amber-400 shrink-0 text-[10px]" title="Not in master">new</span>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="number" step="0.001"
                            className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-purple-300"
                            value={c.quantity}
                            onChange={e => updateChemical(i, 'quantity', e.target.value)}
                            placeholder="0"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <select
                            className="w-full border border-gray-200 rounded px-1 py-1 text-xs focus:outline-none"
                            value={c.unit}
                            onChange={e => updateChemical(i, 'unit', e.target.value)}
                          >
                            {['kg', 'liter', 'gram', 'ml', 'piece', 'bag'].map(u => <option key={u}>{u}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="number" step="0.01"
                            className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-purple-300"
                            value={c.rate}
                            onChange={e => updateChemical(i, 'rate', e.target.value)}
                            placeholder="0.00"
                          />
                        </td>
                        <td className="px-2 py-1.5 text-right font-medium text-gray-700">
                          {c.cost != null ? `₹${c.cost.toFixed(2)}` : '—'}
                        </td>
                        <td className="px-1 py-1.5">
                          <button type="button" onClick={() => removeChemical(i)} className="text-red-300 hover:text-red-500 text-base leading-none">&times;</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {totalCost > 0 && (
                    <tfoot className="border-t bg-purple-50">
                      <tr>
                        <td colSpan={4} className="px-2 py-2 text-xs font-semibold text-gray-600 text-right">Total Dyeing Cost</td>
                        <td className="px-2 py-2 text-right text-sm font-bold text-purple-700">₹{totalCost.toFixed(2)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
              <p className="text-xs text-gray-400 mt-2">
                ✓ = matched to Chemical Master (rate auto-filled) &nbsp;|&nbsp; new = will be available for linking later
              </p>
            </>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="flex gap-3 justify-end">
          <button
            type="button" onClick={() => router.back()}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || stockStatus === 'not_found'}
            className="px-6 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-60"
          >
            {saving ? 'Saving...' : 'Save Dyeing Slip'}
          </button>
        </div>
      </form>

      {/* Hidden file input */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleImageSelect}
      />
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
