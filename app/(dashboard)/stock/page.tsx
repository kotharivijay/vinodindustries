'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import * as XLSX from 'xlsx'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface LotStock {
  lotNo: string
  party: string
  quality: string
  stock: number
  openingBalance: number
  greyThan: number
  totalThan: number
  despatchThan: number
  foldProgrammed: number
  manuallyUsed: number
  manuallyUsedNote: string | null
  foldAvailable: number
  lrNos: string
  markas: string
  inwardDates: string
}

interface PartyStock {
  party: string
  partyTag?: string | null
  totalStock: number
  lotCount: number
  lots: LotStock[]
}

type SortMode = 'party-asc' | 'party-desc' | 'stock-desc' | 'stock-asc' | 'lot-asc' | 'lot-desc'

// Parse lot number: "PS-100" → { prefix: "PS-", num: 100 }, "PSRG-25" → { prefix: "PSRG-", num: 25 }
function parseLotNo(lotNo: string): { prefix: string; num: number } {
  const match = lotNo.match(/^(.*?)(\d+)\s*$/)
  if (match) return { prefix: match[1], num: parseInt(match[2]) }
  return { prefix: lotNo, num: 0 }
}

function compareLotNo(a: string, b: string): number {
  const pa = parseLotNo(a), pb = parseLotNo(b)
  const prefixCmp = pa.prefix.localeCompare(pb.prefix)
  if (prefixCmp !== 0) return prefixCmp
  return pa.num - pb.num
}

/** "2026-04-21,2026-04-25" → "21 Apr, 25 Apr". Empty input → "—". */
function formatInwardDates(csv: string): string {
  if (!csv) return '—'
  return csv.split(',').map(d => {
    const dt = new Date(d.trim() + 'T00:00:00')
    if (isNaN(dt.getTime())) return d
    return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
  }).join(', ')
}

interface PartySharePage {
  index: number
  total: number
  party: string
  partyTag: string | null
  totalStock: number
  totalLots: number
  lots: LotStock[]
}

