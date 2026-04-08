'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useRouter, useParams } from 'next/navigation'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json())

// ── Searchable Lot Picker ────────────────────────────────────────────────
interface StockLot { lotNo: string; party: string; quality: string; stock: number; foldAvailable: number }

function LotPicker({ currentLotNo, currentThan, lotId, stockLots, onSave }: {
  currentLotNo: string; currentThan: number; lotId: number
  stockLots: StockLot[]
  onSave: (lotId: number, lotNo: string, than: number) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) {
      document.addEventListener('mousedown', handler)
      document.addEventListener('touchstart', handler as EventListener)
    }
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('touchstart', handler as EventListener)
    }
  }, [open])

  const filtered = useMemo(() => {
    if (!search) return stockLots.filter(l => l.foldAvailable > 0).slice(0, 50)
    const q = search.toLowerCase()
    return stockLots.filter(l => l.foldAvailable > 0 && (
      l.lotNo.toLowerCase().includes(q) ||
      l.party.toLowerCase().includes(q) ||
      l.quality.toLowerCase().includes(q)
    )).slice(0, 50)
  }, [stockLots, search])

  async function selectLot(lot: StockLot) {
    setSaving(true)
    await onSave(lotId, lot.lotNo, lot.foldAvailable)
    setSaving(false)
    setOpen(false)
    setSearch('')
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => { setOpen(!open); setSearch('') }}
        disabled={saving}
        className="font-medium text-indigo-700 dark:text-indigo-400 hover:underline cursor-pointer disabled:opacity-50"
      >
        {saving ? '...' : currentLotNo} <span className="text-[10px] text-gray-400">✏️</span>
      </button>
      {open && (
        <>
          <div className="sm:hidden fixed inset-0 bg-black/40 z-40" onClick={() => setOpen(false)} />
          <div className="fixed bottom-0 left-0 right-0 z-50 sm:absolute sm:bottom-auto sm:top-full sm:mt-1 sm:left-0 sm:right-auto sm:w-80 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-t-2xl sm:rounded-lg shadow-xl flex flex-col max-h-[50vh] sm:max-h-60">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-700">
              <input
                type="text" autoFocus
                className="flex-1 text-sm bg-transparent focus:outline-none text-gray-800 dark:text-gray-100 placeholder-gray-400"
                placeholder="Search lot, party, quality..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              <button onClick={() => setOpen(false)} className="text-xs text-gray-400 sm:hidden">Close</button>
            </div>
            <div className="overflow-y-auto flex-1">
              {filtered.map(l => (
                <button
                  key={l.lotNo}
                  onClick={() => selectLot(l)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 dark:hover:bg-indigo-900/20 flex items-center justify-between"
                >
                  <div>
                    <span className="font-medium text-gray-800 dark:text-gray-200">{l.lotNo}</span>
                    <span className="text-[10px] text-gray-400 ml-2">{l.party} · {l.quality}</span>
                  </div>
                  <span className="text-xs text-green-600 dark:text-green-400 font-semibold">{l.foldAvailable}T</span>
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="px-3 py-4 text-xs text-gray-400 text-center">No lots found</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

interface ShadeOption { id: number; name: string; description?: string | null }

interface FoldBatchLot {
  id: number
  lotNo: string
  than: number
  party?: { name: string }
  quality?: { name: string }
}

interface FoldBatch {
  id: number
  batchNo: number
  shadeName?: string
  shade?: { id: number; name: string }
  lots: FoldBatchLot[]
}

interface FoldProgram {
  id: number
  foldNo: string
  date: string
  status: 'draft' | 'confirmed'
  notes?: string
  batches: FoldBatch[]
}

// ── Inline shade picker ────────────────────────────────────────────────────
function ShadePicker({
  batch,
  shades,
  onSave,
}: {
  batch: FoldBatch
  shades: ShadeOption[]
  onSave: (batchId: number, shadeId: number | null, shadeName: string | null, shadeDescription: string | null) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const current = batch.shade?.name ?? batch.shadeName
  const filtered = shades.filter(s => !search || s.name.toLowerCase().includes(search.toLowerCase()))

  async function select(shade: ShadeOption | null) {
    setSaving(true)
    await onSave(batch.id, shade?.id ?? null, shade ? null : null, shade?.description ?? null)
    setSaving(false)
    setOpen(false)
    setSearch('')
  }

  async function useCustom() {
    if (!search.trim()) return
    setSaving(true)
    await onSave(batch.id, null, search.trim(), null)
    setSaving(false)
    setOpen(false)
    setSearch('')
  }

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => { setOpen(o => !o); setSearch('') }}
        className={`ml-2 text-xs px-2 py-0.5 rounded-full border transition flex items-center gap-1 ${
          saving ? 'opacity-50' : 'hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300'
        } ${current
          ? 'bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300'
          : 'bg-indigo-50 dark:bg-indigo-900/30 border-dashed border-indigo-300 dark:border-indigo-600 text-indigo-500 dark:text-indigo-400'
        }`}
        disabled={saving}
      >
        {saving ? '...' : (current ?? '+ shade')}
        <span className="text-gray-400 dark:text-gray-500 text-[10px]">✏️</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-30 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-2xl w-56 flex flex-col">
          <input
            autoFocus
            type="text"
            placeholder="Search shade..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full px-3 py-2 text-sm border-b border-gray-100 dark:border-gray-700 bg-transparent text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none rounded-t-xl"
          />
          <div className="overflow-y-auto max-h-52">
            {current && (
              <button
                type="button"
                onClick={() => select(null)}
                className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 border-b border-gray-100 dark:border-gray-700"
              >
                ✕ Remove shade
              </button>
            )}
            {filtered.map(s => (
              <button
                key={s.id}
                type="button"
                onClick={() => select(s)}
                className={`w-full text-left px-3 py-2 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 ${
                  batch.shade?.id === s.id ? 'bg-indigo-50 dark:bg-indigo-900/30' : ''
                }`}
              >
                <span className={`block text-sm font-medium ${batch.shade?.id === s.id ? 'text-indigo-700 dark:text-indigo-300' : 'text-gray-800 dark:text-gray-200'}`}>
                  {s.name}
                </span>
                {s.description && (
                  <span className="block text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 leading-tight">{s.description}</span>
                )}
              </button>
            ))}
            {filtered.length === 0 && !search && (
              <p className="px-3 py-2 text-xs text-gray-400">No shades in master</p>
            )}
            {search.trim() && !shades.some(s => s.name.toLowerCase() === search.toLowerCase()) && (
              <button
                type="button"
                onClick={useCustom}
                className="w-full text-left px-3 py-2 text-sm text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 border-t border-gray-100 dark:border-gray-700"
              >
                + Use &quot;{search.trim()}&quot; as custom
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function FoldDetailPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string
  const { data: program, isLoading, mutate } = useSWR<FoldProgram>(`/api/fold/${id}`, fetcher)
  const { data: shades = [] } = useSWR<ShadeOption[]>('/api/shades', fetcher)
  const [confirming, setConfirming] = useState(false)

  // Fetch stock data for lot picker
  const { data: stockData } = useSWR<{ parties: { party: string; lots: StockLot[] }[] }>('/api/stock', fetcher)
  const allStockLots = useMemo<StockLot[]>(() => {
    if (!stockData?.parties) return []
    return stockData.parties.flatMap(p => p.lots)
  }, [stockData])

  async function updateLot(lotId: number, lotNo: string, than: number) {
    await fetch('/api/fold/batch', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update-lot', lotId, lotNo, than }),
    })
    mutate()
  }

  async function updateBatchShade(batchId: number, shadeId: number | null, shadeName: string | null, shadeDescription: string | null) {
    await fetch('/api/fold/batch', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batchId, shadeId, shadeName, shadeDescription }),
    })
    mutate()
  }

  async function confirmProgram() {
    setConfirming(true)
    await fetch(`/api/fold/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'confirmed' }),
    })
    mutate()
    setConfirming(false)
  }

  async function printProgram() {
    if (!program) return
    const { default: jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    const doc = new jsPDF({ orientation: 'portrait' })

    doc.setFontSize(16)
    doc.text(`Fold Program: ${program.foldNo}`, 14, 15)
    doc.setFontSize(10)
    doc.text(`Date: ${new Date(program.date).toLocaleDateString('en-IN')}   Status: ${program.status}`, 14, 22)
    if (program.notes) doc.text(`Notes: ${program.notes}`, 14, 28)

    let y = program.notes ? 34 : 28

    for (const batch of program.batches) {
      const shade = batch.shade?.name ?? batch.shadeName ?? '-'
      doc.setFontSize(11)
      doc.setFont('helvetica', 'bold')
      doc.text(`Batch ${batch.batchNo} — Shade: ${shade}`, 14, y)
      doc.setFont('helvetica', 'normal')
      y += 2

      autoTable(doc, {
        head: [['Lot No', 'Party', 'Quality', 'Than']],
        body: [
          ...batch.lots.map(l => [l.lotNo, l.party?.name ?? '-', l.quality?.name ?? '-', l.than]),
          ['', '', 'Batch Total', batch.lots.reduce((s, l) => s + l.than, 0)],
        ],
        startY: y,
        styles: { fontSize: 9 },
        headStyles: { fillColor: [79, 70, 229] },
        columnStyles: { 3: { fontStyle: 'bold' } },
        margin: { left: 14, right: 14 },
      })
      y = (doc as any).lastAutoTable.finalY + 8
    }

    const totalThan = program.batches.reduce((s, b) => s + b.lots.reduce((ls, l) => ls + l.than, 0), 0)
    doc.setFont('helvetica', 'bold')
    doc.text(`Grand Total: ${totalThan} than`, 14, y)

    // Open print dialog
    const blob = doc.output('blob')
    const url = URL.createObjectURL(blob)
    const win = window.open(url)
    win?.print()
  }

  if (isLoading) return <div className="p-8 text-gray-400 dark:text-gray-500">Loading...</div>
  if (!program) return <div className="p-8 text-red-500">Not found</div>

  const totalThan = program.batches.reduce((s, b) => s + b.lots.reduce((ls, l) => ls + l.than, 0), 0)

  return (
    <div className="p-4 md:p-8 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg px-4 py-2 text-sm font-medium transition">
          &larr; Back
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">{program.foldNo}</h1>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              program.status === 'confirmed' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400'
            }`}>
              {program.status}
            </span>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {new Date(program.date).toLocaleDateString('en-IN')} &middot; {program.batches.length} batch{program.batches.length !== 1 ? 'es' : ''} &middot; {totalThan} than
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => router.push(`/fold/${id}/edit`)} className="bg-indigo-600 text-white px-3 py-2 rounded-lg text-xs font-medium hover:bg-indigo-700">Edit</button>
          <button onClick={() => router.push(`/dyeing/batch?foldId=${id}`)} className="bg-purple-600 text-white px-3 py-2 rounded-lg text-xs font-medium hover:bg-purple-700">🎨 Dyeing(Batch)</button>
          <button onClick={printProgram} className="bg-gray-700 text-white px-3 py-2 rounded-lg text-xs font-medium hover:bg-gray-800">🖨 Print</button>
        </div>
      </div>

      {program.notes && (
        <div className="mb-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg px-4 py-2 text-sm text-gray-700 dark:text-yellow-300">
          {program.notes}
        </div>
      )}

      {/* Batches */}
      <div className="space-y-4">
        {program.batches.map(batch => {
          const batchTotal = batch.lots.reduce((s, l) => s + l.than, 0)
          return (
            <div key={batch.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="bg-indigo-50 dark:bg-indigo-900/30 px-4 py-2 flex items-center justify-between">
                <div className="flex items-center">
                  <span className="font-bold text-indigo-700 dark:text-indigo-400 text-sm">Batch {batch.batchNo}</span>
                  <ShadePicker batch={batch} shades={shades} onSave={updateBatchShade} />
                </div>
                <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400">{batchTotal} than</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
                    <th className="text-left px-4 py-2">Lot No</th>
                    <th className="text-left px-4 py-2">Party</th>
                    <th className="text-left px-4 py-2">Quality</th>
                    <th className="text-right px-4 py-2">Than</th>
                  </tr>
                </thead>
                <tbody>
                  {batch.lots.map(lot => (
                    <tr key={lot.id} className="border-b border-gray-50 dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-4 py-2">
                        <LotPicker
                          currentLotNo={lot.lotNo}
                          currentThan={lot.than}
                          lotId={lot.id}
                          stockLots={allStockLots}
                          onSave={updateLot}
                        />
                      </td>
                      <td className="px-4 py-2 text-gray-600 dark:text-gray-300">{lot.party?.name ?? '-'}</td>
                      <td className="px-4 py-2 text-gray-600 dark:text-gray-300">{lot.quality?.name ?? '-'}</td>
                      <td className="px-4 py-2 text-right font-bold text-gray-800 dark:text-gray-100">{lot.than}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-indigo-50 dark:bg-indigo-900/20">
                    <td colSpan={3} className="px-4 py-2 text-xs font-semibold text-right text-gray-600 dark:text-gray-400">Batch Total:</td>
                    <td className="px-4 py-2 text-right font-bold text-indigo-700 dark:text-indigo-400">{batchTotal}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )
        })}
      </div>

      {/* Grand total */}
      <div className="mt-4 bg-indigo-600 text-white rounded-xl px-6 py-4 flex justify-between items-center">
        <span className="font-semibold">Grand Total</span>
        <span className="text-2xl font-bold">{totalThan} than</span>
      </div>
    </div>
  )
}
