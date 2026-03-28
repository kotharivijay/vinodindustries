'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

// ── Types ─────────────────────────────────────────────────────────────────────

interface QueueItem {
  id: number
  imageBase64: string
  mediaType: string
  pageLabel: string | null
  status: string
  recipes: OcrRecipe[] | null
  savedCount: number
  sortOrder: number
  createdAt: string
}

interface OcrRecipe {
  shadeNo: string
  description: string
  chemicals: { name: string; percent: number }[]
}

interface Chemical {
  id: number
  name: string
  unit: string
  category: string | null
}

interface DraftChemical {
  chemicalId: number | null
  ocrName: string
  percent: string
}

interface DraftRecipe {
  shadeNo: string
  description: string
  chemicals: DraftChemical[]
  selected: boolean
  isDuplicate: boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_ICONS: Record<string, string> = {
  pending: '🔄',
  processing: '⏳',
  reviewing: '✏️',
  done: '✅',
  skipped: '⏭️',
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  processing: 'Processing…',
  reviewing: 'Reviewing',
  done: 'Done',
  skipped: 'Skipped',
}

function readFileAsBase64(file: File): Promise<{ base64: string; mediaType: string }> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      // Resize to max 1600px wide to keep base64 small
      const MAX = 1600
      let w = img.width, h = img.height
      if (w > MAX) { h = Math.round(h * MAX / w); w = MAX }
      if (h > MAX) { w = Math.round(w * MAX / h); h = MAX }
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.6)
      const [, data] = dataUrl.split(',')
      resolve({ base64: data, mediaType: 'image/jpeg' })
    }
    img.onerror = reject
    img.src = url
  })
}

// ── Chemical Dropdown (color chemicals only) ──────────────────────────────────

