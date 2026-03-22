'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
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

// Image Zoom Modal
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
        alt="Finish slip"
        className="max-w-full max-h-full object-contain rounded-lg"
        onClick={e => e.stopPropagation()}
        style={{ touchAction: 'pinch-zoom' }}
      />
    </div>
  )
}

export default function FinishForm() {
  const router = useRouter()

  // Image state
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [imageBase64, setImageBase64] = useState<string | null>(null)
  const [imageType, setImageType] = useState<string>('image/jpeg')
  const [showZoom, setShowZoom] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)

  // Voice note state
  const [voiceText, setVoiceText] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [speechSupported, setSpeechSupported] = useState(false)
  const recognitionRef = useRef<any>(null)

  // Extraction state
  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState('')
  const [extracted, setExtracted] = useState(false)
  const [ocrNames, setOcrNames] = useState<string[]>([])

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

  // Check speech recognition support
  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    setSpeechSupported(!!SR)
  }, [])

  const set = (field: string, value: string) => setForm(prev => ({ ...prev, [field]: value }))

  // ── Image Handling ──────────────────────────────────────────────────────────

  function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return
    const file = files[0]
    e.target.value = '' // reset input

    const type = file.type || 'image/jpeg'
    const reader = new FileReader()
    reader.onload = ev => {
      const result = ev.target?.result as string
      setImagePreview(result)
      setImageBase64(result.split(',')[1])
      setImageType(type)
      setExtracted(false)
      setExtractError('')
    }
    reader.readAsDataURL(file)
  }

  // ── Voice Note ──────────────────────────────────────────────────────────────

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
    recognition.continuous = false
    recognition.interimResults = false

    recognition.onresult = (e: any) => {
      const transcript = e.results[0]?.[0]?.transcript?.trim()
      if (!transcript) return

      setVoiceText(prev => {
        if (!prev) return transcript
        // Deduplicate: check if last few words of prev overlap with start of new text
        const prevWords = prev.trim().split(/\s+/)
        const newWords = transcript.split(/\s+/)
        for (let overlap = Math.min(3, prevWords.length, newWords.length); overlap > 0; overlap--) {
          const tail = prevWords.slice(-overlap).join(' ').toLowerCase()
          const head = newWords.slice(0, overlap).join(' ').toLowerCase()
          if (tail === head) {
            return prev.trimEnd() + ' ' + newWords.slice(overlap).join(' ')
          }
        }
        return prev.trimEnd() + ' ' + transcript
      })
    }
    recognition.onend = () => {
      if (recognitionRef.current?._active) {
        try { recognition.start() } catch { setIsRecording(false) }
      } else {
        setIsRecording(false)
      }
    }
    recognition.onerror = (e: any) => {
      if (e.error !== 'aborted' && e.error !== 'no-speech') {
        recognitionRef.current._active = false
        setIsRecording(false)
      }
    }

    recognition._active = true
    recognitionRef.current = recognition
    recognition.start()
    setIsRecording(true)
  }

  // ── OCR / AI Extraction ────────────────────────────────────────────────────

  function matchToMaster(name: string): { chemicalId: number | null; rate: string; matchedName: string } {
    if (!name.trim() || masterChemicals.length === 0) return { chemicalId: null, rate: '', matchedName: '' }
    const norm = (s: string) => s.toLowerCase().trim()
    const exact = masterChemicals.find(c => norm(c.name) === norm(name))
    if (exact) return { chemicalId: exact.id, rate: exact.currentPrice?.toString() ?? '', matchedName: exact.name }
    return { chemicalId: null, rate: '', matchedName: '' }
  }

  function formatLotNo(raw: string): string {
    let val = raw.toUpperCase().replace(/\s/g, '')
    val = val.replace(/^([A-Z]+)(\d+)$/, '$1-$2')
    return val
  }

  async function handleExtract() {
    if (!imageBase64) return
    setExtracting(true); setExtractError('')

    const res = await fetch('/api/finish/extract', {
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
      notes: data.notes ?? prev.notes,
    }))

    // Fill mandi
    if (data.mandi != null) {
      setMandi(String(data.mandi))
    }

    // Populate marka entries from AI response
    if (data.marka?.length) {
      const entries: MarkaEntry[] = data.marka.map((m: any) => ({
        lotNo: formatLotNo(m.lotNo || ''),
        than: m.than?.toString() ?? '',
        meter: m.meter?.toString() ?? '',
        stockStatus: 'idle' as StockStatus,
        stockInfo: null,
      }))
      setMarkaEntries(entries)
      // Check stock for each marka lot
      entries.forEach((_: any, idx: number) => {
        if (data.marka[idx].lotNo) {
          setTimeout(() => handleLotBlur(formatLotNo(data.marka[idx].lotNo), idx), idx * 200)
        }
      })
    } else if (data.lotNo) {
      setMarkaEntries([{ lotNo: formatLotNo(data.lotNo), than: data.than?.toString() ?? '', meter: '', stockStatus: 'idle', stockInfo: null }])
      handleLotBlur(formatLotNo(data.lotNo), 0)
    }

    // Save original OCR names for alias learning
    if (data.ocrNames?.length) setOcrNames(data.ocrNames)

    // Build chemical rows -- use alias matches from server, then try local exact match
    if (data.chemicals?.length) {
      const rows: ChemicalRow[] = data.chemicals.map((c: any) => {
        let chemicalId = c._matchedId ?? null
        let rate = c._matchedRate != null ? String(c._matchedRate) : ''
        let displayName = c.name

        if (!chemicalId) {
          const local = matchToMaster(c.name)
          chemicalId = local.chemicalId
          rate = local.rate
          displayName = local.matchedName || c.name
        }

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

    if (data.confidence === 'low') {
      setExtractError('Low confidence -- image may be unclear. Please verify all fields.')
    }
  }

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
      ocrNames,
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
      {showZoom && imagePreview && <ZoomModal src={imagePreview} onClose={() => setShowZoom(false)} />}

      {/* Hidden file inputs */}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleImageSelect} />
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />

      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 rounded-lg px-4 py-2 text-sm font-medium transition">&larr; Back</button>
        <h1 className="text-xl font-bold text-gray-800">New Finish Slip</h1>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">{error}</div>}

      {/* Section 1: Image + AI */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Step 1 &mdash; Upload Slip Image (optional)</h2>

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
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => cameraRef.current?.click()}
                className="h-36 w-20 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center gap-1 text-gray-400 hover:border-teal-400 hover:text-teal-500 transition"
              >
                <span className="text-2xl">&#128247;</span>
                <span className="text-[10px] text-center leading-tight">Camera</span>
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="h-36 w-20 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center gap-1 text-gray-400 hover:border-teal-400 hover:text-teal-500 transition"
              >
                <span className="text-2xl">&#128444;</span>
                <span className="text-[10px] text-center leading-tight">Gallery</span>
              </button>
            </div>
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
                    ? 'bg-teal-100 text-teal-700 hover:bg-teal-200'
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                }`}
              >
                <span>{isRecording ? '&#9209; Stop' : '&#127908; Voice Note'}</span>
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
            {imageBase64 && (
              <button
                type="button"
                onClick={handleExtract}
                disabled={extracting}
                className={`px-4 py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 w-full ${
                  extracted
                    ? 'bg-green-100 text-green-700 hover:bg-green-200 border border-green-300'
                    : 'bg-teal-600 text-white hover:bg-teal-700'
                } disabled:opacity-60`}
              >
                {extracting ? (
                  <><span className="animate-spin">&#10227;</span> Extracting...</>
                ) : extracted ? (
                  '&#8635; Re-extract with AI'
                ) : (
                  'Extract with AI'
                )}
              </button>
            )}

            {!imageBase64 && (
              <p className="text-xs text-gray-400 text-center">Upload an image, then tap &quot;Extract with AI&quot;</p>
            )}
          </div>
        </div>

        {extractError && (
          <div className="mt-3 bg-amber-50 border border-amber-200 text-amber-700 rounded-lg px-3 py-2 text-xs">
            {extractError}
          </div>
        )}
      </div>

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
