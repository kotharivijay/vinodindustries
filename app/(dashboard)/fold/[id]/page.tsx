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
                  <span className="text-xs text-green-600 dark:text-green-400 font-semibold">{l.foldAvailable}</span>
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
  marka?: string | null
  party?: { name: string; tag?: string | null }
  quality?: { name: string }
}

interface DyeingRef { id: number; slipNo: number; status: string; dyeingDoneAt: string | null }

interface FoldBatch {
  id: number
  batchNo: number
  shadeName?: string
  shade?: { id: number; name: string }
  lots: FoldBatchLot[]
  dyeingEntries?: DyeingRef[]
}

interface FoldProgram {
  id: number
  foldNo: string
  date: string
  status: 'draft' | 'confirmed'
  notes?: string
  isPali?: boolean
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
  const { data: validation, mutate: revalidate } = useSWR<any>(`/api/fold/validate?foldId=${id}`, fetcher, { revalidateOnFocus: false })
  const [confirming, setConfirming] = useState(false)
  const [creatingShade, setCreatingShade] = useState<string | null>(null)

  // Shade creation popup state
  const [shadePopup, setShadePopup] = useState<string | null>(null)
  const [shadeDesc, setShadeDesc] = useState('')
  const [shadeRecipe, setShadeRecipe] = useState<{ chemicalId: string; name: string; quantity: string }[]>([])
  const [shadeSaving, setShadeSaving] = useState(false)
  const [chemSearch, setChemSearch] = useState('')
  const [chemDropOpen, setChemDropOpen] = useState(false)
  const { data: masterChemicals = [] } = useSWR<{ id: number; name: string; unit: string }[]>(shadePopup ? '/api/chemicals' : null, fetcher)

  function openShadePopup(name: string) {
    setShadePopup(name)
    setShadeDesc('')
    setShadeRecipe([])
    setChemSearch('')
  }

