'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import BackButton from '../../BackButton'

const fetcher = (url: string) => fetch(url).then(r => r.json())
const fmtMoney = (n: number) => Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDateSlash = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

interface LedgerOption { id: number; name: string; parent: string | null; gstNo: string | null }
interface Voucher {
  source: 'sales' | 'hdfc'
  id: number
  date: string | null
  vchNumber: string | null
  vchType: string | null
  amount: number
  narration: string | null
  isOpeningBalance?: boolean
  allocationCount?: number
  // 'Dr' | 'Cr' for Journals — sync derives it from the party leg sign in
  // Tally. Used to override the CR_TYPES default classification, which is
  // wrong for journals where the party is on the Dr leg.
  journalDirection?: string | null
  // For hdfc rows: 'in' = receipt (Cr party), 'out' = payment / refund
  // (Dr party). Overrides the vchType default so a Payment refund posts
  // on the Dr side of the party ledger.
  bankDirection?: string | null
}
interface LedgerInfo {
  name: string; parent: string | null; address: string | null
  gstNo: string | null; panNo: string | null; mobileNos: string | null; state: string | null
}
interface PartyData {
  ledger: LedgerInfo | null
  outstandingBills: any[]
  vouchers: Voucher[]
  openingBalance?: number
}

type Preset = 'fy-current' | 'fy-prior' | 'this-month' | 'last-month' | 'custom'

// Dr-side: party owes us (raise the receivable).
// Cr-side: party paid / discounted / TDS-deducted (drop the receivable).
// Cash row treated as Cr like Receipt.
const DR_TYPES = new Set(['Sales', 'Process Job', 'Debit Note', 'Purchase Return'])
const CR_TYPES = new Set(['Receipt', 'Payment', 'Credit Note', 'Cash', 'Journal'])

const ALL_TYPE_PILLS = [
  'All',
  'Process Job',
  'Sales',
  'Credit Note',
  'Debit Note',
  'Receipt',
  'Payment',
  'Cash',
  'Journal',
]

function currentFY() {
  const now = new Date()
  const yr = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  return { from: `${yr}-04-01`, to: `${yr + 1}-03-31`, label: `FY ${String(yr).slice(2)}-${String(yr + 1).slice(2)}` }
}
function priorFY() {
  const now = new Date()
  const yr = now.getMonth() >= 3 ? now.getFullYear() - 1 : now.getFullYear() - 2
  return { from: `${yr}-04-01`, to: `${yr + 1}-03-31`, label: `FY ${String(yr).slice(2)}-${String(yr + 1).slice(2)}` }
}
function thisMonth() {
  const now = new Date()
  const y = now.getFullYear(), m = now.getMonth()
  const last = new Date(y, m + 1, 0).getDate()
  return { from: `${y}-${String(m + 1).padStart(2, '0')}-01`, to: `${y}-${String(m + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`, label: now.toLocaleString('en-IN', { month: 'short', year: '2-digit' }) }
}
function lastMonth() {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  return { from: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`, to: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`, label: d.toLocaleString('en-IN', { month: 'short', year: '2-digit' }) }
}

const fy = currentFY()

