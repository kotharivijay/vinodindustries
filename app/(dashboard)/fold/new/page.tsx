'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import * as XLSX from 'xlsx'

const fetcher = (url: string) => fetch(url).then(r => r.json())

function matchesSearch(l: LotStockItem, query: string): boolean {
  const tokens = query.toLowerCase().split(/[\s,]+/).filter(Boolean)
  if (tokens.length === 0) return true
  const fields = [l.lotNo, l.party, l.quality].map(s => (s ?? '').toLowerCase())
  return tokens.every(token => fields.some(field => field.includes(token)))
}

interface LotStockItem {
  lotNo: string
  party: string
  quality: string
  stock: number
  manuallyUsed: number
  foldAvailable: number
}

interface PartyStock {
  party: string
  partyTag?: string | null
  totalStock: number
  lots: LotStockItem[]
}

interface Shade {
  id: number
  name: string
  description?: string | null
}

interface LotRow {
  lotNo: string
  than: string
  partyId: number | null
  qualityId: number | null
  partyName: string
  qualityName: string
  maxStock: number
}

interface BatchRow {
  batchNo: number
  shadeId: number | null
  shadeName: string
  shadeDescription: string
  lots: LotRow[]
}

// ── Import types ──────────────────────────────────────────────────────────────

interface ParsedLot { lotNo: string; than: number }
interface ParsedBatch { batchNo: number; shade: string; lots: ParsedLot[] }

function parseImportSheet(file: File): Promise<ParsedBatch[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

        // Find header row containing "Sn"
        let hIdx = -1
        for (let i = 0; i < Math.min(rows.length, 20); i++) {
          if (rows[i].some((c: any) => String(c).trim() === 'Sn')) { hIdx = i; break }
        }
        if (hIdx === -1) { reject(new Error('Could not find "Sn" column in sheet')); return }

        const headers = rows[hIdx].map((h: any) => String(h ?? '').trim())
        const snIdx = headers.findIndex(h => h === 'Sn')
        const shadeIdx = headers.findIndex(h => h.toLowerCase().includes('shade nam'))
        const totalIdx = headers.findIndex(h => h.toLowerCase() === 'total')

        // Lot columns: between shade col and total col (exclusive), non-empty header
        const endCol = totalIdx > 0 ? totalIdx : headers.length
        const lotCols: { idx: number; lotNo: string }[] = []
        const afterShade = shadeIdx >= 0 ? shadeIdx + 1 : snIdx + 3
        for (let i = afterShade; i < endCol; i++) {
          if (headers[i]) lotCols.push({ idx: i, lotNo: headers[i] })
        }

        if (lotCols.length === 0) { reject(new Error('No lot columns found after the Shade Name column')); return }

        // Parse data rows — each Sn row = its own batch
        const batches: ParsedBatch[] = []
        let lastShade = ''
        for (let i = hIdx + 1; i < rows.length; i++) {
          const row = rows[i]
          const snVal = row[snIdx]
          if (snVal === '' || snVal === null || isNaN(Number(snVal))) break

          // Carry forward shade if cell is blank (merged cells in Excel)
          const shadeRaw = String(row[shadeIdx] ?? '').trim()
          if (shadeRaw) lastShade = shadeRaw
          const shade = lastShade

          const lots = lotCols
            .map(col => ({ lotNo: String(col.lotNo).trim(), than: Number(row[col.idx]) || 0 }))
            .filter(l => l.than > 0)

          // Always push a batch per Sn row (even if no lots — applyImport handles empty)
          batches.push({ batchNo: Number(snVal), shade, lots })
        }

        if (batches.length === 0) reject(new Error('No batch data found — check sheet format'))
        else resolve(batches)
      } catch (err: any) {
        reject(new Error(err.message ?? 'Failed to parse file'))
      }
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsArrayBuffer(file)
  })
}

// ── Import Preview Modal ──────────────────────────────────────────────────────