function PartyStockShareCard({ page }: { page: PartySharePage }) {
  // Show Marka for Pali PC Job tagged parties (any case/spacing) AND for
  // Prakash Shirting (matches the rule used in the unallocated-stock modal).
  const tagLower = (page.partyTag || '').toLowerCase()
  const showMarka =
    tagLower.includes('pali') && tagLower.includes('pc') ||
    tagLower === 'pali pc job' ||
    /prakash\s+shirting/i.test(page.party)
  return (
    <div id={`stock-share-page-${page.index - 1}`}
      style={{ width: '480px', fontFamily: 'system-ui, -apple-system, sans-serif' }}
      className="bg-white text-gray-900 p-4">
      <div className="border-b-4 border-indigo-700 pb-2 mb-3">
        <div className="text-lg font-bold leading-tight">📦 Stock</div>
        <div className="text-base font-bold text-black">{page.party}</div>
        <div className="text-xs text-gray-700 mt-0.5">
          {page.totalLots} lots · Page {page.index}/{page.total}
        </div>
        <div className="text-sm mt-2 flex gap-3">
          <span className="font-bold text-indigo-700">📊 Balance {page.totalStock} than</span>
        </div>
      </div>
      <div className="space-y-2">
        {page.lots.map((l, i) => (
          <div key={l.lotNo} className={`px-2.5 py-2 rounded ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'} border border-gray-200`}>
            <div className="flex justify-between items-baseline gap-2">
              <span className="text-base font-bold text-black">{l.lotNo}</span>
              <span className="text-xs font-semibold text-gray-700">{l.quality}</span>
            </div>
            <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
              <div><span className="text-gray-600">Inward:</span> <span className="font-bold text-black">{formatInwardDates(l.inwardDates)}</span></div>
              <div><span className="text-gray-600">LR:</span> <span className="font-bold text-black">{l.lrNos || '—'}</span></div>
              <div><span className="text-gray-600">Total:</span> <span className="font-bold text-black">{l.totalThan}</span></div>
              <div><span className="text-gray-600">Desp:</span> <span className="font-bold text-black">{l.despatchThan}</span></div>
            </div>
            <div className="mt-1.5 flex justify-between items-baseline gap-2 pt-1 border-t border-gray-100">
              {showMarka && l.markas ? (
                <span className="text-xs"><span className="text-gray-600">Marka:</span> <span className="font-bold text-black">{l.markas}</span></span>
              ) : <span />}
              <span className="text-sm font-bold text-indigo-700 whitespace-nowrap">
                Balance {l.stock} than
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function StockPage() {
  const router = useRouter()
  const { data, isLoading, mutate } = useSWR<{ parties: PartyStock[]; totalStock: number; totalLots: number }>('/api/stock', fetcher)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortMode>('party-asc')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const restoredRef = useRef(false)

  // ── Restore filter + expansion state when arriving on the page (incl. via
  // router.back() from a lot tracking page). App Router doesn't remount
  // cached pages, so a mount-only effect won't fire on back-nav — listen
  // for popstate/pageshow/visibilitychange too.
  useEffect(() => {
    function loadFromSession() {
      try {
        const e = sessionStorage.getItem('stock-expanded')
        const s = sessionStorage.getItem('stock-search')
        const so = sessionStorage.getItem('stock-sort')
        const tf = sessionStorage.getItem('stock-tagFilter')
        if (e) setExpanded(new Set(JSON.parse(e)))
        if (s !== null) setSearch(s)
        if (so) setSort(so as SortMode)
        if (tf !== null) setTagFilter(tf === '__null__' ? null : tf)
      } catch {}
      restoredRef.current = true
    }
    loadFromSession()
    window.addEventListener('popstate', loadFromSession)
    window.addEventListener('pageshow', loadFromSession)
    document.addEventListener('visibilitychange', loadFromSession)
    return () => {
      window.removeEventListener('popstate', loadFromSession)
      window.removeEventListener('pageshow', loadFromSession)
      document.removeEventListener('visibilitychange', loadFromSession)
    }
  }, [])

  // Persist on any state change (after the first restore so we don't write
  // empty defaults over saved values).
  useEffect(() => {
    if (!restoredRef.current) return
    try {
      sessionStorage.setItem('stock-expanded', JSON.stringify(Array.from(expanded)))
      sessionStorage.setItem('stock-search', search)
      sessionStorage.setItem('stock-sort', sort)
      sessionStorage.setItem('stock-tagFilter', tagFilter === null ? '__null__' : tagFilter)
    } catch {}
  }, [expanded, search, sort, tagFilter])

  // Scroll back to the last clicked lot once data + expansions are in place.
  useEffect(() => {
    if (isLoading || !data) return
    let lastLot: string | null = null
    try { lastLot = sessionStorage.getItem('stock-last-lot') } catch {}
    if (!lastLot) return
    const t = setTimeout(() => {
      const el = document.getElementById(`stock-lot-${lastLot}`)
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior })
        el.classList.add('ring-2', 'ring-indigo-400')
        setTimeout(() => el.classList.remove('ring-2', 'ring-indigo-400'), 1500)
      }
      try { sessionStorage.removeItem('stock-last-lot') } catch {}
    }, 80)
    return () => clearTimeout(t)
  }, [isLoading, data, expanded])

  // Single-lot reservation
  const [editingReservation, setEditingReservation] = useState<string | null>(null)
  const [reserveThan, setReserveThan] = useState('')
  const [reserveNote, setReserveNote] = useState('')
  const [savingReservation, setSavingReservation] = useState(false)

  // Bulk mode
  const [bulkMode, setBulkMode] = useState(false)
  // Map<lotNo, { usedThan: string, note: string }>
  const [bulkSelections, setBulkSelections] = useState<Map<string, { usedThan: string; note: string }>>(new Map())
  const [savingBulk, setSavingBulk] = useState(false)

  function toggleBulkMode() {
    setBulkMode(prev => !prev)
    setBulkSelections(new Map())
    setEditingReservation(null)
  }

  function toggleBulkLot(lot: LotStock) {
    setBulkSelections(prev => {
      const next = new Map(prev)
      if (next.has(lot.lotNo)) {
        next.delete(lot.lotNo)
      } else {
        next.set(lot.lotNo, {
          usedThan: lot.manuallyUsed > 0 ? String(lot.manuallyUsed) : String(lot.foldAvailable),
          note: lot.manuallyUsedNote ?? '',
        })
      }
      return next
    })
  }

  function updateBulkThan(lotNo: string, val: string) {
    setBulkSelections(prev => {
      const next = new Map(prev)
      const existing = next.get(lotNo)
      if (existing) next.set(lotNo, { ...existing, usedThan: val })
      return next
    })
  }

  function updateBulkNote(lotNo: string, val: string) {
    setBulkSelections(prev => {
      const next = new Map(prev)
      const existing = next.get(lotNo)
      if (existing) next.set(lotNo, { ...existing, note: val })
      return next
    })
  }

  async function saveBulk() {
    if (bulkSelections.size === 0) return
    setSavingBulk(true)
    try {
      const items = Array.from(bulkSelections.entries()).map(([lotNo, { usedThan, note }]) => ({
        lotNo,
        usedThan: parseInt(usedThan) || 0,
        note: note.trim() || undefined,
      }))
      await fetch('/api/stock/reservation/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      })
      await mutate()
      setBulkMode(false)
      setBulkSelections(new Map())
    } finally {
      setSavingBulk(false)
    }
  }

  function openReservation(lot: LotStock) {
    setEditingReservation(lot.lotNo)
    setReserveThan(lot.manuallyUsed > 0 ? String(lot.manuallyUsed) : '')
    setReserveNote(lot.manuallyUsedNote ?? '')
  }

  async function saveReservation(lotNo: string) {
    const usedThan = parseInt(reserveThan) || 0
    setSavingReservation(true)
    try {
      if (usedThan <= 0) {
        await fetch('/api/stock/reservation', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lotNo }),
        })
      } else {
        await fetch('/api/stock/reservation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lotNo, usedThan, note: reserveNote.trim() || null }),
        })
      }
      await mutate()
      setEditingReservation(null)
    } finally {
      setSavingReservation(false)
    }
  }

  const toggle = (party: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(party)) next.delete(party)
      else next.add(party)
      return next
    })
  }

  // Unique tags from stock data
  const uniqueStockTags = useMemo(() => {
    if (!data?.parties) return []
    const tags = new Set<string>()
    for (const p of data.parties) {
      if (p.partyTag) tags.add(p.partyTag)
    }
    return Array.from(tags).sort()
  }, [data])

  const filtered = useMemo(() => {
    if (!data?.parties) return []
    let list = data.parties

    // Tag filter
    if (tagFilter !== null) {
      if (tagFilter === '__untagged__') {
        list = list.filter(p => !p.partyTag)
      } else {
        list = list.filter(p => p.partyTag === tagFilter)
      }
    }

    if (search.trim()) {
      const q = search.toLowerCase()
      // Filter lots within each party, then keep parties that have matching lots or matching party name
      list = list
        .map(p => {
          const partyMatch = p.party.toLowerCase().includes(q)
          if (partyMatch) return p // show all lots if party name matches
          const matchingLots = p.lots.filter(l => l.lotNo.toLowerCase().includes(q) || l.quality.toLowerCase().includes(q))
          if (matchingLots.length === 0) return null
          return { ...p, lots: matchingLots, totalStock: matchingLots.reduce((s, l) => s + l.stock, 0) }
        })
        .filter(Boolean) as typeof list
    }
    // Sort lots within each party by prefix then number
    list = list.map(p => ({
      ...p,
      lots: [...p.lots].sort((a, b) => compareLotNo(a.lotNo, b.lotNo)),
    }))
    list = [...list]
    switch (sort) {
      case 'party-asc': list.sort((a, b) => a.party.localeCompare(b.party)); break
      case 'party-desc': list.sort((a, b) => b.party.localeCompare(a.party)); break
      case 'stock-desc': list.sort((a, b) => b.totalStock - a.totalStock); break
      case 'stock-asc': list.sort((a, b) => a.totalStock - b.totalStock); break
      case 'lot-asc': list.sort((a, b) => { const la = a.lots[0]?.lotNo ?? ''; const lb = b.lots[0]?.lotNo ?? ''; return compareLotNo(la, lb) }); break
      case 'lot-desc': list.sort((a, b) => { const la = a.lots[0]?.lotNo ?? ''; const lb = b.lots[0]?.lotNo ?? ''; return compareLotNo(lb, la) }); break
    }
    return list
  }, [data, search, sort, tagFilter])

  function getFlatRows() {
    return filtered.flatMap(p =>
      p.lots.map(l => [p.party, l.lotNo, l.quality, l.openingBalance, l.greyThan, l.despatchThan, l.stock, l.foldProgrammed, l.manuallyUsed, l.foldAvailable])
    )
  }

  function exportXLSX() {
    const headers = ['Party', 'Lot No', 'Quality', 'Opening Balance', 'Grey Than', 'Despatch Than', 'Balance Stock', 'Fold Programmed', 'Manually Used', 'Fold Available']
    const ws = XLSX.utils.aoa_to_sheet([headers, ...getFlatRows()])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Balance Stock')
    XLSX.writeFile(wb, 'balance-stock.xlsx')
  }

  async function exportPDF() {
    const { default: jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    const doc = new jsPDF({ orientation: 'landscape' })
    doc.setFontSize(14)
    doc.text('Balance Stock Report', 14, 14)
    doc.setFontSize(9)
    doc.text(`${data?.totalStock?.toLocaleString()} than · ${data?.totalLots} lots · ${filtered.length} parties${search ? ` · Search: "${search}"` : ''}`, 14, 21)
    autoTable(doc, {
      head: [['Party', 'Lot No', 'Quality', 'OB', 'Grey', 'Desp', 'Balance', 'Fold Prog', 'Used', 'Fold Avail']],
      body: getFlatRows(),
      startY: 26,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [79, 70, 229] },
      columnStyles: {
        6: { fontStyle: 'bold', textColor: [79, 70, 229] },
        9: { fontStyle: 'bold', textColor: [5, 150, 105] },
      },
    })
    doc.save('balance-stock.pdf')
  }

  // ── Share Party Stock as image(s) — same UX as attendance ──
  const SHARE_LOTS_PER_IMAGE = 6
  const [shareBusy, setShareBusy] = useState<string | null>(null) // party currently rendering
  const [pendingShare, setPendingShare] = useState<PartySharePage[] | null>(null)

  function buildSharePages(party: PartyStock): PartySharePage[] {
    const lots = [...party.lots].sort((a, b) => compareLotNo(a.lotNo, b.lotNo))
    const pages: PartySharePage[] = []
    for (let i = 0; i < lots.length; i += SHARE_LOTS_PER_IMAGE) {
      pages.push({
        index: 0, total: 0,
        party: party.party,
        partyTag: party.partyTag ?? null,
        totalStock: party.totalStock,
        totalLots: party.lotCount,
        lots: lots.slice(i, i + SHARE_LOTS_PER_IMAGE),
      })
    }
    pages.forEach((p, idx) => { p.index = idx + 1; p.total = pages.length })
    return pages
  }

  async function shareParty(party: PartyStock) {
    const pages = buildSharePages(party)
    if (pages.length === 0) return
    setShareBusy(party.party)
    setPendingShare(pages)
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    try {
      const { default: html2canvas } = await import('html2canvas')
      const files: File[] = []
      for (let i = 0; i < pages.length; i++) {
        const node = document.getElementById(`stock-share-page-${i}`)
        if (!node) continue
        const canvas = await html2canvas(node, {
          backgroundColor: '#ffffff', scale: 2, useCORS: true, logging: false,
        })
        const blob: Blob | null = await new Promise(res => canvas.toBlob(b => res(b), 'image/png'))
        if (blob) {
          const safe = party.party.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
          files.push(new File([blob], `stock-${safe}-${i + 1}.png`, { type: 'image/png' }))
        }
      }
      if (files.length === 0) { alert('Image render failed'); return }
      if ((navigator as any).canShare?.({ files }) && navigator.share) {
        try {
          await navigator.share({ files, title: `Stock — ${party.party}`, text: `Stock — ${party.party}` })
          return
        } catch (e: any) { if (e?.name === 'AbortError') return }
      }
      // Fallback: download
      for (const f of files) {
        const url = URL.createObjectURL(f)
        const a = document.createElement('a')
        a.href = url; a.download = f.name
        document.body.appendChild(a); a.click(); a.remove()
        URL.revokeObjectURL(url)
      }
      alert(`Downloaded ${files.length} image(s) — upload to WhatsApp manually.`)
    } catch (e: any) {
      alert('Could not create images: ' + (e?.message || e))
    } finally {
      setShareBusy(null)
      setPendingShare(null)
    }
  }

  if (isLoading) return <div className="p-8 text-gray-400">Loading stock data...</div>

  const bulkSelectedCount = bulkSelections.size
  const bulkFilledCount = Array.from(bulkSelections.values()).filter(v => parseInt(v.usedThan) > 0).length

  return (
    <div className="p-4 md:p-8 max-w-3xl pb-32">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg px-4 py-2 text-sm font-medium transition">
          &larr; Back
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Balance Stock</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{data?.totalStock?.toLocaleString()} than &middot; {data?.totalLots} lots &middot; {data?.parties?.length} parties</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={toggleBulkMode}
            className={`px-3 py-2 rounded-lg text-xs font-medium transition ${
              bulkMode
                ? 'bg-amber-500 text-white hover:bg-amber-600'
                : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-700 hover:bg-amber-100'
            }`}
          >
            {bulkMode ? '✕ Cancel Bulk' : '☑ Bulk Mark Used'}
          </button>
          {!bulkMode && (
            <>
              <button onClick={exportXLSX} className="flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-2 rounded-lg text-xs font-medium hover:bg-emerald-700">
                ⬇ XLSX
              </button>
              <button onClick={exportPDF} className="flex items-center gap-1.5 bg-red-600 text-white px-3 py-2 rounded-lg text-xs font-medium hover:bg-red-700">
                ⬇ PDF
              </button>
            </>
          )}
        </div>
      </div>

      {/* Bulk mode banner */}
      {bulkMode && (
        <div className="mb-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="font-semibold mb-0.5">Bulk Mark Used Mode</p>
              <p className="text-xs opacity-80">
                {bulkSelectedCount === 0
                  ? 'Expand a party → check lots → enter quantity used'
                  : `${bulkSelectedCount} lot${bulkSelectedCount !== 1 ? 's' : ''} selected, ${bulkFilledCount} with quantity`}
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={toggleBulkMode}
                className="px-3 py-1.5 rounded-lg text-xs border border-amber-300 dark:border-amber-600 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40"
              >
                Cancel
              </button>
              <button
                onClick={saveBulk}
                disabled={savingBulk || bulkFilledCount === 0}
                className="bg-amber-600 text-white px-4 py-1.5 rounded-lg text-xs font-semibold hover:bg-amber-700 disabled:opacity-40 transition"
              >
                {savingBulk ? 'Saving...' : bulkFilledCount > 0 ? `Save ${bulkSelectedCount} lot${bulkSelectedCount !== 1 ? 's' : ''}` : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search + Sort + Tag Filter */}
      <div className="mb-4 space-y-3">
        <input
          type="text"
          placeholder="Search party, lot no, quality..."
          className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        {/* Tag filter chips */}
        {uniqueStockTags.length > 0 && (
          <div className="flex gap-2 flex-wrap items-center">
            <span className="text-xs text-gray-400 dark:text-gray-500">Tag:</span>
            <button
              onClick={() => setTagFilter(null)}
              className={`text-xs px-2.5 py-1 rounded-full border transition ${
                tagFilter === null
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              All
            </button>
            {uniqueStockTags.map(tag => (
              <button
                key={tag}
                onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
                className={`text-xs px-2.5 py-1 rounded-full border transition ${
                  tagFilter === tag
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                {tag}
              </button>
            ))}
            <button
              onClick={() => setTagFilter(tagFilter === '__untagged__' ? null : '__untagged__')}
              className={`text-xs px-2.5 py-1 rounded-full border transition ${
                tagFilter === '__untagged__'
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              Untagged
            </button>
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          <span className="text-xs text-gray-400">Sort:</span>
          {([
            ['party-asc', 'Party A-Z'],
            ['party-desc', 'Party Z-A'],
            ['lot-asc', 'Lot 1→9'],
            ['lot-desc', 'Lot 9→1'],
            ['stock-desc', 'Stock ↓'],
            ['stock-asc', 'Stock ↑'],
          ] as [SortMode, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setSort(key)}
              className={`text-xs px-2 py-1 rounded border ${
                sort === key
                  ? 'bg-indigo-100 dark:bg-indigo-900/30 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-400 font-medium'
                  : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Party Cards */}
      {filtered.length === 0 ? (
        <div className="text-center text-gray-400 py-16">No stock found</div>
      ) : (
        <div className="space-y-3">
          {filtered.map(p => {
            const partyAllSelected = p.lots.every(l => bulkSelections.has(l.lotNo))
            const partySomeSelected = p.lots.some(l => bulkSelections.has(l.lotNo))

            const toggleSelectAllParty = () => {
              // auto-expand party so user can see selections
              if (!expanded.has(p.party)) toggle(p.party)
              setBulkSelections(prev => {
                const next = new Map(prev)
                if (partyAllSelected) {
                  p.lots.forEach(l => next.delete(l.lotNo))
                } else {
                  p.lots.forEach(l => {
                    if (!next.has(l.lotNo)) {
                      next.set(l.lotNo, {
                        usedThan: l.manuallyUsed > 0 ? String(l.manuallyUsed) : String(l.foldAvailable),
                        note: l.manuallyUsedNote ?? '',
                      })
                    }
                  })
                }
                return next
              })
            }

            return (
            <div key={p.party} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
              {/* Party header */}
              <div className="flex items-center">
                {bulkMode && (
                  <div className="pl-4 pr-1 flex items-center" onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={partyAllSelected}
                      ref={el => { if (el) el.indeterminate = partySomeSelected && !partyAllSelected }}
                      onChange={toggleSelectAllParty}
                      className="w-4 h-4 accent-amber-500 cursor-pointer"
                      title="Select all lots in this party"
                    />
                  </div>
                )}
                <button
                  onClick={() => toggle(p.party)}
                  className="flex-1 min-w-0 text-left px-4 py-3 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition"
                >
                  <span className="text-lg">📦</span>
                  <div className="flex-1 min-w-0">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 leading-snug">{p.party}</p>
                      {p.partyTag && (
                        <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded-full border bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800 font-medium">
                          {p.partyTag}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      {p.lotCount} lot{p.lotCount !== 1 ? 's' : ''}
                      {bulkMode && partySomeSelected && (
                        <span className="ml-1 text-amber-600 dark:text-amber-400 font-medium">
                          · {p.lots.filter(l => bulkSelections.has(l.lotNo)).length} selected
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-lg font-bold text-indigo-600 dark:text-indigo-400">{p.totalStock}</p>
                    <p className="text-[10px] text-gray-400 dark:text-gray-500">than</p>
                  </div>
                  <span className="text-gray-300 dark:text-gray-600 text-sm">{expanded.has(p.party) ? '▲' : '▼'}</span>
                </button>
                {!bulkMode && (
                  <button
                    onClick={(e) => { e.stopPropagation(); shareParty(p) }}
                    disabled={shareBusy !== null}
                    title="Share this party's stock as WhatsApp image"
                    className="shrink-0 px-2.5 py-3 text-sm bg-pink-50 dark:bg-pink-900/20 text-pink-600 dark:text-pink-400 hover:bg-pink-100 dark:hover:bg-pink-900/40 border-l border-gray-100 dark:border-gray-700 disabled:opacity-50"
                  >
                    {shareBusy === p.party ? '⏳' : '📸'}
                  </button>
                )}
              </div>

              {/* Expanded lot cards */}
              {expanded.has(p.party) && (
                <div className="border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 px-4 py-3 space-y-2">
                  {p.lots.map(lot => {
                    const isChecked = bulkSelections.has(lot.lotNo)
                    const bulkVal = bulkSelections.get(lot.lotNo)
                    return (
                      <div
                        key={lot.lotNo}
                        id={`stock-lot-${lot.lotNo}`}
                        className={`bg-white dark:bg-gray-800 rounded-lg border p-3 transition ${
                          bulkMode && isChecked
                            ? 'border-amber-300 dark:border-amber-600 ring-1 ring-amber-200 dark:ring-amber-700'
                            : 'border-gray-200 dark:border-gray-700'
                        }`}
                      >
                        {/* Lot header row */}
                        <div className="flex items-center gap-2 mb-1">
                          {bulkMode && (
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleBulkLot(lot)}
                              className="w-4 h-4 accent-amber-500 shrink-0 cursor-pointer"
                            />
                          )}
                          <Link
                            href={`/lot/${encodeURIComponent(lot.lotNo)}`}
                            onClick={() => { try { sessionStorage.setItem('stock-last-lot', lot.lotNo) } catch {} }}
                            className="text-sm font-semibold text-indigo-700 dark:text-indigo-400 hover:underline flex-1"
                          >
                            {lot.lotNo}
                          </Link>
                          <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400">{lot.stock} than</span>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-1 ml-6">{lot.quality}</p>

                        {/* Badges */}
                        <div className="flex flex-wrap gap-2 text-[10px] mb-2 ml-6">
                          {lot.openingBalance > 0 && (
                            <span className="bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800 px-1.5 py-0.5 rounded">OB: {lot.openingBalance}</span>
                          )}
                          {lot.greyThan > 0 && (
                            <span className="bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 px-1.5 py-0.5 rounded">Grey: {lot.greyThan}</span>
                          )}
                          {lot.despatchThan > 0 && (
                            <span className="bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400 border border-orange-200 dark:border-orange-800 px-1.5 py-0.5 rounded">Desp: {lot.despatchThan}</span>
                          )}
                          {lot.foldProgrammed > 0 && (
                            <span className="bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400 border border-purple-200 dark:border-purple-800 px-1.5 py-0.5 rounded">Fold: {lot.foldProgrammed}</span>
                          )}
                          {lot.manuallyUsed > 0 && (
                            <span className="bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800 px-1.5 py-0.5 rounded font-semibold">Used: {lot.manuallyUsed}</span>
                          )}
                          <span className="bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 px-1.5 py-0.5 rounded font-semibold">Avail: {lot.foldAvailable}</span>
                        </div>

                        {/* Bulk inline inputs — shown when checked */}
                        {bulkMode && isChecked && (
                          <div className="ml-6 mt-2 space-y-2">
                            <div className="flex gap-2 items-center">
                              <input
                                type="number"
                                min={0}
                                max={lot.stock}
                                className="w-24 border border-amber-300 dark:border-amber-700 rounded px-2 py-1.5 text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-amber-400"
                                placeholder="Than"
                                value={bulkVal?.usedThan ?? ''}
                                onChange={e => updateBulkThan(lot.lotNo, e.target.value)}
                                autoFocus
                              />
                              <span className="text-xs text-gray-400">of {lot.stock} than</span>
                            </div>
                            <input
                              type="text"
                              className="w-full border border-amber-300 dark:border-amber-700 rounded px-2 py-1.5 text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-amber-400"
                              placeholder="Note (optional)"
                              value={bulkVal?.note ?? ''}
                              onChange={e => updateBulkNote(lot.lotNo, e.target.value)}
                            />
                          </div>
                        )}

                        {/* Single-lot reservation (only in normal mode) */}
                        {!bulkMode && (
                          editingReservation === lot.lotNo ? (
                            <div className="mt-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 space-y-2">
                              <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">Mark than as used (dyeing / fold)</p>
                              <div className="flex gap-2 items-center">
                                <input
                                  type="number"
                                  min={0}
                                  max={lot.stock}
                                  className="w-24 border border-amber-300 dark:border-amber-700 rounded px-2 py-1.5 text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-amber-400"
                                  placeholder="Than"
                                  value={reserveThan}
                                  onChange={e => setReserveThan(e.target.value)}
                                  autoFocus
                                />
                                <span className="text-xs text-gray-400">of {lot.stock} than</span>
                              </div>
                              <input
                                type="text"
                                className="w-full border border-amber-300 dark:border-amber-700 rounded px-2 py-1.5 text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-amber-400"
                                placeholder="Note (optional) e.g. dyeing batch March"
                                value={reserveNote}
                                onChange={e => setReserveNote(e.target.value)}
                              />
                              <div className="flex gap-2">
                                <button
                                  onClick={() => saveReservation(lot.lotNo)}
                                  disabled={savingReservation}
                                  className="bg-amber-600 text-white px-3 py-1.5 rounded text-xs font-medium hover:bg-amber-700 disabled:opacity-50"
                                >
                                  {savingReservation ? 'Saving...' : 'Save'}
                                </button>
                                <button
                                  onClick={() => setEditingReservation(null)}
                                  className="bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-3 py-1.5 rounded text-xs font-medium hover:bg-gray-200 dark:hover:bg-gray-600"
                                >
                                  Cancel
                                </button>
                                {lot.manuallyUsed > 0 && (
                                  <button
                                    onClick={() => { setReserveThan('0'); saveReservation(lot.lotNo) }}
                                    disabled={savingReservation}
                                    className="ml-auto text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                                  >
                                    Clear
                                  </button>
                                )}
                              </div>
                            </div>
                          ) : (
                            <button
                              onClick={e => { e.stopPropagation(); openReservation(lot) }}
                              className={`text-[10px] px-2 py-1 rounded border font-medium transition ${
                                lot.manuallyUsed > 0
                                  ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 hover:bg-amber-100'
                                  : 'bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-600'
                              }`}
                            >
                              {lot.manuallyUsed > 0 ? `✓ ${lot.manuallyUsed} than used — edit` : '+ Mark as used'}
                            </button>
                          )
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
          })}
        </div>
      )}

      {/* Sticky bulk save footer */}
      {bulkMode && bulkSelectedCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-white dark:bg-gray-900 border-t border-amber-200 dark:border-amber-800 px-4 py-4 flex items-center gap-3 shadow-xl">
          <div className="flex-1">
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">
              {bulkSelectedCount} lot{bulkSelectedCount !== 1 ? 's' : ''} selected
            </p>
            <p className="text-xs text-gray-400">
              {bulkFilledCount} with quantity entered
            </p>
          </div>
          <button
            onClick={toggleBulkMode}
            className="px-4 py-2 rounded-lg text-sm border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={saveBulk}
            disabled={savingBulk || bulkFilledCount === 0}
            className="bg-amber-600 text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-amber-700 disabled:opacity-50 transition"
          >
            {savingBulk ? 'Saving...' : `Save ${bulkSelectedCount} lot${bulkSelectedCount !== 1 ? 's' : ''}`}
          </button>
        </div>
      )}

      {/* Off-screen render target for the party-stock share images */}
      {pendingShare && (
        <div style={{ position: 'fixed', left: '-10000px', top: 0, zIndex: -1 }}>
          {pendingShare.map(p => <PartyStockShareCard key={p.index} page={p} />)}
        </div>
      )}
    </div>
  )
}
