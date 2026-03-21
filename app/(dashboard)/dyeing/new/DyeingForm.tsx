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

  // Marka entries (lot + than pairs)
  interface MarkaEntry { lotNo: string; than: string; stockStatus: StockStatus; stockInfo: { stock: number; greyThan: number; despatchThan: number } | null }
  const [markaEntries, setMarkaEntries] = useState<MarkaEntry[]>([{ lotNo: '', than: '', stockStatus: 'idle', stockInfo: null }])

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
      if (recognitionRef.current) recognitionRef.current._active = false
      recognitionRef.current?.stop()
      setIsRecording(false)
      return
    }

    const recognition = new SR()
    recognition.lang = 'en-IN'
    recognition.continuous = true
    recognition.interimResults = true

    recognition.onresult = (e: any) => {
      // Only append final results (not interim)
      let finalText = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript + ' '
      }
      if (finalText) setVoiceText(prev => prev ? prev.trimEnd() + ' ' + finalText.trim() : finalText.trim())
    }
    recognition.onend = () => {
      // Auto-restart if user hasn't manually stopped
      if (recognitionRef.current?._active) recognition.start()
      else setIsRecording(false)
    }
    recognition.onerror = (e: any) => {
      if (e.error !== 'aborted') setIsRecording(false)
    }

    recognition._active = true
    recognitionRef.current = recognition
    recognition.start()
    setIsRecording(true)
  }

  // ─── OCR / AI Extraction ──────────────────────────────────────────────────

  // Levenshtein distance for fuzzy matching
  function levenshtein(a: string, b: string): number {
    const m = a.length, n = b.length
    const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
      Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
    )
    for (let i = 1; i <= m; i++)
      for (let j = 1; j <= n; j++)
        dp[i][j] = a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    return dp[m][n]
  }

  function similarity(a: string, b: string): number {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
    const na = norm(a), nb = norm(b)
    if (!na || !nb) return 0
    const maxLen = Math.max(na.length, nb.length)
    return 1 - levenshtein(na, nb) / maxLen
  }

  function matchToMaster(name: string): { chemicalId: number | null; rate: string; matchedName: string } {
    if (!name.trim() || masterChemicals.length === 0) return { chemicalId: null, rate: '', matchedName: '' }

    const norm = (s: string) => s.toLowerCase().trim()

    // 1. Exact match
    const exact = masterChemicals.find(c => norm(c.name) === norm(name))
    if (exact) return { chemicalId: exact.id, rate: exact.currentPrice?.toString() ?? '', matchedName: exact.name }

    // 2. Substring match
    const partial = masterChemicals.find(c =>
      norm(c.name).includes(norm(name)) || norm(name).includes(norm(c.name))
    )
    if (partial) return { chemicalId: partial.id, rate: partial.currentPrice?.toString() ?? '', matchedName: partial.name }

    // 3. Fuzzy match — find best similarity score
    let best: ChemicalMaster | null = null
    let bestScore = 0
    for (const c of masterChemicals) {
      const score = similarity(name, c.name)
      if (score > bestScore) { bestScore = score; best = c }
    }

    // Threshold: 0.5 = at least 50% similar
    if (best && bestScore >= 0.5) {
      return { chemicalId: best.id, rate: best.currentPrice?.toString() ?? '', matchedName: best.name }
    }

    return { chemicalId: null, rate: '', matchedName: '' }
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
      lotNo: data.lotNo ? formatLotNo(data.lotNo) : prev.lotNo,
      than: data.than?.toString() ?? prev.than,
      notes: data.notes ?? prev.notes,
    }))

    // Populate marka entries from AI response
    if (data.marka?.length) {
      const entries = data.marka.map((m: any) => ({
        lotNo: formatLotNo(m.lotNo || ''),
        than: m.than?.toString() ?? '',
        stockStatus: 'idle' as StockStatus,
        stockInfo: null,
      }))
      setMarkaEntries(entries)
      // Check stock for each marka lot
      entries.forEach((_: any, idx: number) => {
        if (data.marka[idx].lotNo) {
          setTimeout(() => checkMarkaStock(idx), idx * 200)
        }
      })
    } else if (data.lotNo) {
      setMarkaEntries([{ lotNo: formatLotNo(data.lotNo), than: data.than?.toString() ?? '', stockStatus: 'idle', stockInfo: null }])
      checkLotStock(data.lotNo)
    }

    // Build chemical rows with fuzzy matching
    if (data.chemicals?.length) {
      const rows: ChemicalRow[] = data.chemicals.map((c: any) => {
        const { chemicalId, rate, matchedName } = matchToMaster(c.name)
        // Use master name if fuzzy matched, otherwise keep OCR name
        const displayName = matchedName || c.name
        const qty = c.quantity != null ? String(c.quantity) : ''
        const rateNum = parseFloat(rate)
        const qtyNum = parseFloat(qty)
        const cost = !isNaN(rateNum) && !isNaN(qtyNum) ? parseFloat((rateNum * qtyNum).toFixed(2)) : null
        return {
          name: displayName,
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

  // Lot No format: ALPHA-NUMERIC e.g. PS-1325, AJ-325
  function formatLotNo(raw: string): string {
    let val = raw.toUpperCase().replace(/\s/g, '')
    val = val.replace(/^([A-Z]+)(\d+)$/, '$1-$2')
    return val
  }

  const lotNoValid = !form.lotNo || /^[A-Z]+-\d+$/i.test(form.lotNo)

  function handleLotChange(val: string) {
    const formatted = formatLotNo(val)
    setForm(prev => ({ ...prev, lotNo: formatted }))
    setStockStatus('idle'); setStockInfo(null)
  }

  // ─── Marka Entries ──────────────────────────────────────────────────────

  function updateMarka(i: number, field: 'lotNo' | 'than', value: string) {
    setMarkaEntries(prev => {
      const updated = [...prev]
      if (field === 'lotNo') {
        updated[i] = { ...updated[i], lotNo: formatLotNo(value), stockStatus: 'idle', stockInfo: null }
      } else {
        updated[i] = { ...updated[i], than: value }
      }
      return updated
    })
  }

  async function checkMarkaStock(i: number) {
    const lot = markaEntries[i]?.lotNo?.trim()
    if (!lot) return
    setMarkaEntries(prev => {
      const updated = [...prev]
      updated[i] = { ...updated[i], stockStatus: 'loading' }
      return updated
    })
    const res = await fetch(`/api/grey/stock?lotNo=${encodeURIComponent(lot)}`)
    const data = await res.json()
    setMarkaEntries(prev => {
      const updated = [...prev]
      if (!data.exists) updated[i] = { ...updated[i], stockStatus: 'not_found', stockInfo: null }
      else if (data.stock <= 0) updated[i] = { ...updated[i], stockStatus: 'no_stock', stockInfo: data }
      else updated[i] = { ...updated[i], stockStatus: 'ok', stockInfo: data }
      return updated
    })
  }

  function addMarkaEntry() {
    setMarkaEntries(prev => [...prev, { lotNo: '', than: '', stockStatus: 'idle', stockInfo: null }])
  }

  function removeMarkaEntry(i: number) {
    setMarkaEntries(prev => prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i))
  }

  const markaLotValid = (lot: string) => !lot || /^[A-Z]+-\d+$/i.test(lot)

  // ─── Chemical Row Editing ─────────────────────────────────────────────────

  function updateChemical(i: number, field: keyof ChemicalRow, value: string) {
    setChemicals(prev => {
      const updated = [...prev]
      updated[i] = { ...updated[i], [field]: value }

      // Re-run fuzzy match when name changes
      if (field === 'name') {
        const { chemicalId, rate, matchedName } = matchToMaster(value)
        updated[i].chemicalId = chemicalId
        updated[i].matched = chemicalId !== null
        if (chemicalId !== null && rate) updated[i].rate = rate
      }

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

    // Validate marka entries
    const validMarka = markaEntries.filter(m => m.lotNo.trim() && m.than.trim())
    if (validMarka.length === 0) { setError('At least one lot with than is required.'); return }
    const hasNotFound = validMarka.some(m => m.stockStatus === 'not_found')
    if (hasNotFound) { setError('One or more lots not found in Grey register.'); return }

    setSaving(true); setError('')

    const payload = {
      ...form,
      // Use first marka entry as primary for backward compat
      lotNo: validMarka[0].lotNo,
      than: validMarka[0].than,
      marka: validMarka.map(m => ({ lotNo: m.lotNo, than: parseFloat(m.than) || 0 })),
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

            <Field label="Notes">
              <input type="text" className={inp} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Any remarks from slip" />
            </Field>
          </div>

          {/* ── Marka Entries (Lot + Than) ── */}
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-gray-700">
                Marka — Lot Entries
                {markaEntries.length > 1 && <span className="ml-2 text-xs font-normal text-gray-400">{markaEntries.length} lots</span>}
              </h3>
              <button type="button" onClick={addMarkaEntry} className="text-xs text-purple-600 hover:text-purple-800 font-medium">
                + Add Lot
              </button>
            </div>

            <div className="space-y-2">
              {markaEntries.map((m, i) => (
                <div key={i} className="border border-gray-200 rounded-xl p-3 bg-gray-50">
                  <div className="flex items-start gap-2">
                    <div className="flex-1">
                      <label className="block text-[10px] text-gray-400 mb-0.5">Lot No *</label>
                      <input
                        type="text"
                        className={`${inp} ${m.lotNo && !markaLotValid(m.lotNo) ? 'border-red-400 ring-red-300' : ''}`}
                        value={m.lotNo}
                        onChange={e => updateMarka(i, 'lotNo', e.target.value)}
                        onBlur={() => checkMarkaStock(i)}
                        required
                        placeholder="e.g. PS-1325"
                        maxLength={20}
                      />
                    </div>
                    <div className="w-24">
                      <label className="block text-[10px] text-gray-400 mb-0.5">Than *</label>
                      <input
                        type="number"
                        className={inp}
                        value={m.than}
                        onChange={e => updateMarka(i, 'than', e.target.value)}
                        required
                        placeholder="Qty"
                      />
                    </div>
                    {markaEntries.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeMarkaEntry(i)}
                        className="text-red-400 hover:text-red-600 text-xl leading-none mt-5"
                      >&times;</button>
                    )}
                  </div>

                  {/* Lot validation + stock status */}
                  {m.lotNo && !markaLotValid(m.lotNo) && (
                    <p className="text-xs text-red-500 mt-1">Format: PREFIX-NUMBER (e.g. PS-1325)</p>
                  )}
                  {m.stockStatus === 'loading' && <p className="text-xs text-gray-400 mt-1">Checking stock...</p>}
                  {m.stockStatus === 'not_found' && <p className="text-xs text-red-500 mt-1">⚠ Lot not found in Grey register</p>}
                  {m.stockStatus === 'no_stock' && m.stockInfo && (
                    <p className="text-xs text-amber-600 mt-1">
                      ⚠ No stock — Grey: {m.stockInfo.greyThan}, Despatched: {m.stockInfo.despatchThan}, Balance: <strong>{m.stockInfo.stock}</strong>
                    </p>
                  )}
                  {m.stockStatus === 'ok' && m.stockInfo && (
                    <p className="text-xs text-green-600 mt-1">
                      ✓ Stock OK — Grey: {m.stockInfo.greyThan}, Despatched: {m.stockInfo.despatchThan}, Balance: <strong>{m.stockInfo.stock}</strong>
                    </p>
                  )}
                </div>
              ))}
            </div>
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
              + Add Chemical
            </button>
          </div>

          {chemicals.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-4">
              No chemicals added yet. Upload a slip image and click &quot;Extract with AI&quot;, or click &quot;+ Add Row&quot; to enter manually.
            </p>
          ) : (
            <div className="space-y-3">
              {chemicals.map((c, i) => (
                <div key={i} className="border border-gray-200 rounded-xl p-3 bg-gray-50">
                  {/* Chemical name row */}
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs text-gray-400 w-10 shrink-0">#{i + 1}</span>
                    <input
                      type="text"
                      className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white"
                      value={c.name}
                      onChange={e => updateChemical(i, 'name', e.target.value)}
                      placeholder="Chemical name"
                    />
                    {c.matched && (
                      <span className="text-green-600 text-xs font-semibold shrink-0 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded">✓ Master</span>
                    )}
                    {!c.matched && c.name && (
                      <span className="text-amber-600 text-xs font-semibold shrink-0 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">New</span>
                    )}
                    <button
                      type="button"
                      onClick={() => removeChemical(i)}
                      className="text-red-400 hover:text-red-600 text-xl leading-none shrink-0 w-6 text-center"
                    >&times;</button>
                  </div>

                  {/* Qty / Unit / Rate / Cost row */}
                  <div className="grid grid-cols-2 gap-2 pl-12">
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
                      <label className="block text-[10px] text-gray-400 mb-0.5">Rate (₹/{c.unit})</label>
                      <input
                        type="number" step="0.01"
                        className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white"
                        value={c.rate}
                        onChange={e => updateChemical(i, 'rate', e.target.value)}
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-400 mb-0.5">Cost (₹)</label>
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
                  <span className="text-lg font-bold text-purple-700">₹{totalCost.toFixed(2)}</span>
                </div>
              )}
            </div>
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