function ImportPreviewModal({ batches, lotLookup, onConfirm, onClose }: {
  batches: ParsedBatch[]
  lotLookup: Map<string, LotStockItem>
  onConfirm: (batches: ParsedBatch[]) => void
  onClose: () => void
}) {
  const totalThan = batches.reduce((s, b) => s + b.lots.reduce((ls, l) => ls + l.than, 0), 0)
  const allLotNos = batches.flatMap(b => b.lots.map(l => l.lotNo))
  const unknownLots = [...new Set(allLotNos.filter(ln => !lotLookup.has(ln.toLowerCase())))]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <div>
            <h2 className="text-base font-bold text-gray-800 dark:text-gray-100">Import Preview</h2>
            <p className="text-xs text-gray-500 mt-0.5">{batches.length} batches · {totalThan} total than</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl leading-none">×</button>
        </div>

        {/* Warning for unknown lots */}
        {unknownLots.length > 0 && (
          <div className="mx-5 mt-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            <span className="font-semibold">Lots not in stock master:</span> {unknownLots.join(', ')} — will be added as manual entries
          </div>
        )}

        {/* Batch list */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {batches.map(batch => (
            <div key={batch.batchNo} className="border border-gray-100 dark:border-gray-700 rounded-xl overflow-hidden">
              <div className="bg-indigo-50 dark:bg-indigo-900/30 px-4 py-2 flex items-center gap-3">
                <span className="text-sm font-bold text-indigo-700 dark:text-indigo-400">Batch {batch.batchNo}</span>
                {batch.shade && (
                  <span className="text-sm text-indigo-600 dark:text-indigo-300">{batch.shade}</span>
                )}
                <span className="ml-auto text-xs text-indigo-500">
                  {batch.lots.reduce((s, l) => s + l.than, 0)} than
                </span>
              </div>
              <div className="divide-y divide-gray-50 dark:divide-gray-800">
                {batch.lots.map((lot, i) => {
                  const info = lotLookup.get(lot.lotNo.toLowerCase())
                  return (
                    <div key={i} className="px-4 py-2 flex items-center justify-between text-sm">
                      <div>
                        <span className="font-medium text-gray-800 dark:text-gray-200">{lot.lotNo}</span>
                        {info && (
                          <span className="text-xs text-gray-400 ml-2">{info.party} · {info.quality}</span>
                        )}
                        {!info && (
                          <span className="text-xs text-amber-500 ml-2">not in stock</span>
                        )}
                      </div>
                      <span className="font-semibold text-indigo-600 dark:text-indigo-400">{lot.than} than</span>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-5 py-4 border-t border-gray-100 dark:border-gray-700">
          <button
            onClick={onClose}
            className="flex-1 py-2 text-sm border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(batches)}
            className="flex-1 py-2 text-sm bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 transition"
          >
            Fill Form
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function NewFoldPage() {
  const router = useRouter()
  const { data: stockData } = useSWR<{ parties: PartyStock[] }>('/api/stock', fetcher)
  const { data: shades, mutate: mutateShades } = useSWR<Shade[]>('/api/shades', fetcher)
  const { data: parties } = useSWR<{ id: number; name: string }[]>('/api/masters/parties', fetcher)
  const { data: qualities } = useSWR<{ id: number; name: string }[]>('/api/masters/qualities', fetcher)

  const [foldNo, setFoldNo] = useState('')
  const [existingFoldNos, setExistingFoldNos] = useState<Set<string>>(new Set())
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0])
  const [notes, setNotes] = useState('')
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [selectedParties, setSelectedParties] = useState<Set<string>>(new Set())
  const [partyDropOpen, setPartyDropOpen] = useState(false)
  const [partySearch, setPartySearch] = useState('')
  const partyDropRef = useRef<HTMLDivElement>(null)
  const [selectedQualities, setSelectedQualities] = useState<Set<string>>(new Set())
  const [qualityDropOpen, setQualityDropOpen] = useState(false)
  const [qualitySearch, setQualitySearch] = useState('')
  const qualityDropRef = useRef<HTMLDivElement>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [lotDropKey, setLotDropKey] = useState<string | null>(null)
  const [lotSearch, setLotSearch] = useState('')
  const [isMobile, setIsMobile] = useState(false)

  // Import state
  const importRef = useRef<HTMLInputElement>(null)
  const [importPreview, setImportPreview] = useState<ParsedBatch[] | null>(null)
  const [importError, setImportError] = useState('')

  // Refs for Than inputs — keyed by "batchIdx-lotIdx"
  const thanRefs = useRef<Map<string, HTMLInputElement>>(new Map())

  // Close party/quality dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (partyDropRef.current && !partyDropRef.current.contains(e.target as Node)) setPartyDropOpen(false)
      if (qualityDropRef.current && !qualityDropRef.current.contains(e.target as Node)) setQualityDropOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Auto-generate fold number
  useEffect(() => {
    fetch('/api/fold').then(r => r.json()).then((programs: any[]) => {
      if (!Array.isArray(programs)) return
      const nos = new Set(programs.map((p: any) => String(p.foldNo)))
      setExistingFoldNos(nos)
      // Find max numeric fold number and set next
      const nums = programs.map((p: any) => parseInt(p.foldNo)).filter(n => !isNaN(n))
      const maxNo = nums.length > 0 ? Math.max(...nums) : 0
      setFoldNo(String(maxNo + 1))
    }).catch(() => {})
  }, [])

  // Detect mobile viewport
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    setIsMobile(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Build lot lookup from stock
  const lotLookup = new Map<string, LotStockItem>()
  for (const p of stockData?.parties ?? []) {
    for (const l of p.lots) {
      if (l.lotNo) lotLookup.set(l.lotNo.toLowerCase(), l)
    }
  }

  const [batches, setBatches] = useState<BatchRow[]>([
    { batchNo: 1, shadeId: null, shadeName: '', shadeDescription: '', lots: [emptyLot()] },
  ])

  function emptyLot(): LotRow {
    return { lotNo: '', than: '', partyId: null, qualityId: null, partyName: '', qualityName: '', maxStock: 0 }
  }

  function addBatch() {
    setBatches(prev => [...prev, {
      batchNo: prev.length + 1,
      shadeId: null,
      shadeName: '',
      shadeDescription: '',
      lots: [emptyLot()],
    }])
  }

  function removeBatch(batchIdx: number) {
    setBatches(prev => prev.filter((_, i) => i !== batchIdx).map((b, i) => ({ ...b, batchNo: i + 1 })))
  }

  function addLot(batchIdx: number) {
    setBatches(prev => prev.map((b, i) =>
      i === batchIdx ? { ...b, lots: [...b.lots, emptyLot()] } : b
    ))
  }

  function removeLot(batchIdx: number, lotIdx: number) {
    setBatches(prev => prev.map((b, i) =>
      i === batchIdx ? { ...b, lots: b.lots.filter((_, j) => j !== lotIdx) } : b
    ))
  }

  function updateBatch(batchIdx: number, field: keyof BatchRow, value: any) {
    setBatches(prev => prev.map((b, i) =>
      i === batchIdx ? { ...b, [field]: value } : b
    ))
  }

  function updateLot(batchIdx: number, lotIdx: number, field: keyof LotRow, value: any) {
    setBatches(prev => prev.map((b, i) => {
      if (i !== batchIdx) return b
      const lots = b.lots.map((l, j) => {
        if (j !== lotIdx) return l
        const updated = { ...l, [field]: value }
        if (field === 'lotNo' && value) {
          const lotInfo = lotLookup.get((value as string).toLowerCase())
          if (lotInfo) {
            const party = Array.isArray(parties) ? parties.find(p => p.name === lotInfo.party) : undefined
            const quality = Array.isArray(qualities) ? qualities.find(q => q.name === lotInfo.quality) : undefined
            updated.partyId = party?.id ?? null
            updated.qualityId = quality?.id ?? null
            updated.partyName = lotInfo.party
            updated.qualityName = lotInfo.quality
            updated.maxStock = lotInfo.foldAvailable
            if (!updated.than) updated.than = String(lotInfo.foldAvailable)
          }
        }
        return updated
      })
      return { ...b, lots }
    }))
  }

  // Select a lot and focus Than input
  function selectLot(batchIdx: number, lotIdx: number, lotNo: string) {
    updateLot(batchIdx, lotIdx, 'lotNo', lotNo)
    setLotDropKey(null)
    setLotSearch('')
    setTimeout(() => {
      thanRefs.current.get(`${batchIdx}-${lotIdx}`)?.focus()
    }, 80)
  }

  // ── Import handlers ─────────────────────────────────────────────────────────

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setImportError('')
    try {
      const isImage = /\.(jpg|jpeg|png)$/i.test(file.name)
      if (isImage) {
        // Convert image to base64 and send to AI for extraction
        setImportError('Extracting data from image...')
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve((reader.result as string).split(',')[1])
          reader.onerror = () => reject(new Error('Failed to read image'))
          reader.readAsDataURL(file)
        })
        const mediaType = file.name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'
        const res = await fetch('/api/fold/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: base64, mediaType }),
        })
        if (!res.ok) throw new Error('AI extraction failed')
        const data = await res.json()
        if (data.batches?.length > 0) {
          setImportPreview(data.batches)
          setImportError('')
        } else {
          setImportError('No batch data found in image')
        }
      } else {
        // Excel/CSV parsing
        const parsed = await parseImportSheet(file)
        setImportPreview(parsed)
      }
    } catch (err: any) {
      setImportError(err.message ?? 'Failed to parse file')
    }
  }

  function applyImport(parsed: ParsedBatch[]) {
    const newBatches: BatchRow[] = parsed.map(pb => {
      const shadeMatch = (shades ?? []).find(s => s.name.toLowerCase() === pb.shade.toLowerCase())
      const lots: LotRow[] = pb.lots.map(pl => {
        const lotInfo = lotLookup.get(pl.lotNo.toLowerCase())
        const party = Array.isArray(parties) ? parties.find(p => p.name === lotInfo?.party) : undefined
        const quality = Array.isArray(qualities) ? qualities.find(q => q.name === lotInfo?.quality) : undefined
        return {
          lotNo: pl.lotNo,
          than: String(pl.than),
          partyId: party?.id ?? null,
          qualityId: quality?.id ?? null,
          partyName: lotInfo?.party ?? '',
          qualityName: lotInfo?.quality ?? '',
          maxStock: lotInfo?.foldAvailable ?? 0,
        }
      })
      return {
        batchNo: pb.batchNo,
        shadeId: shadeMatch?.id ?? null,
        shadeName: shadeMatch?.name ?? pb.shade,
        shadeDescription: '',
        lots,
      }
    })
    setBatches(newBatches)
    setImportPreview(null)
  }

  // ── Save ────────────────────────────────────────────────────────────────────

  async function save() {
    setError('')
    if (!foldNo.trim()) { setError('Fold No is required'); return }
    if (existingFoldNos.has(foldNo.trim())) { setError(`Fold No ${foldNo} already exists. Use a different number.`); return }
    if (!date) { setError('Date is required'); return }
    for (const b of batches) {
      for (const l of b.lots) {
        if (!l.lotNo.trim()) { setError(`Batch ${b.batchNo}: Lot No is required`); return }
        if (!l.than || parseInt(l.than) <= 0) { setError(`Batch ${b.batchNo}, Lot ${l.lotNo}: Than must be > 0`); return }
      }
    }
    setSaving(true)
    try {
      const res = await fetch('/api/fold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ foldNo, date, notes, batches }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to save'); return }
      router.push(`/fold/${data.id}`)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  // Lots filtered by party first (for quality computation)
  const partyFilteredLots = (stockData?.parties ?? [])
    .filter(p => selectedParties.size === 0 || selectedParties.has(p.party))
    .flatMap(p => p.lots)
    .filter(l => l.foldAvailable > 0)

  // Then filter by quality
  const allLots = partyFilteredLots
    .filter(l => selectedQualities.size === 0 || selectedQualities.has(l.quality))

  // Unique tags from stock data
  const uniqueFoldTags = useMemo(() => {
    const tags = new Set<string>()
    for (const p of stockData?.parties ?? []) {
      if (p.partyTag && p.lots.some(l => l.foldAvailable > 0)) tags.add(p.partyTag)
    }
    return Array.from(tags).sort()
  }, [stockData])

  // Get unique party names from stock data for selection (filtered by tag)
  const availableParties = (stockData?.parties ?? [])
    .filter(p => p.lots.some(l => l.foldAvailable > 0))
    .filter(p => !selectedTag || p.partyTag === selectedTag)
    .map(p => p.party)
    .sort()

  // Get unique qualities from party-filtered lots
  const availableQualities = [...new Set(partyFilteredLots.map(l => l.quality))].filter(q => q && q !== '-').sort()

  // Derive active batch/lot from lotDropKey for bottom sheet
  const activeKeys = lotDropKey ? lotDropKey.split('-').map(Number) : null
  const activeBatchIdx = activeKeys?.[0] ?? null
  const activeLotIdx = activeKeys?.[1] ?? null

  return (
    <div className="p-4 md:p-8 max-w-2xl">
      {/* Hidden file input — accepts Excel + images */}
      <input
        ref={importRef}
        type="file"
        accept=".xlsx,.xls,.csv,.jpg,.jpeg,.png"
        className="hidden"
        onChange={handleImportFile}
      />

      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg px-4 py-2 text-sm font-medium transition">
          &larr; Back
        </button>
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 flex-1">New Fold Program</h1>
        <button
          onClick={() => { setImportError(''); importRef.current?.click() }}
          className="flex items-center gap-1.5 text-sm bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-700 px-3 py-2 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition font-medium"
        >
          ↑ Import
        </button>
      </div>

      {error && <div className="mb-4 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-2 text-sm">{error}</div>}
      {importError && <div className="mb-4 text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg px-4 py-2 text-sm">{importError}</div>}

      {/* Header fields */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Fold No *</label>
            <input
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              placeholder="e.g. FP-001"
              value={foldNo}
              onChange={e => setFoldNo(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Date *</label>
            <input
              type="date"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              value={date}
              onChange={e => setDate(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
          <input
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            placeholder="Optional notes"
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
        </div>
      </div>

      {/* Party Filter — tag quick filter + multi-select dropdown */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4 mb-4">
        {/* Tag quick filter */}
        {uniqueFoldTags.length > 0 && (
          <div className="mb-3">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Quick Filter by Tag</label>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => { setSelectedTag(null); setSelectedParties(new Set()) }}
                className={`text-xs px-2.5 py-1.5 rounded-full border transition ${
                  selectedTag === null
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-600'
                }`}
              >
                All
              </button>
              {uniqueFoldTags.map(tag => (
                <button
                  key={tag}
                  onClick={() => {
                    setSelectedTag(selectedTag === tag ? null : tag)
                    setSelectedParties(new Set())
                  }}
                  className={`text-xs px-2.5 py-1.5 rounded-full border transition ${
                    selectedTag === tag
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-600'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        )}
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Filter by Party</label>
        <div className="relative" ref={partyDropRef}>
          <div
            className={`flex items-center gap-2 border rounded-lg px-3 py-2 bg-white dark:bg-gray-700 cursor-pointer min-h-[40px] flex-wrap ${partyDropOpen ? 'ring-2 ring-indigo-500 border-indigo-500' : 'border-gray-300 dark:border-gray-600'}`}
            onClick={() => { setPartyDropOpen(!partyDropOpen); setPartySearch('') }}
          >
            {selectedParties.size === 0 ? (
              <span className="text-sm text-gray-400">Select parties...</span>
            ) : (
              Array.from(selectedParties).map(party => (
                <span key={party} className="inline-flex items-center gap-1 bg-indigo-600 text-white text-xs font-medium px-2 py-0.5 rounded-full">
                  {party}
                  <button type="button" onClick={e => { e.stopPropagation(); setSelectedParties(prev => { const n = new Set(prev); n.delete(party); return n }) }}
                    className="text-indigo-200 hover:text-white text-sm leading-none">&times;</button>
                </span>
              ))
            )}
            {selectedParties.size > 0 && (
              <button type="button" onClick={e => { e.stopPropagation(); setSelectedParties(new Set()) }}
                className="text-xs text-red-400 hover:text-red-300 ml-auto shrink-0">Clear</button>
            )}
          </div>
          {partyDropOpen && (
            <div className="absolute left-0 right-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-xl z-30 max-h-60 flex flex-col">
              <input
                type="text" autoFocus
                className="w-full border-b border-gray-200 dark:border-gray-700 bg-transparent text-sm px-3 py-2 focus:outline-none dark:text-gray-100 dark:placeholder-gray-500"
                placeholder="Search party..."
                value={partySearch}
                onChange={e => setPartySearch(e.target.value)}
                onClick={e => e.stopPropagation()}
              />
              <div className="overflow-y-auto max-h-48">
                {availableParties
                  .filter(p => !partySearch || p.toLowerCase().includes(partySearch.toLowerCase()))
                  .map(party => {
                    const isSelected = selectedParties.has(party)
                    const partyLots = (stockData?.parties ?? []).find(p => p.party === party)?.lots.filter(l => l.foldAvailable > 0).length ?? 0
                    return (
                      <button key={party} type="button"
                        className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-indigo-50 dark:hover:bg-indigo-900/20 ${isSelected ? 'bg-indigo-50 dark:bg-indigo-900/20' : ''}`}
                        onClick={e => {
                          e.stopPropagation()
                          setSelectedParties(prev => {
                            const n = new Set(prev)
                            if (n.has(party)) n.delete(party); else n.add(party)
                            return n
                          })
                        }}>
                        <span className="flex items-center gap-2">
                          <span className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] ${isSelected ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-300 dark:border-gray-500'}`}>
                            {isSelected ? '✓' : ''}
                          </span>
                          <span className="text-gray-800 dark:text-gray-100">{party}</span>
                        </span>
                        <span className="text-xs text-gray-400">{partyLots} lots</span>
                      </button>
                    )
                  })}
              </div>
            </div>
          )}
        </div>
        {/* Quality multi-select dropdown */}
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2 mt-3">Filter by Quality</label>
        <div className="relative" ref={qualityDropRef}>
          <div
            className={`flex items-center gap-2 border rounded-lg px-3 py-2 bg-white dark:bg-gray-700 cursor-pointer min-h-[40px] flex-wrap ${qualityDropOpen ? 'ring-2 ring-purple-500 border-purple-500' : 'border-gray-300 dark:border-gray-600'}`}
            onClick={() => { setQualityDropOpen(!qualityDropOpen); setQualitySearch('') }}
          >
            {selectedQualities.size === 0 ? (
              <span className="text-sm text-gray-400">All qualities</span>
            ) : (
              Array.from(selectedQualities).map(q => (
                <span key={q} className="inline-flex items-center gap-1 bg-purple-600 text-white text-xs font-medium px-2 py-0.5 rounded-full">
                  {q}
                  <button type="button" onClick={e => { e.stopPropagation(); setSelectedQualities(prev => { const n = new Set(prev); n.delete(q); return n }) }}
                    className="text-purple-200 hover:text-white text-sm leading-none">&times;</button>
                </span>
              ))
            )}
            {selectedQualities.size > 0 && (
              <button type="button" onClick={e => { e.stopPropagation(); setSelectedQualities(new Set()) }}
                className="text-xs text-red-400 hover:text-red-300 ml-auto shrink-0">Clear</button>
            )}
          </div>
          {qualityDropOpen && (
            <div className="absolute left-0 right-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-xl z-30 max-h-60 flex flex-col">
              <input
                type="text" autoFocus
                className="w-full border-b border-gray-200 dark:border-gray-700 bg-transparent text-sm px-3 py-2 focus:outline-none dark:text-gray-100 dark:placeholder-gray-500"
                placeholder="Search quality..."
                value={qualitySearch}
                onChange={e => setQualitySearch(e.target.value)}
                onClick={e => e.stopPropagation()}
              />
              <div className="overflow-y-auto max-h-48">
                {availableQualities
                  .filter(q => !qualitySearch || q.toLowerCase().includes(qualitySearch.toLowerCase()))
                  .map(quality => {
                    const isSelected = selectedQualities.has(quality)
                    const qtyLots = partyFilteredLots.filter(l => l.quality === quality).length
                    return (
                      <button key={quality} type="button"
                        className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-purple-50 dark:hover:bg-purple-900/20 ${isSelected ? 'bg-purple-50 dark:bg-purple-900/20' : ''}`}
                        onClick={e => {
                          e.stopPropagation()
                          setSelectedQualities(prev => {
                            const n = new Set(prev)
                            if (n.has(quality)) n.delete(quality); else n.add(quality)
                            return n
                          })
                        }}>
                        <span className="flex items-center gap-2">
                          <span className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] ${isSelected ? 'bg-purple-600 border-purple-600 text-white' : 'border-gray-300 dark:border-gray-500'}`}>
                            {isSelected ? '✓' : ''}
                          </span>
                          <span className="text-gray-800 dark:text-gray-100">{quality}</span>
                        </span>
                        <span className="text-xs text-gray-400">{qtyLots} lots</span>
                      </button>
                    )
                  })}
              </div>
            </div>
          )}
        </div>

        {(selectedParties.size > 0 || selectedQualities.size > 0) && (
          <p className="text-[10px] text-gray-500 mt-2">
            {allLots.length} lot{allLots.length !== 1 ? 's' : ''} available
            {selectedParties.size > 0 ? ` from ${selectedParties.size} part${selectedParties.size !== 1 ? 'ies' : 'y'}` : ''}
            {selectedQualities.size > 0 ? ` · ${selectedQualities.size} qualit${selectedQualities.size !== 1 ? 'ies' : 'y'}` : ''}
          </p>
        )}
      </div>

      {/* Batches */}
      <div className="space-y-4 mb-4">
        {batches.map((batch, batchIdx) => (
          <div key={batchIdx} className="bg-white dark:bg-gray-800 rounded-xl border border-indigo-100 dark:border-gray-700 overflow-hidden">
            {/* Batch header */}
            <div className="bg-indigo-50 dark:bg-indigo-900/30 px-4 py-2 space-y-1.5">
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold text-indigo-700 dark:text-indigo-400 shrink-0">Batch {batch.batchNo}</span>
                <div className="flex-1">
                  <ShadeCombobox
                    shadeId={batch.shadeId}
                    shadeName={batch.shadeName}
                    shades={shades ?? []}
                    onChange={(id, name) => {
                      updateBatch(batchIdx, 'shadeId', id)
                      updateBatch(batchIdx, 'shadeName', name)
                      const shade = (shades ?? []).find(s => s.id === id)
                      if (shade?.description) updateBatch(batchIdx, 'shadeDescription', shade.description)
                    }}
                    onShadeAdded={shade => mutateShades(prev => [...(prev ?? []), shade].sort((a, b) => a.name.localeCompare(b.name)))}
                  />
                </div>
                {batches.length > 1 && (
                  <button onClick={() => removeBatch(batchIdx)} className="text-xs text-red-500 hover:text-red-700 shrink-0">
                    Remove
                  </button>
                )}
              </div>
              <input
                type="text"
                className="w-full border border-indigo-200 dark:border-indigo-700 rounded bg-white dark:bg-gray-700 px-2 py-1.5 text-sm text-gray-700 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                placeholder="Shade description..."
                value={batch.shadeDescription}
                onChange={e => updateBatch(batchIdx, 'shadeDescription', e.target.value)}
              />
            </div>

            {/* Lots */}
            <div className="p-3 space-y-2 bg-white dark:bg-gray-800">
              {batch.lots.map((lot, lotIdx) => {
                const dropKey = `${batchIdx}-${lotIdx}`
                const isOpen = lotDropKey === dropKey && !isMobile
                const usedElsewhere = new Map<string, number>()
                for (const [bi, b] of batches.entries()) {
                  for (const [li, l] of b.lots.entries()) {
                    if (bi === batchIdx && li === lotIdx) continue
                    if (!l.lotNo) continue
                    usedElsewhere.set(l.lotNo, (usedElsewhere.get(l.lotNo) ?? 0) + (parseInt(l.than) || 0))
                  }
                }
                const availableLots = allLots
                  .map(l => ({ ...l, foldAvailable: l.foldAvailable - (usedElsewhere.get(l.lotNo) ?? 0) }))
                  .filter(l => l.foldAvailable > 0)
                const filteredLots = availableLots.filter(l => matchesSearch(l, lotSearch))
                const stockInfo = lot.lotNo ? lotLookup.get(lot.lotNo.toLowerCase()) : undefined
                return (
                  <div key={lotIdx} className="flex gap-2 items-start">
                    <div className="flex-1 relative">
                      {/* Trigger */}
                      <div
                        className={`flex items-center gap-2 border rounded-lg px-3 py-2 bg-white dark:bg-gray-700 cursor-pointer text-sm ${(lotDropKey === dropKey) ? 'ring-2 ring-indigo-400 border-indigo-400' : 'border-gray-300 dark:border-gray-600'}`}
                        onClick={() => {
                          if (lotDropKey === dropKey) {
                            setLotDropKey(null)
                            setLotSearch('')
                          } else {
                            setLotDropKey(dropKey)
                            setLotSearch('')
                          }
                        }}
                      >
                        <span className={`flex-1 ${lot.lotNo ? 'text-gray-800 dark:text-gray-100 font-medium' : 'text-gray-400'}`}>
                          {lot.lotNo || 'Select lot...'}
                        </span>
                        <span className="text-gray-400 text-xs">▾</span>
                      </div>

                      {/* Stock info below trigger */}
                      {stockInfo && (
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          {stockInfo.party} · {stockInfo.quality} · Balance: {stockInfo.stock} · Avail: <span className="text-emerald-600 font-medium">{stockInfo.foldAvailable}</span>
                        </p>
                      )}

                      {/* Lot search dropdown — fixed on mobile to stay above keyboard */}
                      {isOpen && (
                        <>
                          {/* Mobile: fixed bottom sheet */}
                          <div className="sm:hidden fixed inset-0 bg-black/40 z-40" onClick={() => { setLotDropKey(null); setLotSearch('') }} />
                          <div className={`
                            sm:absolute sm:left-0 sm:right-0 sm:top-full sm:mt-1 sm:max-h-60 sm:z-20
                            fixed bottom-0 left-0 right-0 z-50 sm:relative sm:bottom-auto
                            bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-t-2xl sm:rounded-lg shadow-lg flex flex-col
                          `}>
                            <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-700">
                              <input
                                type="text"
                                autoFocus
                                className="flex-1 text-sm focus:outline-none bg-transparent text-gray-800 dark:text-gray-100 placeholder-gray-400"
                                placeholder="Search lot, party or quality..."
                                value={lotSearch}
                                onChange={e => setLotSearch(e.target.value)}
                                onClick={e => e.stopPropagation()}
                              />
                              <button
                                type="button"
                                onClick={e => { e.stopPropagation(); setLotDropKey(null); setLotSearch('') }}
                                className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 sm:hidden"
                              >
                                Close
                              </button>
                            </div>
                            <div className="overflow-y-auto max-h-[40vh] sm:max-h-48">
                              {filteredLots.map(l => (
                                <button
                                  key={l.lotNo}
                                  type="button"
                                  className={`w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 dark:hover:bg-indigo-900/20 flex items-center justify-between ${lot.lotNo === l.lotNo ? 'bg-indigo-50 dark:bg-indigo-900/30 font-medium' : ''}`}
                                  onClick={e => { e.stopPropagation(); selectLot(batchIdx, lotIdx, l.lotNo) }}
                                >
                                  <span className="font-medium text-gray-800 dark:text-gray-200">{l.lotNo}</span>
                                  <span className="text-xs text-gray-400">{l.party} · Avail: {l.foldAvailable}</span>
                                </button>
                              ))}
                              {filteredLots.length === 0 && !lotSearch && (
                                <p className="px-3 py-3 text-xs text-gray-400 text-center">No available lots</p>
                              )}
                              {filteredLots.length === 0 && lotSearch && (
                                <button
                                  type="button"
                                  className="w-full text-left px-3 py-2 text-sm hover:bg-amber-50 dark:hover:bg-amber-900/20 text-amber-700 dark:text-amber-400 flex items-center gap-1"
                                  onClick={e => { e.stopPropagation(); selectLot(batchIdx, lotIdx, lotSearch.trim()) }}
                                >
                                  + Use &quot;{lotSearch.trim()}&quot; manually
                                </button>
                              )}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                    <input
                      type="number"
                      ref={el => {
                        if (el) thanRefs.current.set(dropKey, el)
                        else thanRefs.current.delete(dropKey)
                      }}
                      className="w-20 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
                      placeholder="Than"
                      value={lot.than}
                      onChange={e => updateLot(batchIdx, lotIdx, 'than', e.target.value)}
                    />
                    {batch.lots.length > 1 && (
                      <button onClick={() => removeLot(batchIdx, lotIdx)} className="text-gray-400 hover:text-red-500 text-sm pt-1.5">✕</button>
                    )}
                  </div>
                )
              })}
              <button
                onClick={() => addLot(batchIdx)}
                className="text-xs text-indigo-600 hover:text-indigo-800 mt-1"
              >
                + Add Lot
              </button>
            </div>

            {/* Batch total */}
            <div className="bg-gray-50 dark:bg-gray-700/50 px-4 py-1.5 text-right">
              <span className="text-xs text-gray-500 dark:text-gray-400">Batch total: </span>
              <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400">
                {batch.lots.reduce((s, l) => s + (parseInt(l.than) || 0), 0)} than
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-3 items-center mb-6">
        <button
          onClick={addBatch}
          className="text-sm bg-indigo-50 text-indigo-700 border border-indigo-200 px-4 py-2 rounded-lg hover:bg-indigo-100"
        >
          + Add Batch
        </button>
        <div className="flex-1 text-right">
          <span className="text-sm text-gray-500">Total: </span>
          <span className="text-lg font-bold text-indigo-700">
            {batches.reduce((s, b) => s + b.lots.reduce((ls, l) => ls + (parseInt(l.than) || 0), 0), 0)} than
          </span>
          <span className="text-xs text-gray-400 ml-1">across {batches.length} batch{batches.length !== 1 ? 'es' : ''}</span>
        </div>
      </div>

      <button
        onClick={save}
        disabled={saving}
        className="w-full bg-indigo-600 text-white py-3 rounded-xl font-semibold hover:bg-indigo-700 disabled:opacity-50 transition"
      >
        {saving ? 'Saving...' : 'Save Fold Program'}
      </button>

      {/* Mobile bottom sheet */}
      {isMobile && lotDropKey !== null && activeBatchIdx !== null && activeLotIdx !== null && (() => {
        const usedElsewhereSheet = new Map<string, number>()
        for (const [bi, b] of batches.entries()) {
          for (const [li, l] of b.lots.entries()) {
            if (bi === activeBatchIdx && li === activeLotIdx) continue
            if (!l.lotNo) continue
            usedElsewhereSheet.set(l.lotNo, (usedElsewhereSheet.get(l.lotNo) ?? 0) + (parseInt(l.than) || 0))
          }
        }
        const sheetLots = allLots
          .map(l => ({ ...l, foldAvailable: l.foldAvailable - (usedElsewhereSheet.get(l.lotNo) ?? 0) }))
          .filter(l => l.foldAvailable > 0)
        return (
          <LotBottomSheet
            availableLots={sheetLots}
            currentLotNo={batches[activeBatchIdx]?.lots[activeLotIdx]?.lotNo ?? ''}
            onSelect={lotNo => selectLot(activeBatchIdx, activeLotIdx, lotNo)}
            onClose={() => { setLotDropKey(null); setLotSearch('') }}
          />
        )
      })()}

      {/* Import preview modal */}
      {importPreview && (
        <ImportPreviewModal
          batches={importPreview}
          lotLookup={lotLookup}
          onConfirm={applyImport}
          onClose={() => setImportPreview(null)}
        />
      )}
    </div>
  )
}

// ── Mobile Bottom Sheet ────────────────────────────────────────────────────────

function LotBottomSheet({ availableLots, currentLotNo, onSelect, onClose }: {
  availableLots: LotStockItem[]
  currentLotNo: string
  onSelect: (lotNo: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const filtered = availableLots.filter(l => matchesSearch(l, query))

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative bg-white dark:bg-gray-900 rounded-t-2xl flex flex-col"
        style={{ maxHeight: '90vh' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-gray-300 dark:bg-gray-600 rounded-full" />
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100">Select Lot</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 text-lg">✕</button>
        </div>
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          <input
            autoFocus
            type="text"
            className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-3 text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            placeholder="Search lot, party or quality..."
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
        <div className="overflow-y-auto overscroll-contain flex-1">
          {filtered.map(l => (
            <button
              key={l.lotNo}
              type="button"
              className={`w-full text-left px-4 py-4 flex items-center justify-between border-b border-gray-50 dark:border-gray-800 active:bg-indigo-50 dark:active:bg-indigo-900/20 ${l.lotNo === currentLotNo ? 'bg-indigo-50 dark:bg-indigo-900/30' : ''}`}
              onClick={() => { onSelect(l.lotNo); onClose() }}
            >
              <div>
                <p className="font-semibold text-gray-800 dark:text-gray-100 text-base">{l.lotNo}</p>
                <p className="text-xs text-gray-400 mt-0.5">{l.party} · {l.quality}</p>
              </div>
              <div className="text-right shrink-0 ml-3">
                <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{l.foldAvailable} avail</p>
                <p className="text-xs text-gray-400">Balance: {l.stock}</p>
              </div>
            </button>
          ))}
          {filtered.length === 0 && !query && (
            <div className="px-4 py-8 text-center text-gray-400 text-sm">No available lots</div>
          )}
          {filtered.length === 0 && query.trim() && (
            <button
              type="button"
              className="w-full text-left px-4 py-4 text-amber-700 dark:text-amber-400 font-semibold border-b border-gray-50 dark:border-gray-800 active:bg-amber-50 dark:active:bg-amber-900/20"
              onClick={() => { onSelect(query.trim()); onClose() }}
            >
              + Use &quot;{query.trim()}&quot; manually
            </button>
          )}
          <div className="h-6" />
        </div>
      </div>
    </div>
  )
}

// ── Shade Combobox ────────────────────────────────────────────────────────────

function ShadeCombobox({ shadeId, shadeName, shades, onChange, onShadeAdded }: {
  shadeId: number | null
  shadeName: string
  shades: Shade[]
  onChange: (id: number | null, name: string) => void
  onShadeAdded: (shade: Shade) => void
}) {
  const [query, setQuery] = useState(shadeName)
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => { setQuery(shadeName) }, [shadeName])

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  const filtered = shades.filter(s => s.name.toLowerCase().includes(query.toLowerCase().trim()))
  const exactMatch = shades.some(s => s.name.toLowerCase() === query.toLowerCase().trim())
  const showAdd = query.trim().length > 0 && !exactMatch

  async function addShade() {
    setAdding(true)
    try {
      const res = await fetch('/api/shades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: query.trim() }),
      })
      const data = await res.json()
      if (res.ok) {
        onShadeAdded(data)
        onChange(data.id, data.name)
        setQuery(data.name)
        setOpen(false)
      }
    } finally {
      setAdding(false)
    }
  }

  function select(id: number, name: string) {
    onChange(id, name)
    setQuery(name)
    setOpen(false)
  }

  function clear() {
    onChange(null, '')
    setQuery('')
    setOpen(true)
  }

  return (
    <div ref={ref} className="relative w-full max-w-[220px]">
      <div className="flex items-center border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 focus-within:ring-2 focus-within:ring-indigo-400">
        <input
          className="flex-1 px-2 py-1 text-sm bg-transparent text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none"
          placeholder="Search or add shade..."
          value={query}
          onChange={e => {
            setQuery(e.target.value)
            setOpen(true)
            if (shadeId) onChange(null, e.target.value)
          }}
          onFocus={() => setOpen(true)}
        />
        {(shadeId || query) && (
          <button onClick={clear} className="px-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xs" tabIndex={-1}>✕</button>
        )}
      </div>
      {open && (filtered.length > 0 || showAdd) && (
        <div className="absolute z-20 left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {filtered.map(s => (
            <button
              key={s.id}
              onMouseDown={e => { e.preventDefault(); select(s.id, s.name) }}
              className={`w-full text-left px-3 py-2 text-sm transition ${s.id === shadeId ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 font-medium' : 'text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
            >
              {s.name}
              {s.description && <span className="text-xs text-gray-400 dark:text-gray-500 ml-1">— {s.description}</span>}
            </button>
          ))}
          {showAdd && (
            <button
              onMouseDown={e => { e.preventDefault(); addShade() }}
              disabled={adding}
              className="w-full text-left px-3 py-2 text-sm text-indigo-600 dark:text-indigo-400 font-semibold hover:bg-indigo-50 dark:hover:bg-indigo-900/20 border-t border-gray-100 dark:border-gray-700 disabled:opacity-50"
            >
              {adding ? 'Adding...' : `+ Add "${query.trim()}"`}
            </button>
          )}
        </div>
      )}
      {shadeId && (
        <p className="text-[10px] text-indigo-500 dark:text-indigo-400 mt-0.5 pl-0.5">✓ Saved shade</p>
      )}
    </div>
  )
}