export default function LedgerPage() {
  const [partyName, setPartyName] = useState<string>('')
  const [partyQuery, setPartyQuery] = useState<string>('')
  const [partyDropdownOpen, setPartyDropdownOpen] = useState(false)
  const [preset, setPreset] = useState<Preset>('fy-current')
  const [dateFrom, setDateFrom] = useState<string>(fy.from)
  const [dateTo, setDateTo] = useState<string>(fy.to)
  const [typeFilter, setTypeFilter] = useState<string>('All')
  const [sharing, setSharing] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const shareRef = useRef<HTMLDivElement>(null)

  // Hydrate last selection
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('ledger.state')
      if (!saved) return
      const s = JSON.parse(saved)
      if (typeof s.partyName === 'string') setPartyName(s.partyName)
      if (typeof s.preset === 'string') setPreset(s.preset)
      if (typeof s.dateFrom === 'string') setDateFrom(s.dateFrom)
      if (typeof s.dateTo === 'string') setDateTo(s.dateTo)
      if (typeof s.typeFilter === 'string') setTypeFilter(s.typeFilter)
    } catch {}
  }, [])
  useEffect(() => {
    try { sessionStorage.setItem('ledger.state', JSON.stringify({ partyName, preset, dateFrom, dateTo, typeFilter })) } catch {}
  }, [partyName, preset, dateFrom, dateTo, typeFilter])

  function applyPreset(p: Preset) {
    setPreset(p)
    if (p === 'fy-current') { const r = currentFY(); setDateFrom(r.from); setDateTo(r.to) }
    else if (p === 'fy-prior') { const r = priorFY(); setDateFrom(r.from); setDateTo(r.to) }
    else if (p === 'this-month') { const r = thisMonth(); setDateFrom(r.from); setDateTo(r.to) }
    else if (p === 'last-month') { const r = lastMonth(); setDateFrom(r.from); setDateTo(r.to) }
  }

  const debouncedQuery = useDebounce(partyQuery, 250)
  const { data: partyData } = useSWR<{ ledgers: LedgerOption[] }>(
    partyDropdownOpen || debouncedQuery ? `/api/tally/ledgers?firm=KSI&search=${encodeURIComponent(debouncedQuery)}&limit=50` : null,
    fetcher, { revalidateOnFocus: false },
  )
  const partyOptions = partyData?.ledgers ?? []

  const swrKey = partyName ? `/api/tally/ksi-party?name=${encodeURIComponent(partyName)}&dateFrom=${dateFrom}&dateTo=${dateTo}` : null
  const { data, isLoading, mutate } = useSWR<PartyData>(swrKey, fetcher, { revalidateOnFocus: false, keepPreviousData: true })

  // Clear selection whenever the party, range or type filter shifts —
  // stale selections would point to rows no longer on screen.
  useEffect(() => { setSelectedIds(new Set()) }, [partyName, dateFrom, dateTo, typeFilter])

  // Filter by selected voucher-type pill, then compute running balance.
  // Running balance is seeded with the OB so it threads from the synthetic
  // OB row (rendered separately) through the in-range transactions.
  const opening = data?.openingBalance ?? 0
  const statement = useMemo(() => {
    const all = data?.vouchers ?? []
    const filtered = typeFilter === 'All' ? all : all.filter(v => (v.vchType || '') === typeFilter)
    let balance = opening
    return filtered.map(v => {
      const t = v.vchType || ''
      // bankDirection wins for hdfc rows: 'out' = Dr to party (refund),
      // 'in' = Cr to party (receipt). Then journal direction. Then the
      // vchType fallback.
      let isDebit: boolean
      let isCredit: boolean
      if (v.bankDirection === 'out') {
        isDebit = true; isCredit = false
      } else if (v.bankDirection === 'in') {
        isDebit = false; isCredit = true
      } else if (t === 'Journal' && v.journalDirection) {
        isDebit = v.journalDirection === 'Dr'
        isCredit = v.journalDirection === 'Cr'
      } else {
        isDebit = DR_TYPES.has(t)
        isCredit = CR_TYPES.has(t)
      }
      const debit = isDebit ? v.amount : 0
      const credit = isCredit ? v.amount : 0
      balance += debit - credit
      return { ...v, debit, credit, balance }
    })
  }, [data?.vouchers, typeFilter, opening])

  const totals = useMemo(() => {
    const dr = statement.reduce((s, r) => s + r.debit, 0)
    const cr = statement.reduce((s, r) => s + r.credit, 0)
    // Closing = OB + period changes — same as the last running-balance value
    // when statement has rows; falls back to OB itself otherwise.
    return { dr, cr, closing: statement.at(-1)?.balance ?? opening, opening }
  }, [statement, opening])

  // Per-type counts for the pill row.
  const typeCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const v of (data?.vouchers ?? [])) m.set(v.vchType || '—', (m.get(v.vchType || '—') ?? 0) + 1)
    return m
  }, [data?.vouchers])

  async function deleteJournal(v: Voucher) {
    if (v.source !== 'sales' || v.vchType !== 'Journal') return
    const ok = confirm(`Delete Journal ${v.vchNumber} (₹${fmtMoney(v.amount)})?\n\nThis will delete from Tally first, then locally. If Tally fails, nothing is deleted.`)
    if (!ok) return
    const res = await fetch(`/api/accounts/sales/${v.id}`, { method: 'DELETE' })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) { alert(d?.error || 'Delete failed'); return }
    if (d.note) alert(d.note)
    mutate()
  }

  // Only Journal+sales rows in the current filtered statement are
  // selection-eligible — anything else just isn't deletable from here.
  const selectableIds = useMemo(
    () => statement.filter(r => r.source === 'sales' && r.vchType === 'Journal').map(r => r.id),
    [statement],
  )
  const allSelected = selectableIds.length > 0 && selectableIds.every(id => selectedIds.has(id))

  function toggleSelect(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function toggleSelectAll() {
    setSelectedIds(prev => {
      if (allSelected) {
        const next = new Set(prev)
        selectableIds.forEach(id => next.delete(id))
        return next
      }
      const next = new Set(prev)
      selectableIds.forEach(id => next.add(id))
      return next
    })
  }

  async function bulkDeleteJournals() {
    const ids = Array.from(selectedIds)
    if (!ids.length) return
    const ok = confirm(`Delete ${ids.length} selected Journal voucher${ids.length === 1 ? '' : 's'}?\n\nEach voucher is deleted from Tally first, then locally. Any that fail in Tally stay both places.`)
    if (!ok) return
    setBulkDeleting(true)
    try {
      const res = await fetch('/api/accounts/sales/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { alert(d?.error || 'Bulk delete failed'); return }
      const skippedLine = d?.skipped?.length ? `\n\nSkipped ${d.skipped.length} (non-Journal or missing).` : ''
      const failedLine = d?.failed?.length
        ? `\n\nTally delete failed for ${d.failed.length}:\n${d.failed.slice(0, 5).map((f: any) => `  #${f.vchNumber}: ${f.reason}`).join('\n')}${d.failed.length > 5 ? `\n  ...and ${d.failed.length - 5} more` : ''}`
        : ''
      alert(`Deleted ${d.deletedCount} of ${d.requested}.${skippedLine}${failedLine}`)
      setSelectedIds(new Set())
      mutate()
    } finally {
      setBulkDeleting(false)
    }
  }

  async function shareWhatsApp() {
    if (!shareRef.current || !data?.ledger) return
    setSharing(true)
    try {
      const html2canvas = (await import('html2canvas')).default
      // onclone runs against a deep clone of the document — strip the
      // `dark` class on <html> there so all dark:* Tailwind classes
      // resolve to their light fallbacks for the captured PNG without
      // touching the user's live UI.
      const canvas = await html2canvas(shareRef.current, {
        backgroundColor: '#ffffff',
        scale: 2,
        onclone: (clonedDoc) => {
          clonedDoc.documentElement.classList.remove('dark')
          // Mark the clone so the global .no-share rule hides the
          // checkboxes / ✕ buttons only in the rendered PNG.
          clonedDoc.documentElement.classList.add('share-export')
        },
      })
      canvas.toBlob(async blob => {
        if (!blob) return
        const file = new File([blob], `Ledger-${data.ledger?.name}-${dateFrom}-to-${dateTo}.png`, { type: 'image/png' })
        if (typeof navigator !== 'undefined' && (navigator as any).canShare?.({ files: [file] })) {
          try { await (navigator as any).share({ files: [file], title: `Ledger ${data.ledger?.name}` }); return } catch {}
        }
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url; a.download = file.name; a.click()
        URL.revokeObjectURL(url)
      }, 'image/png')
    } finally { setSharing(false) }
  }

  function exportExcel() {
    if (!data?.ledger) return
    import('xlsx').then(XLSX => {
      const obRow = dateFrom ? [{
        Date: fmtDateSlash(dateFrom),
        Type: 'Opening Balance',
        'Voucher No': '',
        Particulars: `As of ${fmtDateSlash(dateFrom)}`,
        Debit: opening > 0 ? opening : '',
        Credit: opening < 0 ? -opening : '',
        Balance: opening,
      }] : []
      const rows = [...obRow, ...statement.map(r => ({
        Date: fmtDateSlash(r.date),
        Type: r.vchType ?? '',
        'Voucher No': r.vchNumber ?? '',
        Particulars: r.narration ?? '',
        Debit: r.debit || '',
        Credit: r.credit || '',
        Balance: r.balance,
      }))]
      const ws = XLSX.utils.json_to_sheet(rows)
      ws['!cols'] = [{ wch: 11 }, { wch: 12 }, { wch: 18 }, { wch: 36 }, { wch: 12 }, { wch: 12 }, { wch: 14 }]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Statement')
      XLSX.writeFile(wb, `Ledger-${data.ledger?.name}-${dateFrom}-to-${dateTo}.xlsx`)
    })
  }

  return (
    <div className="max-w-3xl mx-auto p-3">
      <div className="flex items-center gap-2 mb-3">
        <BackButton fallback="/accounts" />
        <h1 className="text-base font-bold text-gray-800 dark:text-gray-100">Party Ledger</h1>
      </div>

      {/* Party + Date controls */}
      <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl p-3 mb-3 space-y-2.5">
        <div className="relative">
          <label className="text-[10px] text-gray-500 dark:text-gray-400 block mb-0.5">Party</label>
          <input
            value={partyDropdownOpen ? partyQuery : (partyName || '')}
            placeholder="Search ledger by name / GSTIN…"
            onFocus={() => { setPartyDropdownOpen(true); setPartyQuery('') }}
            onChange={e => { setPartyQuery(e.target.value); setPartyDropdownOpen(true) }}
            onBlur={() => setTimeout(() => setPartyDropdownOpen(false), 150)}
            className="w-full px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 text-sm"
          />
          {partyDropdownOpen && partyOptions.length > 0 && (
            <div className="absolute z-30 mt-1 w-full max-h-72 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg">
              {partyOptions.map(l => (
                <button key={l.id}
                  onMouseDown={e => { e.preventDefault(); setPartyName(l.name); setPartyQuery(''); setPartyDropdownOpen(false) }}
                  className="block w-full text-left px-2.5 py-1.5 text-sm hover:bg-indigo-50 dark:hover:bg-indigo-900/30 border-b border-gray-100 dark:border-gray-700 last:border-b-0">
                  <div className="font-medium text-gray-800 dark:text-gray-100 break-words">{l.name}</div>
                  <div className="text-[10px] text-gray-500 dark:text-gray-400 flex flex-wrap gap-2">
                    {l.parent && <span>{l.parent}</span>}
                    {l.gstNo && <span className="font-mono">GST: {l.gstNo}</span>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="text-[10px] text-gray-500 dark:text-gray-400 mb-1">Range</div>
          <div className="flex flex-wrap gap-1.5">
            {([
              ['fy-current', currentFY().label],
              ['fy-prior', priorFY().label],
              ['this-month', thisMonth().label],
              ['last-month', lastMonth().label],
              ['custom', 'Custom'],
            ] as [Preset, string][]).map(([k, lbl]) => (
              <button key={k} onClick={() => applyPreset(k)}
                className={`text-[11px] px-2.5 py-1 rounded-full border transition ${
                  preset === k
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'
                }`}>
                {lbl}
              </button>
            ))}
          </div>
          {preset === 'custom' && (
            <div className="flex flex-wrap items-center gap-1.5 mt-2 text-[11px]">
              <span className="text-gray-500 dark:text-gray-400">From</span>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                className="px-1.5 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
              <span className="text-gray-500 dark:text-gray-400">to</span>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                className="px-1.5 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
            </div>
          )}
        </div>
      </div>

      {!partyName && <div className="text-center text-sm text-gray-400 dark:text-gray-500 py-8">Pick a party to view the ledger.</div>}
      {partyName && isLoading && <div className="text-center text-sm text-gray-400 dark:text-gray-500 py-8">Loading ledger…</div>}

      {partyName && data && (
        <>
          {/* Type filter pills */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            {ALL_TYPE_PILLS.map(t => {
              const count = t === 'All' ? (data.vouchers?.length ?? 0) : (typeCounts.get(t) ?? 0)
              if (t !== 'All' && count === 0) return null
              return (
                <button key={t} onClick={() => setTypeFilter(t)}
                  className={`text-[11px] px-2.5 py-1 rounded-full border transition ${
                    typeFilter === t
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'
                  }`}>
                  {t} <span className={typeFilter === t ? 'text-indigo-100' : 'text-gray-400 dark:text-gray-500'}>({count})</span>
                </button>
              )
            })}
          </div>

          {/* Statement — share canvas. On-screen follows the theme; at
              PNG-capture time we strip the `dark` class on the cloned
              document so the exported sheet is always white. */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl mb-3 overflow-hidden">
            <div ref={shareRef} className="bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 p-3">
              {/* Header — party info + date range */}
              <div className="flex items-start justify-between gap-2 mb-2 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="text-base font-bold break-words">{data.ledger?.name ?? partyName}</div>
                  <div className="text-[10px] text-gray-600 dark:text-gray-400 space-y-0.5 mt-0.5">
                    {data.ledger?.gstNo && <div>GSTIN: <span className="font-mono">{data.ledger.gstNo}</span></div>}
                    {data.ledger?.address && <div className="break-words">{data.ledger.address}</div>}
                    {data.ledger?.mobileNos && <div>📞 {data.ledger.mobileNos}</div>}
                  </div>
                </div>
                <div className="text-right text-[10px] text-gray-600 dark:text-gray-400 shrink-0">
                  <div>Ledger Statement</div>
                  <div>{fmtDateSlash(dateFrom)} — {fmtDateSlash(dateTo)}</div>
                  {typeFilter !== 'All' && <div className="text-indigo-700 dark:text-indigo-400">Filter: {typeFilter}</div>}
                </div>
              </div>

              {/* Totals row */}
              <div className="grid grid-cols-4 gap-2 text-center text-[10px] my-2 border-y border-gray-200 dark:border-gray-700 py-1.5">
                <div>
                  <div className="text-gray-500 dark:text-gray-400 uppercase">Opening</div>
                  <div className={`font-bold tabular-nums ${totals.opening >= 0 ? 'text-rose-700 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
                    ₹{fmtMoney(totals.opening)} <span className="text-[9px] text-gray-500 dark:text-gray-400">{totals.opening >= 0 ? 'Dr' : 'Cr'}</span>
                  </div>
                </div>
                <div>
                  <div className="text-gray-500 dark:text-gray-400 uppercase">Σ Debit</div>
                  <div className="font-bold tabular-nums">₹{fmtMoney(totals.dr)}</div>
                </div>
                <div>
                  <div className="text-gray-500 dark:text-gray-400 uppercase">Σ Credit</div>
                  <div className="font-bold tabular-nums">₹{fmtMoney(totals.cr)}</div>
                </div>
                <div>
                  <div className="text-gray-500 dark:text-gray-400 uppercase">Closing</div>
                  <div className={`font-bold tabular-nums ${totals.closing >= 0 ? 'text-rose-700 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
                    ₹{fmtMoney(totals.closing)} <span className="text-[9px] text-gray-500 dark:text-gray-400">{totals.closing >= 0 ? 'Dr' : 'Cr'}</span>
                  </div>
                </div>
              </div>

              {/* Desktop table */}
              <div className="hidden sm:block">
                <table className="w-full text-[11px]" style={{ borderCollapse: 'collapse' }}>
                  <thead>
                    <tr className="border-b-2 border-black dark:border-gray-500">
                      <th className="px-1 py-1 text-center text-[10px] uppercase no-share w-6">
                        {selectableIds.length > 0 && (
                          <input type="checkbox" checked={allSelected} onChange={toggleSelectAll}
                            title={allSelected ? 'Clear selection' : `Select all ${selectableIds.length} Journal rows`}
                            className="accent-rose-600 cursor-pointer" />
                        )}
                      </th>
                      <th className="px-1.5 py-1 text-left text-[10px] uppercase">Date</th>
                      <th className="px-1.5 py-1 text-left text-[10px] uppercase">Type</th>
                      <th className="px-1.5 py-1 text-left text-[10px] uppercase">Vch No</th>
                      <th className="px-1.5 py-1 text-left text-[10px] uppercase">Particulars</th>
                      <th className="px-1.5 py-1 text-right text-[10px] uppercase">Debit</th>
                      <th className="px-1.5 py-1 text-right text-[10px] uppercase">Credit</th>
                      <th className="px-1.5 py-1 text-right text-[10px] uppercase">Balance</th>
                      <th className="px-1.5 py-1 text-right text-[10px] uppercase no-share">·</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Synthetic OB row — always rendered when an opening
                        balance is known (even zero, for clarity). Not
                        selectable, no delete action. Amber tint sets it
                        apart from the data rows below. */}
                    {dateFrom && (
                      <tr className="bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-700/40">
                        <td className="px-1 py-1 no-share" />
                        <td className="px-1.5 py-1 whitespace-nowrap text-amber-800 dark:text-amber-300 font-semibold">{fmtDateSlash(dateFrom)}</td>
                        <td className="px-1.5 py-1 whitespace-nowrap font-semibold text-amber-800 dark:text-amber-300">Opening Balance</td>
                        <td className="px-1.5 py-1">—</td>
                        <td className="px-1.5 py-1 text-amber-700 dark:text-amber-400 text-[10px]">
                          As of {fmtDateSlash(dateFrom)}
                          {typeFilter !== 'All' && <span className="ml-1 italic">(all voucher types)</span>}
                        </td>
                        <td className="px-1.5 py-1 text-right tabular-nums font-semibold">
                          {opening > 0 ? `₹${fmtMoney(opening)}` : '—'}
                        </td>
                        <td className="px-1.5 py-1 text-right tabular-nums font-semibold">
                          {opening < 0 ? `₹${fmtMoney(opening)}` : '—'}
                        </td>
                        <td className="px-1.5 py-1 text-right tabular-nums font-bold">
                          ₹{fmtMoney(opening)} <span className="text-[9px] text-gray-500 dark:text-gray-400">{opening >= 0 ? 'Dr' : 'Cr'}</span>
                        </td>
                        <td className="px-1.5 py-1 text-right no-share" />
                      </tr>
                    )}
                    {statement.length === 0 ? (
                      <tr><td colSpan={9} className="text-center text-gray-400 dark:text-gray-500 py-3">No vouchers in range.</td></tr>
                    ) : statement.map(r => {
                      const isJournal = r.source === 'sales' && r.vchType === 'Journal'
                      const isSelected = isJournal && selectedIds.has(r.id)
                      return (
                      <tr key={`${r.source}-${r.id}`}
                        className={`border-b border-gray-100 dark:border-gray-800 ${isSelected ? 'bg-rose-50 dark:bg-rose-900/30' : ''}`}>
                        <td className="px-1 py-1 text-center no-share">
                          {isJournal && (
                            <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(r.id)}
                              className="accent-rose-600 cursor-pointer" />
                          )}
                        </td>
                        <td className="px-1.5 py-1 whitespace-nowrap">{fmtDateSlash(r.date)}</td>
                        <td className="px-1.5 py-1 whitespace-nowrap">
                          {r.vchType ?? '—'}
                          {r.isOpeningBalance && <span className="ml-1 text-[8px] font-bold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/40 px-1 rounded">OB</span>}
                        </td>
                        <td className="px-1.5 py-1 font-mono whitespace-nowrap">{r.vchNumber ?? '—'}</td>
                        <td className="px-1.5 py-1 break-words text-gray-700 dark:text-gray-300" style={{ maxWidth: 200 }} title={r.narration ?? ''}>
                          {r.narration ?? '—'}
                        </td>
                        <td className="px-1.5 py-1 text-right tabular-nums">{r.debit ? `₹${fmtMoney(r.debit)}` : '—'}</td>
                        <td className="px-1.5 py-1 text-right tabular-nums">{r.credit ? `₹${fmtMoney(r.credit)}` : '—'}</td>
                        <td className="px-1.5 py-1 text-right tabular-nums font-semibold">
                          ₹{fmtMoney(r.balance)} <span className="text-[9px] text-gray-500 dark:text-gray-400">{r.balance >= 0 ? 'Dr' : 'Cr'}</span>
                        </td>
                        <td className="px-1.5 py-1 text-right no-share">
                          {isJournal && (
                            <button onClick={() => deleteJournal(r)} title="Delete Journal voucher"
                              className="text-[10px] text-rose-600 dark:text-rose-400 hover:text-rose-800 dark:hover:text-rose-300 font-bold">✕</button>
                          )}
                        </td>
                      </tr>
                    )})}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="sm:hidden divide-y divide-gray-100 dark:divide-gray-800">
                {dateFrom && (
                  <div className="py-2 px-2 -mx-2 bg-amber-50 dark:bg-amber-900/20 flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] font-semibold text-amber-800 dark:text-amber-300">Opening Balance</div>
                      <div className="text-[10px] text-amber-700 dark:text-amber-400">
                        As of {fmtDateSlash(dateFrom)}
                        {typeFilter !== 'All' && <span className="ml-1 italic">(all types)</span>}
                      </div>
                    </div>
                    <div className="font-bold tabular-nums text-sm">
                      ₹{fmtMoney(opening)} <span className="text-[9px] text-gray-500 dark:text-gray-400">{opening >= 0 ? 'Dr' : 'Cr'}</span>
                    </div>
                  </div>
                )}
                {selectableIds.length > 0 && (
                  <div className="py-2 flex items-center gap-2 text-[10px] no-share">
                    <input type="checkbox" checked={allSelected} onChange={toggleSelectAll}
                      className="accent-rose-600 cursor-pointer" />
                    <span className="text-gray-500 dark:text-gray-400">Select all {selectableIds.length} Journal {selectableIds.length === 1 ? 'row' : 'rows'}</span>
                  </div>
                )}
                {statement.length === 0 ? (
                  <div className="text-center text-gray-400 dark:text-gray-500 py-3 text-xs">No vouchers in range.</div>
                ) : statement.map(r => {
                  const isJournal = r.source === 'sales' && r.vchType === 'Journal'
                  const isSelected = isJournal && selectedIds.has(r.id)
                  return (
                  <div key={`${r.source}-${r.id}`}
                    className={`py-2 flex items-start gap-2 ${isSelected ? 'bg-rose-50 dark:bg-rose-900/30' : ''}`}>
                    {isJournal && (
                      <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(r.id)}
                        className="mt-1 accent-rose-600 cursor-pointer shrink-0 no-share" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                        <span className="text-[10px] text-gray-500 dark:text-gray-400">{fmtDateSlash(r.date)}</span>
                        <span className="text-[10px] font-mono bg-indigo-100 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-300 px-1.5 py-0.5 rounded">
                          {r.vchType ?? '—'}
                        </span>
                        {r.isOpeningBalance && <span className="text-[8px] font-bold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/40 px-1 rounded">OB</span>}
                        {r.vchNumber && <span className="text-[10px] font-mono text-gray-600 dark:text-gray-400 break-all">{r.vchNumber}</span>}
                      </div>
                      {r.narration && (
                        <div className="text-[10px] text-gray-600 dark:text-gray-400 break-words leading-tight">{r.narration}</div>
                      )}
                      <div className="flex items-center gap-3 mt-1 text-[10px]">
                        {r.debit > 0 && <span className="text-rose-700 dark:text-rose-400"><span className="text-gray-400 dark:text-gray-500">Dr</span> ₹{fmtMoney(r.debit)}</span>}
                        {r.credit > 0 && <span className="text-emerald-700 dark:text-emerald-400"><span className="text-gray-400 dark:text-gray-500">Cr</span> ₹{fmtMoney(r.credit)}</span>}
                        <span className="ml-auto font-bold tabular-nums">
                          ₹{fmtMoney(r.balance)} <span className="text-[9px] text-gray-500 dark:text-gray-400">{r.balance >= 0 ? 'Dr' : 'Cr'}</span>
                        </span>
                      </div>
                    </div>
                    {isJournal && (
                      <button onClick={() => deleteJournal(r)} title="Delete Journal"
                        className="text-rose-600 dark:text-rose-400 hover:text-rose-800 dark:hover:text-rose-300 text-sm font-bold shrink-0 no-share">✕</button>
                    )}
                  </div>
                )})}
              </div>

              <div className="text-[9px] text-gray-500 dark:text-gray-400 mt-2 text-center">
                {statement.length} entries in range + opening · Dr = party owes us · Cr = party paid / credit-noted
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 justify-end">
            <button onClick={exportExcel}
              className="px-3 py-1.5 rounded-lg border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-xs font-semibold">
              📥 Excel
            </button>
            <button onClick={shareWhatsApp} disabled={sharing}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold">
              {sharing ? 'Rendering…' : '📤 Share PNG'}
            </button>
          </div>

          {/* Floating bulk-delete bar — only shows when at least one Journal is ticked. */}
          {selectedIds.size > 0 && (
            <div className="fixed bottom-3 left-3 right-3 z-40 max-w-3xl mx-auto bg-rose-600 text-white rounded-xl shadow-2xl px-3 py-2.5 flex items-center gap-2">
              <div className="flex-1 text-xs font-semibold">
                {selectedIds.size} Journal {selectedIds.size === 1 ? 'voucher' : 'vouchers'} selected
              </div>
              <button onClick={() => setSelectedIds(new Set())}
                className="text-[11px] px-2 py-1 rounded-md bg-white/20 hover:bg-white/30 font-medium">
                Clear
              </button>
              <button onClick={bulkDeleteJournals} disabled={bulkDeleting}
                className="text-[11px] px-3 py-1.5 rounded-md bg-white text-rose-700 hover:bg-rose-50 disabled:opacity-60 font-bold">
                {bulkDeleting ? 'Deleting…' : `Delete ${selectedIds.size}`}
              </button>
            </div>
          )}

          {/* .no-share controls are part of the share canvas (so layout
              doesn't jump), but they get hidden inside the cloned PNG
              via the html-clone hook below. */}
          <style jsx global>{`
            html.share-export .no-share { display: none !important; }
          `}</style>
        </>
      )}
    </div>
  )
}

function useDebounce<T>(value: T, delay = 250): T {
  const [d, setD] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setD(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return d
}