function ChemDropdown({ value, ocrName, colorChemicals, onChange }: {
  value: number | null
  ocrName: string
  colorChemicals: Chemical[]
  onChange: (chemicalId: number, name: string) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = colorChemicals.find(c => c.id === value)

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const filtered = colorChemicals.filter(c =>
    c.name.toLowerCase().includes(query.toLowerCase())
  ).slice(0, 40)

  const displayValue = open ? query : (selected?.name ?? ocrName)

  return (
    <div ref={ref} className="relative flex-1">
      <input
        type="text"
        className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
        placeholder="Search chemical..."
        value={displayValue}
        onFocus={() => { setOpen(true); setQuery('') }}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
      />
      {!selected && ocrName && (
        <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-amber-500 font-medium pointer-events-none">OCR</span>
      )}
      {open && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl max-h-44 overflow-y-auto">
          {filtered.length === 0
            ? <p className="px-3 py-2 text-xs text-gray-400">No chemicals found</p>
            : filtered.map(c => (
              <button
                key={c.id}
                type="button"
                onMouseDown={e => {
                  e.preventDefault()
                  onChange(c.id, c.name)
                  setOpen(false)
                  setQuery('')
                }}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-indigo-50 dark:hover:bg-indigo-900/20 ${c.id === value ? 'bg-indigo-50 dark:bg-indigo-900/30 font-medium text-indigo-700 dark:text-indigo-400' : 'text-gray-800 dark:text-gray-200'}`}
              >
                {c.name}
              </button>
            ))
          }
        </div>
      )}
    </div>
  )
}

// ── Recipe Review Card ─────────────────────────────────────────────────────────

function RecipeCard({ recipe, index, colorChemicals, existingShadeNames, onChange }: {
  recipe: DraftRecipe
  index: number
  colorChemicals: Chemical[]
  existingShadeNames: Set<string>
  onChange: (r: DraftRecipe) => void
}) {
  const isDup = existingShadeNames.has(recipe.shadeNo.trim().toUpperCase())

  useEffect(() => {
    if (isDup !== recipe.isDuplicate) {
      onChange({ ...recipe, isDuplicate: isDup })
    }
  }, [isDup, recipe.shadeNo])

  const addChem = () => onChange({
    ...recipe,
    chemicals: [...recipe.chemicals, { chemicalId: null, ocrName: '', percent: '' }],
  })

  const removeChem = (i: number) => onChange({
    ...recipe,
    chemicals: recipe.chemicals.filter((_, j) => j !== i),
  })

  const updateChem = (i: number, patch: Partial<DraftChemical>) => onChange({
    ...recipe,
    chemicals: recipe.chemicals.map((c, j) => j === i ? { ...c, ...patch } : c),
  })

  return (
    <div className={`rounded-xl border p-4 transition ${recipe.selected ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-900/20' : isDup ? 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/10' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'}`}>
      {/* Card header */}
      <div className="flex items-start gap-3 mb-3">
        <input
          type="checkbox"
          checked={recipe.selected}
          disabled={isDup}
          onChange={e => onChange({ ...recipe, selected: e.target.checked })}
          className="mt-1 w-4 h-4 accent-indigo-600 shrink-0"
        />
        <div className="flex-1 min-w-0">
          <div className="flex gap-2 items-center flex-wrap">
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-0.5">Shade No</label>
              <input
                type="text"
                className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm font-bold bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-indigo-400 w-28"
                value={recipe.shadeNo}
                onChange={e => onChange({ ...recipe, shadeNo: e.target.value })}
              />
            </div>
            <div className="flex-1 min-w-[120px]">
              <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-0.5">Description</label>
              <input
                type="text"
                className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                value={recipe.description}
                onChange={e => onChange({ ...recipe, description: e.target.value })}
              />
            </div>
          </div>
          {isDup && (
            <p className="text-xs text-red-500 dark:text-red-400 mt-1 font-medium">
              Shade &quot;{recipe.shadeNo}&quot; already exists in master
            </p>
          )}
        </div>
      </div>

      {/* Chemical rows */}
      <div className="space-y-2 ml-7">
        {recipe.chemicals.map((chem, ci) => (
          <div key={ci} className="flex gap-2 items-center">
            <ChemDropdown
              value={chem.chemicalId}
              ocrName={chem.ocrName}
              colorChemicals={colorChemicals}
              onChange={(id, _name) => updateChem(ci, { chemicalId: id })}
            />
            <div className="flex items-center gap-1 shrink-0">
              <input
                type="number"
                step="0.01"
                min="0"
                className="w-16 border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                placeholder="%"
                value={chem.percent}
                onChange={e => updateChem(ci, { percent: e.target.value })}
              />
              <span className="text-[10px] text-gray-400 w-4">%</span>
            </div>
            <button
              type="button"
              onClick={() => removeChem(ci)}
              className="text-gray-300 dark:text-gray-600 hover:text-red-500 text-lg leading-none shrink-0"
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addChem}
          className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 font-medium mt-1"
        >
          + Add Chemical
        </button>
      </div>
    </div>
  )
}

// ── Image Zoom Modal ──────────────────────────────────────────────────────────

function ImageZoomModal({ src, mediaType, onClose }: { src: string; mediaType: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <img
        src={`data:${mediaType};base64,${src}`}
        alt="Zoomed"
        className="max-w-full max-h-full object-contain rounded-lg"
        onClick={e => e.stopPropagation()}
      />
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-white text-3xl leading-none opacity-80 hover:opacity-100"
      >
        ×
      </button>
    </div>
  )
}

// ── Review Panel ──────────────────────────────────────────────────────────────

function ReviewPanel({
  item,
  colorChemicals,
  existingShadeNames,
  onSaved,
  onSkip,
  onClose,
}: {
  item: QueueItem
  colorChemicals: Chemical[]
  existingShadeNames: Set<string>
  onSaved: (count: number) => void
  onSkip: () => void
  onClose: () => void
}) {
  const [drafts, setDrafts] = useState<DraftRecipe[]>(() => {
    const ocr: OcrRecipe[] = item.recipes ?? []
    return ocr.map(r => ({
      shadeNo: r.shadeNo,
      description: r.description,
      selected: true,
      isDuplicate: false,
      chemicals: r.chemicals.map(c => ({
        chemicalId: colorChemicals.find(ch => ch.name.toLowerCase() === c.name.toLowerCase())?.id ?? null,
        ocrName: c.name,
        percent: String(c.percent),
      })),
    }))
  })

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [zoomOpen, setZoomOpen] = useState(false)

  const selectedCount = drafts.filter(d => d.selected && !d.isDuplicate).length

  const selectAll = () => setDrafts(d => d.map(r => ({ ...r, selected: !r.isDuplicate })))
  const deselectAll = () => setDrafts(d => d.map(r => ({ ...r, selected: false })))
  const allSelected = drafts.filter(d => !d.isDuplicate).every(d => d.selected)

  async function handleSave() {
    const toSave = drafts.filter(d => d.selected && !d.isDuplicate)
    if (toSave.length === 0) { setError('Select at least one shade to save'); return }

    setSaving(true)
    setError('')

    const shades = toSave.map(d => ({
      name: d.shadeNo.trim(),
      description: d.description.trim() || undefined,
      chemicals: d.chemicals
        .filter(c => c.chemicalId && parseFloat(c.percent) > 0)
        .map(c => ({
          chemicalId: c.chemicalId!,
          percent: parseFloat(c.percent),
          ocrName: c.ocrName || undefined,
        })),
    }))

    const res = await fetch('/api/shades/import-bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shades }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Save failed'); setSaving(false); return }

    // Mark queue item as done with savedCount
    await fetch(`/api/shades/import-queue/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done', savedCount: data.saved.length }),
    })

    setSaving(false)
    onSaved(data.saved.length)
  }

  return (
    <div className="fixed inset-0 z-50 bg-white dark:bg-gray-900 flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none">
          &larr;
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-bold text-gray-800 dark:text-gray-100 truncate">
            Review: {item.pageLabel || `Page #${item.id}`}
          </h2>
          <p className="text-xs text-gray-500">{drafts.length} recipe{drafts.length !== 1 ? 's' : ''} detected</p>
        </div>
        <button
          onClick={onSkip}
          className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 border border-gray-300 dark:border-gray-600 px-3 py-1.5 rounded-lg"
        >
          Skip Page
        </button>
      </div>

      {error && (
        <div className="mx-4 mt-3 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-2 shrink-0">
          {error}
        </div>
      )}

      {/* Two-pane layout */}
      <div className="flex flex-1 overflow-hidden gap-0 md:gap-4 md:p-4">
        {/* Left: image */}
        <div className="hidden md:flex md:w-80 lg:w-96 shrink-0 flex-col">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 font-medium">Original Image</p>
          <div
            className="flex-1 relative overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 cursor-zoom-in"
            onClick={() => setZoomOpen(true)}
            title="Click to zoom"
          >
            <img
              src={`data:${item.mediaType};base64,${item.imageBase64}`}
              alt="Source"
              className="w-full h-full object-contain"
            />
            <div className="absolute bottom-2 right-2 bg-black/50 text-white text-[10px] px-2 py-0.5 rounded-full">
              Click to zoom
            </div>
          </div>
        </div>

        {/* Right: recipes */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Mobile image thumbnail */}
          <div
            className="md:hidden mx-4 mb-3 h-24 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 overflow-hidden cursor-zoom-in shrink-0"
            onClick={() => setZoomOpen(true)}
          >
            <img
              src={`data:${item.mediaType};base64,${item.imageBase64}`}
              alt="Source"
              className="w-full h-full object-contain"
            />
          </div>

          {/* Toolbar */}
          <div className="flex items-center gap-2 px-4 md:px-0 mb-3 shrink-0 flex-wrap">
            <button
              type="button"
              onClick={allSelected ? deselectAll : selectAll}
              className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 font-medium border border-indigo-300 dark:border-indigo-700 px-3 py-1.5 rounded-lg"
            >
              {allSelected ? 'Deselect All' : 'Select All'}
            </button>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {selectedCount} of {drafts.length} selected
            </span>
            <div className="flex-1" />
            <button
              onClick={handleSave}
              disabled={saving || selectedCount === 0}
              className="bg-indigo-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition"
            >
              {saving ? 'Saving…' : `Save Selected (${selectedCount})`}
            </button>
          </div>

          {/* Recipe cards */}
          <div className="flex-1 overflow-y-auto px-4 md:px-0 space-y-3 pb-6">
            {drafts.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-sm">
                No recipes detected from this image.
              </div>
            ) : (
              drafts.map((r, i) => (
                <RecipeCard
                  key={i}
                  recipe={r}
                  index={i}
                  colorChemicals={colorChemicals}
                  existingShadeNames={existingShadeNames}
                  onChange={updated => setDrafts(d => d.map((x, j) => j === i ? updated : x))}
                />
              ))
            )}
          </div>
        </div>
      </div>

      {zoomOpen && (
        <ImageZoomModal
          src={item.imageBase64}
          mediaType={item.mediaType}
          onClose={() => setZoomOpen(false)}
        />
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ShadeImportPage() {
  const router = useRouter()
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [loadingQueue, setLoadingQueue] = useState(true)
  const [colorChemicals, setColorChemicals] = useState<Chemical[]>([])
  const [existingShadeNames, setExistingShadeNames] = useState<Set<string>>(new Set())
  const [reviewItem, setReviewItem] = useState<QueueItem | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [ocrLoading, setOcrLoading] = useState<number | null>(null)
  const [clearingAll, setClearingAll] = useState(false)

  const cameraInputRef = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)

  // Load queue, color chemicals, existing shade names
  const loadAll = useCallback(async () => {
    setLoadingQueue(true)
    const [qRes, chemRes, shadeRes] = await Promise.all([
      fetch('/api/shades/import-queue'),
      fetch('/api/chemicals?category=color'),
      fetch('/api/shades'),
    ])
    if (qRes.ok) setQueue(await qRes.json())
    if (chemRes.ok) setColorChemicals(await chemRes.json())
    if (shadeRes.ok) {
      const shades = await shadeRes.json()
      setExistingShadeNames(new Set((shades as any[]).map((s: any) => s.name.toUpperCase())))
    }
    setLoadingQueue(false)
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  // Stats
  const stats = {
    total: queue.length,
    done: queue.filter(q => q.status === 'done').length,
    reviewing: queue.filter(q => q.status === 'reviewing').length,
    pending: queue.filter(q => q.status === 'pending').length,
    skipped: queue.filter(q => q.status === 'skipped').length,
  }
  const hasUnfinished = stats.pending > 0 || stats.reviewing > 0

  // Handle file selection (camera or gallery)
  async function handleFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true)
    setUploadError('')

    try {
      const fileArr = Array.from(files)
      for (let i = 0; i < fileArr.length; i++) {
        const file = fileArr[i]
        const { base64, mediaType } = await readFileAsBase64(file)
        const res = await fetch('/api/shades/import-queue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            images: [{
              base64,
              mediaType,
              pageLabel: file.name || `Image ${i + 1}`,
            }],
          }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: 'Upload failed' }))
          setUploadError(data.error ?? `Upload failed for image ${i + 1}`)
          return
        }
      }
      await loadAll()
    } catch (e: any) {
      setUploadError(e.message ?? 'Failed to process images')
    } finally {
      setUploading(false)
      // Reset inputs so same files can be selected again
      if (cameraInputRef.current) cameraInputRef.current.value = ''
      if (galleryInputRef.current) galleryInputRef.current.value = ''
    }
  }

  // Run OCR on a queue item
  async function runOcr(item: QueueItem) {
    setOcrLoading(item.id)
    const res = await fetch(`/api/shades/import-queue/${item.id}/ocr`, { method: 'POST' })
    if (res.ok) {
      const updated = await res.json()
      setQueue(q => q.map(x => x.id === item.id ? updated : x))
      setReviewItem(updated)
    } else {
      const d = await res.json().catch(() => ({ error: 'OCR failed' }))
      alert(d.error ?? 'OCR failed')
    }
    setOcrLoading(null)
  }

  // Skip an item
  async function skipItem(item: QueueItem) {
    const res = await fetch(`/api/shades/import-queue/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'skipped' }),
    })
    if (res.ok) {
      const updated = await res.json()
      setQueue(q => q.map(x => x.id === item.id ? updated : x))
      setReviewItem(null)
    }
  }

  // Delete a single item
  async function deleteItem(item: QueueItem) {
    if (!confirm('Delete this image from the queue?')) return
    await fetch(`/api/shades/import-queue/${item.id}`, { method: 'DELETE' })
    setQueue(q => q.filter(x => x.id !== item.id))
    if (reviewItem?.id === item.id) setReviewItem(null)
  }

  // Clear all
  async function clearAll() {
    if (!confirm('Clear all items from the import queue?')) return
    setClearingAll(true)
    await fetch('/api/shades/import-queue', { method: 'DELETE' })
    setQueue([])
    setReviewItem(null)
    setClearingAll(false)
  }

  const progressPct = stats.total === 0 ? 0 : Math.round(((stats.done + stats.skipped) / stats.total) * 100)

  // Show review panel full-screen when reviewing
  if (reviewItem) {
    const fresh = queue.find(q => q.id === reviewItem.id) ?? reviewItem
    return (
      <ReviewPanel
        item={fresh}
        colorChemicals={colorChemicals}
        existingShadeNames={existingShadeNames}
        onSaved={async (count) => {
          await loadAll()
          setReviewItem(null)
        }}
        onSkip={async () => {
          await skipItem(fresh)
          await loadAll()
        }}
        onClose={() => setReviewItem(null)}
      />
    )
  }

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center gap-3 shrink-0">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg px-3 py-2 text-sm font-medium transition"
        >
          &larr; Back
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">Import Shade Recipes</h1>
          <p className="text-xs text-gray-500 hidden sm:block">Scan a recipe register page to import shades</p>
        </div>
      </div>

      <div className="flex-1 p-4 md:p-6 max-w-2xl mx-auto w-full space-y-4">

        {/* Resume banner */}
        {hasUnfinished && (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-xl px-4 py-3 flex items-center gap-3">
            <span className="text-amber-600 dark:text-amber-400 text-lg">↺</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                You have {stats.pending + stats.reviewing} unfinished import{stats.pending + stats.reviewing !== 1 ? 's' : ''}
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-500">
                {stats.reviewing > 0 && `${stats.reviewing} awaiting review`}
                {stats.reviewing > 0 && stats.pending > 0 && ' · '}
                {stats.pending > 0 && `${stats.pending} pending OCR`}
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              {stats.reviewing > 0 && (
                <button
                  onClick={() => {
                    const firstReviewing = queue.find(q => q.status === 'reviewing')
                    if (firstReviewing) setReviewItem(firstReviewing)
                  }}
                  className="bg-amber-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-amber-700 transition"
                >
                  Resume
                </button>
              )}
              <button
                onClick={clearAll}
                disabled={clearingAll}
                className="text-amber-700 dark:text-amber-400 border border-amber-400 dark:border-amber-600 px-3 py-1.5 rounded-lg text-xs hover:bg-amber-100 dark:hover:bg-amber-800/30 transition"
              >
                Clear All
              </button>
            </div>
          </div>
        )}

        {/* Camera / Gallery buttons */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Add Images</p>
          {uploadError && (
            <div className="mb-3 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
              {uploadError}
            </div>
          )}
          <div className="flex gap-3 flex-wrap">
            <button
              onClick={() => cameraInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-60 transition"
            >
              <span>📷</span>
              <span>Camera</span>
            </button>
            <button
              onClick={() => galleryInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-60 transition"
            >
              <span>🖼️</span>
              <span>Choose from Gallery</span>
              <span className="text-xs text-gray-400">(multi-select)</span>
            </button>
            {uploading && (
              <div className="flex items-center gap-2 text-sm text-indigo-600 dark:text-indigo-400">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Uploading…
              </div>
            )}
          </div>

          {/* Hidden file inputs */}
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            multiple
            capture="environment"
            className="hidden"
            onChange={e => handleFilesSelected(e.target.files)}
          />
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={e => handleFilesSelected(e.target.files)}
          />
        </div>

        {/* Status bar / queue list */}
        {queue.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            {/* Stats row */}
            <div className="flex items-center gap-4 px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex-wrap text-xs">
              <span className="font-semibold text-gray-600 dark:text-gray-300">Total: {stats.total}</span>
              <span className="text-green-600 dark:text-green-400">✅ Done: {stats.done}</span>
              {stats.reviewing > 0 && <span className="text-blue-600 dark:text-blue-400">✏️ Reviewing: {stats.reviewing}</span>}
              {stats.pending > 0 && <span className="text-gray-500 dark:text-gray-400">🔄 Pending: {stats.pending}</span>}
              {stats.skipped > 0 && <span className="text-gray-400">⏭️ Skipped: {stats.skipped}</span>}
              <div className="flex-1" />
              {!hasUnfinished && queue.length > 0 && (
                <button onClick={clearAll} disabled={clearingAll} className="text-gray-400 hover:text-red-500 text-xs">
                  Clear All
                </button>
              )}
            </div>

            {/* Progress bar */}
            <div className="h-1.5 bg-gray-100 dark:bg-gray-700">
              <div
                className="h-full bg-green-500 transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>

            {/* Queue items */}
            {loadingQueue ? (
              <div className="py-8 text-center text-gray-400 text-sm">Loading…</div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-gray-700">
                {queue.map(item => (
                  <div key={item.id} className="flex items-center gap-3 px-4 py-3">
                    {/* Thumbnail */}
                    <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600">
                      <img
                        src={`data:${item.mediaType};base64,${item.imageBase64}`}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
                        {item.pageLabel || `Image #${item.id}`}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {STATUS_ICONS[item.status]} {STATUS_LABELS[item.status]}
                        {item.status === 'done' && item.savedCount > 0 && ` · ${item.savedCount} shade${item.savedCount !== 1 ? 's' : ''} saved`}
                        {item.status === 'reviewing' && item.recipes && ` · ${(item.recipes as any[]).length} recipe${(item.recipes as any[]).length !== 1 ? 's' : ''} found`}
                      </p>
                    </div>

                    {/* Action button */}
                    <div className="flex items-center gap-2 shrink-0">
                      {item.status === 'pending' && (
                        <button
                          onClick={() => runOcr(item)}
                          disabled={ocrLoading === item.id}
                          className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-60 transition"
                        >
                          {ocrLoading === item.id ? (
                            <span className="flex items-center gap-1.5">
                              <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                              </svg>
                              Running…
                            </span>
                          ) : 'Run OCR'}
                        </button>
                      )}
                      {item.status === 'reviewing' && (
                        <button
                          onClick={() => setReviewItem(item)}
                          className="text-xs bg-amber-500 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-amber-600 transition"
                        >
                          Continue →
                        </button>
                      )}
                      {item.status === 'done' && (
                        <button
                          onClick={() => setReviewItem(item)}
                          className="text-xs text-gray-500 dark:text-gray-400 border border-gray-300 dark:border-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition"
                        >
                          View
                        </button>
                      )}
                      {item.status === 'skipped' && (
                        <button
                          onClick={() => runOcr(item)}
                          className="text-xs text-gray-500 dark:text-gray-400 border border-gray-300 dark:border-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition"
                        >
                          Re-scan
                        </button>
                      )}
                      <button
                        onClick={() => deleteItem(item)}
                        className="text-gray-300 dark:text-gray-600 hover:text-red-500 text-lg leading-none"
                        title="Delete"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {!loadingQueue && queue.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <div className="text-5xl mb-3">📋</div>
            <p className="text-base font-medium text-gray-500 dark:text-gray-400">No images in queue</p>
            <p className="text-sm text-gray-400 mt-1">Take a photo or choose images from gallery to begin</p>
          </div>
        )}

        {/* Help note */}
        {colorChemicals.length === 0 && !loadingQueue && (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl px-4 py-3">
            <p className="text-sm text-amber-700 dark:text-amber-400 font-medium">No color chemicals found</p>
            <p className="text-xs text-amber-600 dark:text-amber-500 mt-0.5">
              Go to Chemical Master and set category = &quot;color&quot; for dye chemicals to enable matching during review.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
