'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface FoldBatchLot {
  lotNo: string
  than: number
  party?: { name: string }
  quality?: { name: string }
}

interface FoldBatch {
  id: number
  batchNo: number
  shadeName?: string
  shade?: { name: string }
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

// ── Import types ──────────────────────────────────────────────────────────────

interface ParsedImportLot { lotNo: string; than: number }

interface ParsedImportBatch {
  date: string
  slipNo: number
  lots: ParsedImportLot[]
}

interface ParsedImportFold {
  foldNo: string
  partyName: string
  qualityName: string
  shadeNo: string
  shadeName: string
  batches: ParsedImportBatch[]
}

function parseImportText(text: string): ParsedImportFold[] {
  const blocks = text.trim().split(/\n\s*\n/)
  const folds: ParsedImportFold[] = []

  for (const block of blocks) {
    const lines = block.trim().split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length === 0) continue

    // Line 1: Fold [no] | [party] | [quality] | [shade no] | [shade name]
    const headerParts = lines[0].split('|').map(s => s.trim())
    if (headerParts.length < 2) continue

    const foldNoPart = headerParts[0]
    const foldNoMatch = foldNoPart.match(/fold\s*(\S+)/i)
    const foldNo = foldNoMatch ? foldNoMatch[1] : foldNoPart

    const partyName = headerParts[1] || ''
    const qualityName = headerParts[2] || ''
    const shadeNo = headerParts[3] || ''
    const shadeName = headerParts[4] || ''

    // Lines 2+: [date] | [slip no] | [lot1=than, lot2=than, ...]
    const batches: ParsedImportBatch[] = []
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split('|').map(s => s.trim())
      if (parts.length < 3) continue

      // Parse date as DD/MM/YYYY -> YYYY-MM-DD
      const dateParts = parts[0].split('/')
      let dateStr = parts[0]
      if (dateParts.length === 3) {
        dateStr = `${dateParts[2]}-${dateParts[1].padStart(2, '0')}-${dateParts[0].padStart(2, '0')}`
      }

      const slipNo = parseInt(parts[1]) || 0

      // Parse lots: "AJ-13400=16, AJ-13060=16" or "AJ-13400=16"
      const lotsStr = parts[2]
      const lotEntries = lotsStr.split(',').map(s => s.trim()).filter(Boolean)
      const lots: ParsedImportLot[] = []
      for (const entry of lotEntries) {
        const eqParts = entry.split('=')
        if (eqParts.length === 2) {
          lots.push({ lotNo: eqParts[0].trim(), than: parseInt(eqParts[1].trim()) || 0 })
        }
      }

      if (lots.length > 0) {
        batches.push({ date: dateStr, slipNo, lots })
      }
    }

    if (batches.length > 0) {
      folds.push({ foldNo, partyName, qualityName, shadeNo, shadeName, batches })
    }
  }

  return folds
}

// ── Import Modal ──────────────────────────────────────────────────────────────

function ImportFoldsModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<ParsedImportFold[] | null>(null)
  const [parseError, setParseError] = useState('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ foldNo: string; status: string; error?: string }[] | null>(null)

  function handleParse() {
    setParseError('')
    setImportResult(null)
    try {
      const folds = parseImportText(text)
      if (folds.length === 0) {
        setParseError('No valid fold blocks found. Check format.')
        return
      }
      setPreview(folds)
    } catch (e: any) {
      setParseError(e.message ?? 'Parse error')
    }
  }

  async function handleImport() {
    if (!preview) return
    setImporting(true)
    setImportResult(null)
    try {
      const res = await fetch('/api/fold/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folds: preview }),
      })
      const data = await res.json()
      if (!res.ok) {
        setParseError(data.error ?? 'Import failed')
      } else {
        setImportResult(data.results)
        onImported()
      }
    } catch (e: any) {
      setParseError(e.message ?? 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  const allDone = importResult && importResult.every(r => r.status === 'ok')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <h2 className="text-base font-bold text-gray-800 dark:text-gray-100">Import Folds from Register</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl leading-none">&times;</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Textarea */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Paste fold data (one fold per block, separated by blank line):</label>
            <textarea
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 font-mono"
              rows={12}
              placeholder={`Fold 8 | Rathi textile mills | PC Butta 48" | AJ/PC/10 | Gold\n04/04/2026 | 1936 | AJ-13400=16\n04/04/2026 | 1937 | AJ-13400=16\n\nFold 9 | Prakash shirting | Raymond 44" | | White\n07/04/2026 | 1987 | PS-12420=15`}
              value={text}
              onChange={e => { setText(e.target.value); setPreview(null); setImportResult(null); setParseError('') }}
            />
          </div>

          {parseError && (
            <div className="text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-2 text-sm">{parseError}</div>
          )}

          {!preview && !importResult && (
            <button
              onClick={handleParse}
              disabled={!text.trim()}
              className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition"
            >
              Parse &amp; Preview
            </button>
          )}

          {/* Preview */}
          {preview && !importResult && (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Preview</h3>
              <div className="space-y-2">
                {preview.map((fold, i) => {
                  const totalThan = fold.batches.reduce((s, b) => s + b.lots.reduce((ls, l) => ls + l.than, 0), 0)
                  const lotNos = [...new Set(fold.batches.flatMap(b => b.lots.map(l => l.lotNo)))]
                  return (
                    <div key={i} className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-green-600 dark:text-green-400 text-sm">&#10003;</span>
                        <span className="text-sm font-bold text-gray-800 dark:text-gray-100">Fold {fold.foldNo}:</span>
                        <span className="text-sm text-gray-600 dark:text-gray-300">{fold.partyName}</span>
                        {fold.qualityName && <span className="text-sm text-gray-400">&#183; {fold.qualityName}</span>}
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 ml-6">
                        {fold.batches.length} batch{fold.batches.length !== 1 ? 'es' : ''} &#183; {lotNos.join(', ')} &#183; {totalThan} than
                        {fold.shadeName && <> &#183; {fold.shadeName}</>}
                      </p>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Import results */}
          {importResult && (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Import Results</h3>
              <div className="space-y-1">
                {importResult.map((r, i) => (
                  <div key={i} className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded ${
                    r.status === 'ok'
                      ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                      : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                  }`}>
                    <span>{r.status === 'ok' ? '&#10003;' : '&#10007;'}</span>
                    <span>Fold {r.foldNo}</span>
                    {r.error && <span className="text-xs">&#8212; {r.error}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-5 py-4 border-t border-gray-100 dark:border-gray-700">
          <button
            onClick={onClose}
            className="flex-1 py-2 text-sm border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition"
          >
            {allDone ? 'Done' : 'Cancel'}
          </button>
          {preview && !importResult && (
            <button
              onClick={handleImport}
              disabled={importing}
              className="flex-1 py-2 text-sm bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 disabled:opacity-50 transition"
            >
              {importing ? 'Importing...' : `Import All (${preview.length})`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function FoldListPage() {
  const router = useRouter()
  const { data: programs, isLoading, mutate } = useSWR<FoldProgram[]>('/api/fold', fetcher)
  const [search, setSearch] = useState('')
  const [showImport, setShowImport] = useState(false)

  const filtered = (programs ?? []).filter(p =>
    p.foldNo.toLowerCase().includes(search.toLowerCase()) ||
    p.batches.some(b =>
      b.lots.some(l => l.lotNo.toLowerCase().includes(search.toLowerCase()))
    )
  )

  async function deleteProgram(id: number, foldNo: string) {
    if (!confirm(`Delete Fold Program ${foldNo}? This cannot be undone.`)) return
    await fetch(`/api/fold/${id}`, { method: 'DELETE' })
    mutate()
  }

  const totalThan = (p: FoldProgram) =>
    p.batches.reduce((s, b) => s + b.lots.reduce((ls, l) => ls + l.than, 0), 0)

  if (isLoading) return <div className="p-8 text-gray-400">Loading fold programs...</div>

  return (
    <div className="p-4 md:p-8 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg px-4 py-2 text-sm font-medium transition">
          &larr; Back
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Fold Programs</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{programs?.length ?? 0} programs</p>
        </div>
        <button
          onClick={() => setShowImport(true)}
          className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 transition"
        >
          Import Folds
        </button>
        <Link
          href="/fold/new"
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition"
        >
          + New Fold
        </Link>
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search fold no, lot no..."
        className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-indigo-400"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      {filtered.length === 0 ? (
        <div className="text-center text-gray-400 py-16">
          {programs?.length === 0 ? 'No fold programs yet. Create one!' : 'No results found.'}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(p => (
            <div key={p.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
              <div className="px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <Link href={`/fold/${p.id}`} className="text-sm font-bold text-indigo-700 dark:text-indigo-400 hover:underline">
                      {p.foldNo}
                    </Link>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                      p.status === 'confirmed'
                        ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                        : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400'
                    }`}>
                      {p.status}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 dark:text-gray-500">
                    {new Date(p.date).toLocaleDateString('en-IN')} &middot; {p.batches.length} batch{p.batches.length !== 1 ? 'es' : ''} &middot; {p.batches.reduce((s, b) => s + b.lots.length, 0)} lots
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-lg font-bold text-indigo-600">{totalThan(p)}</p>
                  <p className="text-[10px] text-gray-400">than</p>
                </div>
                <div className="flex gap-1.5">
                  <Link
                    href={`/fold/${p.id}`}
                    className="text-xs bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-700 px-2 py-1 rounded hover:bg-indigo-100 dark:hover:bg-indigo-900/50"
                  >
                    View
                  </Link>
                  <button
                    onClick={() => deleteProgram(p.id, p.foldNo)}
                    className="text-xs bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 px-2 py-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showImport && (
        <ImportFoldsModal
          onClose={() => setShowImport(false)}
          onImported={() => mutate()}
        />
      )}
    </div>
  )
}