  async function saveShade() {
    if (!shadePopup) return
    setShadeSaving(true)
    await fetch('/api/shades', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: shadePopup,
        description: shadeDesc || null,
        recipeItems: shadeRecipe.filter(r => r.chemicalId && r.quantity).map(r => ({
          chemicalId: parseInt(r.chemicalId),
          quantity: parseFloat(r.quantity),
        })),
      }),
    })
    setShadeSaving(false)
    setShadePopup(null)
    revalidate()
  }

  // Fetch stock data for lot picker
  const { data: stockData, mutate: mutateStock } = useSWR<{ parties: { party: string; lots: StockLot[] }[] }>('/api/stock', fetcher)
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
    mutateStock()
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

      {/* Validation Issues */}
      {validation && (validation.errorCount > 0 || validation.warningCount > 0) && (
        <div className={`mb-4 rounded-xl border p-4 ${validation.errorCount > 0 ? 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800' : 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800'}`}>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-bold text-gray-700 dark:text-gray-200">
              {validation.errorCount > 0 ? '❌' : '⚠️'} Validation Issues ({validation.errorCount + validation.warningCount})
            </h3>
            <button onClick={() => revalidate()} className="text-[10px] text-purple-600 dark:text-purple-400 font-medium hover:underline">Re-validate</button>
          </div>

          {/* Missing shades */}
          {validation.shadeIssues?.length > 0 && (
            <div className="space-y-1 mb-2">
              {validation.shadeIssues.map((s: any, i: number) => (
                <div key={i} className="flex items-center justify-between text-xs bg-white dark:bg-gray-800 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-red-500">❌</span>
                    <span className="text-gray-700 dark:text-gray-200">Shade &quot;{s.shadeName}&quot; not in master</span>
                    <span className="text-[10px] text-gray-400">(B{s.batchNo})</span>
                  </div>
                  <button
                    onClick={() => openShadePopup(s.shadeName)}
                    className="text-[10px] bg-purple-600 text-white px-2 py-0.5 rounded font-medium hover:bg-purple-700"
                  >
                    Create Shade
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Lot stock issues */}
          {validation.lotIssues?.length > 0 && (
            <div className="space-y-1">
              {validation.lotIssues.map((l: any, i: number) => (
                <div key={i} className="flex items-center justify-between text-xs bg-white dark:bg-gray-800 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span>{l.type === 'not_found' ? '❌' : '⚠️'}</span>
                    <span className="font-medium text-gray-700 dark:text-gray-200">{l.lotNo}</span>
                    <span className="text-gray-400">
                      {l.type === 'not_found' ? 'not found in stock' : `needs ${l.needed}, available ${l.available} (stock: ${l.stock})`}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {validation && validation.status === 'valid' && (
        <div className="mb-4 bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800 rounded-xl px-4 py-2 flex items-center justify-between">
          <span className="text-xs font-medium text-green-700 dark:text-green-400">✅ All lots and shades validated</span>
          <button onClick={() => revalidate()} className="text-[10px] text-purple-600 dark:text-purple-400 font-medium hover:underline">Re-validate</button>
        </div>
      )}

      {/* Batches */}
      <div className="space-y-4">
        {program.batches.map(batch => {
          const batchTotal = batch.lots.reduce((s, l) => s + l.than, 0)
          const dyed = batch.dyeingEntries && batch.dyeingEntries.length > 0
          const dyeEntry = batch.dyeingEntries?.[0]
          const dyeStatus = dyeEntry?.dyeingDoneAt ? 'done' : dyeEntry?.status || null
          return (
            <div key={batch.id} className={`bg-white dark:bg-gray-800 rounded-xl border overflow-hidden ${dyed ? 'border-green-200 dark:border-green-800' : 'border-gray-200 dark:border-gray-700'}`}>
              <div className={`px-4 py-2 flex items-center justify-between ${dyed ? 'bg-green-50 dark:bg-green-900/20' : 'bg-indigo-50 dark:bg-indigo-900/30'}`}>
                <div className="flex items-center gap-1.5">
                  {dyed && <span className="text-sm">🔒</span>}
                  <span className={`font-bold text-sm ${dyed ? 'text-green-700 dark:text-green-400' : 'text-indigo-700 dark:text-indigo-400'}`}>Batch {batch.batchNo}</span>
                  <ShadePicker batch={batch} shades={shades} onSave={updateBatchShade} />
                  {dyed && dyeEntry && (
                    <a href={`/dyeing/${dyeEntry.id}`} className="text-[9px] px-1.5 py-0.5 rounded font-medium bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 hover:underline">
                      Slip {dyeEntry.slipNo} {dyeStatus === 'done' ? '✅' : dyeStatus === 'patchy' ? '⚠️' : '⏳'}
                    </a>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-bold ${dyed ? 'text-green-600 dark:text-green-400' : 'text-indigo-600 dark:text-indigo-400'}`}>{batchTotal} than</span>
                  {!dyed && (
                    <button
                      onClick={() => router.push(`/dyeing/batch?batchId=${batch.id}`)}
                      className="text-[10px] bg-purple-600 text-white px-2 py-1 rounded hover:bg-purple-700 font-medium"
                    >
                      🎨 Dye
                    </button>
                  )}
                </div>
              </div>
              {/* Mobile card view */}
              <div className="sm:hidden divide-y divide-gray-100 dark:divide-gray-700">
                {batch.lots.map(lot => (
                  <div key={lot.id} className="px-4 py-2.5">
                    <div className="flex items-center justify-between mb-0.5">
                      <div className="flex items-center gap-2">
                        <LotPicker currentLotNo={lot.lotNo} currentThan={lot.than} lotId={lot.id} stockLots={allStockLots} onSave={updateLot} />
                        {program?.isPali && lot.marka && (
                          <span className="text-[10px] font-bold bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-1.5 py-0.5 rounded">🏷️ {lot.marka}</span>
                        )}
                      </div>
                      <span className="text-sm font-bold text-gray-800 dark:text-gray-100">{lot.than}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-gray-500 dark:text-gray-400">
                      <span>{lot.party?.name ?? '-'}</span>
                      <span className="text-gray-300 dark:text-gray-600">·</span>
                      <span>{lot.quality?.name ?? '-'}</span>
                    </div>
                  </div>
                ))}
                <div className="px-4 py-2 bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">Batch Total</span>
                  <span className="font-bold text-indigo-700 dark:text-indigo-400">{batchTotal}</span>
                </div>
              </div>

              {/* Desktop table view */}
              <table className="hidden sm:table w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
                    <th className="text-left px-4 py-2">Lot No</th>
                    {program?.isPali && <th className="text-left px-4 py-2">Marka</th>}
                    <th className="text-left px-4 py-2">Party</th>
                    <th className="text-left px-4 py-2">Quality</th>
                    <th className="text-right px-4 py-2">Than</th>
                  </tr>
                </thead>
                <tbody>
                  {batch.lots.map(lot => (
                    <tr key={lot.id} className="border-b border-gray-50 dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-4 py-2">
                        <LotPicker currentLotNo={lot.lotNo} currentThan={lot.than} lotId={lot.id} stockLots={allStockLots} onSave={updateLot} />
                      </td>
                      {program?.isPali && (
                        <td className="px-4 py-2">
                          {lot.marka ? <span className="text-xs font-bold text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded">🏷️ {lot.marka}</span> : <span className="text-gray-300">-</span>}
                        </td>
                      )}
                      <td className="px-4 py-2 text-gray-600 dark:text-gray-300">{lot.party?.name ?? '-'}</td>
                      <td className="px-4 py-2 text-gray-600 dark:text-gray-300">{lot.quality?.name ?? '-'}</td>
                      <td className="px-4 py-2 text-right font-bold text-gray-800 dark:text-gray-100">{lot.than}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-indigo-50 dark:bg-indigo-900/20">
                    <td colSpan={program?.isPali ? 4 : 3} className="px-4 py-2 text-xs font-semibold text-right text-gray-600 dark:text-gray-400">Batch Total:</td>
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

      {/* Shade Creation Popup */}
      {shadePopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShadePopup(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-3 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">Create Shade</h2>
              <button onClick={() => setShadePopup(null)} className="text-gray-400 text-xl">&times;</button>
            </div>

            <div>
              <label className="block text-[10px] text-gray-500 mb-0.5">Shade Name</label>
              <input value={shadePopup} readOnly
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 dark:text-gray-100 font-medium" />
            </div>

            <div>
              <label className="block text-[10px] text-gray-500 mb-0.5">Description</label>
              <input value={shadeDesc} onChange={e => setShadeDesc(e.target.value)} placeholder="e.g. Dark Navy, Super White"
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100" />
            </div>

            {/* Recipe */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] text-gray-500 font-medium">Recipe (per 100 kg)</label>
              </div>

              {/* Add chemical */}
              <div className="relative mb-2">
                <input
                  type="text" placeholder="Search chemical to add..."
                  value={chemSearch}
                  onChange={e => { setChemSearch(e.target.value); setChemDropOpen(true) }}
                  onFocus={() => setChemDropOpen(true)}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
                />
                {chemDropOpen && chemSearch && (
                  <div className="absolute z-10 top-full mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-xl max-h-40 overflow-y-auto">
                    {masterChemicals
                      .filter((c: any) => c.name.toLowerCase().includes(chemSearch.toLowerCase()))
                      .filter((c: any) => !shadeRecipe.some(r => r.chemicalId === String(c.id)))
                      .slice(0, 10)
                      .map((c: any) => (
                        <button key={c.id} onClick={() => {
                          setShadeRecipe(prev => [...prev, { chemicalId: String(c.id), name: c.name, quantity: '' }])
                          setChemSearch('')
                          setChemDropOpen(false)
                        }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-purple-50 dark:hover:bg-purple-900/20 text-gray-700 dark:text-gray-200">
                          {c.name} <span className="text-[10px] text-gray-400">({c.unit})</span>
                        </button>
                      ))}
                    {masterChemicals.filter((c: any) => c.name.toLowerCase().includes(chemSearch.toLowerCase())).length === 0 && (
                      <p className="px-3 py-2 text-xs text-gray-400">No chemicals found</p>
                    )}
                  </div>
                )}
              </div>

              {/* Recipe items */}
              {shadeRecipe.length > 0 && (
                <div className="space-y-1.5">
                  {shadeRecipe.map((r, ri) => (
                    <div key={ri} className="flex items-center gap-2 bg-gray-50 dark:bg-gray-900 rounded-lg px-3 py-2">
                      <span className="text-xs text-gray-700 dark:text-gray-200 flex-1">{r.name}</span>
                      <input type="number" step="0.001" placeholder="Qty" value={r.quantity}
                        onChange={e => setShadeRecipe(prev => { const u = [...prev]; u[ri] = { ...u[ri], quantity: e.target.value }; return u })}
                        className="w-20 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs bg-white dark:bg-gray-700 dark:text-gray-100 text-center" />
                      <span className="text-[10px] text-gray-400">kg</span>
                      <button onClick={() => setShadeRecipe(prev => prev.filter((_, i) => i !== ri))}
                        className="text-red-400 hover:text-red-600 text-sm">×</button>
                    </div>
                  ))}
                </div>
              )}

              {shadeRecipe.length === 0 && (
                <p className="text-[10px] text-gray-400 italic">No recipe items — shade will be created without recipe. You can add recipe later from Shade Master.</p>
              )}
            </div>

            <button onClick={saveShade} disabled={shadeSaving}
              className="w-full bg-purple-600 text-white py-2.5 rounded-lg text-sm font-bold hover:bg-purple-700 disabled:opacity-50">
              {shadeSaving ? 'Creating...' : 'Create Shade'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
