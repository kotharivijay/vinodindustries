'use client'

import { useState, useMemo, useEffect } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import BackButton from '../../BackButton'
import { computeInvoiceTotals } from '@/lib/inv/invoice-totals'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const STATUSES = ['Draft', 'PendingInvoice', 'Invoiced', 'Returned', 'CashPaid', 'Cancelled']
const TERMINAL_STATUSES = new Set(['Invoiced', 'Returned', 'CashPaid', 'Cancelled'])
const ACTIONS_PILL_KEY = 'ksi:invChallans:actionsOn'
const SORT_KEY = 'ksi:invChallans:sortBy'

type SortBy =
  | 'challan-desc' | 'challan-asc'
  | 'date-desc' | 'date-asc'
  | 'party-asc' | 'party-desc'
  | 'item-asc' | 'item-desc'

const SORT_OPTIONS: [SortBy, string][] = [
  ['challan-desc', 'Challan ↓'],
  ['challan-asc', 'Challan ↑'],
  ['date-desc', 'Date ↓'],
  ['date-asc', 'Date ↑'],
  ['party-asc', 'Party A→Z'],
  ['party-desc', 'Party Z→A'],
  ['item-asc', 'Item A→Z'],
  ['item-desc', 'Item Z→A'],
]

interface Item { id: number; displayName: string; alias: { id: number; tallyStockItem: string; gstRate: string | number } }
interface Line {
  id: number
  lineNo: number
  qty: string
  unit: string
  rate: string | null
  gstRate: string | null
  discountType: string | null
  discountValue: string | null
  discountAmount: string | null
  grossAmount: string | null
  amount: string | null
  gstAmount: string | null
  totalWithGst: string | null
  notes: string | null
  returnedQty: string | null
  item: Item
}
interface Challan {
  id: number
  partyId: number
  internalSeriesNo: number
  seriesFy: string
  challanNo: string
  challanDate: string
  status: string
  ratesIncludeGst: boolean
  totalQty: string | null
  totalAmount: string | null
  totalGstAmount: string | null
  totalWithGst: string | null
  hasRatelessLines: boolean
  hasPendingReviewItems: boolean
  returnReason: string | null
  cashPaidDate: string | null
  cashPaidNote: string | null
  party: { id: number; displayName: string; parentGroup: string | null; state: string | null; gstRegistrationType: string }
  lines: Line[]
  invoiceLink: { invoiceId: number } | null
}

function fmtMoney(v: string | number | null | undefined): string {
  const n = v == null ? 0 : Number(v)
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function ChallansListPage() {
  const router = useRouter()
  const [status, setStatus] = useState<string>('')
  const [search, setSearch] = useState('')
  const qs = new URLSearchParams()
  if (status) qs.set('status', status)
  if (search) qs.set('q', search)
  const { data: challans = [], isLoading, mutate } = useSWR<Challan[]>(
    `/api/inv/challans?${qs.toString()}`, fetcher,
  )

  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [selected, setSelected] = useState<Set<number>>(new Set())
  // Hide invoiced challans by default — they're rarely the working set
  const [hideInvoiced, setHideInvoiced] = useState(true)
  // Actions pill — when ON, a ⋯ menu appears on each card with Return /
  // Cash Paid / Cancel. OFF by default so the list stays read-friendly.
  const [actionsOn, setActionsOn] = useState(false)
  const [sortBy, setSortBy] = useState<SortBy>('challan-desc')
  useEffect(() => {
    try {
      const saved = localStorage.getItem('inv-challans-hide-invoiced')
      if (saved !== null) setHideInvoiced(saved === 'true')
      const savedActions = localStorage.getItem(ACTIONS_PILL_KEY)
      if (savedActions !== null) setActionsOn(savedActions === 'true')
      const savedSort = localStorage.getItem(SORT_KEY)
      if (savedSort && SORT_OPTIONS.some(([k]) => k === savedSort)) setSortBy(savedSort as SortBy)
    } catch {}
  }, [])
  useEffect(() => {
    try { localStorage.setItem('inv-challans-hide-invoiced', String(hideInvoiced)) } catch {}
  }, [hideInvoiced])
  useEffect(() => {
    try { localStorage.setItem(ACTIONS_PILL_KEY, String(actionsOn)) } catch {}
  }, [actionsOn])
  useEffect(() => {
    try { localStorage.setItem(SORT_KEY, sortBy) } catch {}
  }, [sortBy])

  const visibleChallans = useMemo(() => {
    const filtered = hideInvoiced ? challans.filter(c => c.status !== 'Invoiced') : challans
    // Challan sort: extract the TRAILING run of digits as the number, ignore
    // the prefix during numeric comparison ("AB-100" sorts as 100, not 0).
    // Prefix is only used as a tie-breaker so AB-100 vs XY-100 stay grouped
    // by series. First-line item name drives the Item sort.
    const challanNumber = (c: Challan) => {
      const matches = String(c.challanNo ?? '').match(/\d+/g)
      return matches?.length ? parseInt(matches[matches.length - 1], 10) : 0
    }
    const challanPrefix = (c: Challan) =>
      String(c.challanNo ?? '').replace(/\d+(?!.*\d)/, '').toLowerCase()
    const partyKey = (c: Challan) => (c.party.displayName || '').toLowerCase()
    const itemKey = (c: Challan) => (c.lines[0]?.item?.displayName || '').toLowerCase()
    const dateKey = (c: Challan) => new Date(c.challanDate).getTime()

    const sorted = [...filtered]
    switch (sortBy) {
      case 'challan-desc': sorted.sort((a, b) =>
        challanNumber(b) - challanNumber(a)
        || challanPrefix(a).localeCompare(challanPrefix(b))
        || b.id - a.id); break
      case 'challan-asc':  sorted.sort((a, b) =>
        challanNumber(a) - challanNumber(b)
        || challanPrefix(a).localeCompare(challanPrefix(b))
        || a.id - b.id); break
      case 'date-desc':    sorted.sort((a, b) => dateKey(b) - dateKey(a) || b.id - a.id); break
      case 'date-asc':     sorted.sort((a, b) => dateKey(a) - dateKey(b) || a.id - b.id); break
      case 'party-asc':    sorted.sort((a, b) => partyKey(a).localeCompare(partyKey(b)) || dateKey(b) - dateKey(a)); break
      case 'party-desc':   sorted.sort((a, b) => partyKey(b).localeCompare(partyKey(a)) || dateKey(b) - dateKey(a)); break
      case 'item-asc':     sorted.sort((a, b) => itemKey(a).localeCompare(itemKey(b)) || dateKey(b) - dateKey(a)); break
      case 'item-desc':    sorted.sort((a, b) => itemKey(b).localeCompare(itemKey(a)) || dateKey(b) - dateKey(a)); break
    }
    return sorted
  }, [challans, hideInvoiced, sortBy])
  const invoicedCount = useMemo(
    () => challans.filter(c => c.status === 'Invoiced').length,
    [challans],
  )
  function toggleExpand(id: number) {
    setExpanded(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }
  function toggleSelect(id: number) {
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }

  // Same-party invariant for multi-select
  const selectedChallans = useMemo(
    () => challans.filter(c => selected.has(c.id)),
    [challans, selected],
  )
  const selectedPartyId = selectedChallans[0]?.partyId ?? null
  const selectedTotals = useMemo(() => {
    let qty = 0, amount = 0, gst = 0, total = 0
    for (const c of selectedChallans) {
      qty += Number(c.totalQty ?? 0)
      amount += Number(c.totalAmount ?? 0)
      gst += Number(c.totalGstAmount ?? 0)
      total += Number(c.totalWithGst ?? 0)
    }
    return { qty, amount, gst, total }
  }, [selectedChallans])

  // Drop selection if a card disappears or changes party
  useEffect(() => {
    setSelected(prev => {
      const next = new Set<number>()
      for (const id of prev) {
        const c = challans.find(c => c.id === id)
        if (!c || c.status === 'Invoiced' || c.invoiceLink) continue
        if (selectedPartyId != null && c.partyId !== selectedPartyId) continue
        next.add(id)
      }
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challans])

  function clearSelection() { setSelected(new Set()) }

  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false)
  function openInvoiceModal() {
    if (selected.size === 0) return
    setInvoiceModalOpen(true)
  }

  return (
    <div className="p-4 md:p-8 max-w-6xl pb-24">
      <div className="flex items-center gap-3 mb-5">
        <BackButton />
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Inward Challans</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {visibleChallans.length} of {challans.length} matching
          </p>
        </div>
        <Link href="/inventory/challans/new"
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-semibold">
          + New
        </Link>
      </div>

      <div className="flex flex-wrap gap-2 mb-5">
        <button onClick={() => setStatus('')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
            !status ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300'}`}>
          All
        </button>
        {STATUSES.map(s => (
          <button key={s} onClick={() => setStatus(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
              status === s ? 'bg-indigo-600 text-white border-indigo-600'
                           : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300'}`}>
            {s}
          </button>
        ))}
        {invoicedCount > 0 && (
          <button onClick={() => setHideInvoiced(v => !v)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
              hideInvoiced
                ? 'bg-purple-100 dark:bg-purple-900/40 border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300'
                : 'bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400'
            }`}>
            {hideInvoiced ? `Hide Invoiced (${invoicedCount})` : 'Show All'}
          </button>
        )}
        <button onClick={() => setActionsOn(v => !v)}
          title={actionsOn ? 'Click ⋯ on a card to Return / Cash Paid / Cancel' : 'Enable per-card action menus'}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
            actionsOn
              ? 'bg-amber-100 dark:bg-amber-900/40 border-amber-400 dark:border-amber-700 text-amber-800 dark:text-amber-200'
              : 'bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400'
          }`}>
          {actionsOn ? '⚙ Actions: ON' : '⚙ Actions'}
        </button>
        <input type="search" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search challan, party, item, alias, tag, invoice no…"
          className="flex-1 min-w-[260px] px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs" />
      </div>

      {/* Sort row — default Challan ↓ */}
      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        <span className="text-[10px] text-gray-500 dark:text-gray-400 mr-1">Sort:</span>
        {SORT_OPTIONS.map(([key, label]) => (
          <button key={key} onClick={() => setSortBy(key)}
            className={`text-[11px] px-2.5 py-1 rounded-full border transition ${
              sortBy === key
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {isLoading ? <div className="p-12 text-center text-gray-400">Loading…</div>
        : !visibleChallans.length ? (
          <div className="p-12 text-center text-gray-400">
            {challans.length === 0
              ? 'No challans yet.'
              : `All ${challans.length} matching challans are invoiced — toggle "Show All" to view.`}
          </div>
        ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibleChallans.map(c => (
            <ChallanCard
              key={c.id}
              challan={c}
              expanded={expanded.has(c.id)}
              onToggleExpand={() => toggleExpand(c.id)}
              selected={selected.has(c.id)}
              onToggleSelect={() => toggleSelect(c.id)}
              selectableForParty={selectedPartyId == null || selectedPartyId === c.partyId}
              onChange={updated => {
                // SWR cache patch — replace this challan in the list
                mutate(prev => prev?.map(p => p.id === updated.id ? { ...p, ...updated } : p), { revalidate: false })
              }}
              actionsOn={actionsOn}
              onAfterStatusChange={() => mutate()}
            />
          ))}
        </div>
      )}

      {selected.size > 0 && (
        <div className="fixed bottom-4 left-4 right-4 z-40 max-w-5xl mx-auto bg-gray-900 text-gray-100 rounded-xl shadow-2xl border border-indigo-500/40 px-4 py-3 flex items-center gap-3">
          <div className="flex-1 min-w-0 text-sm">
            <span className="font-semibold">{selected.size} challan{selected.size === 1 ? '' : 's'} selected</span>
            {selectedChallans[0] && (
              <span className="text-gray-400"> · {selectedChallans[0].party.displayName}</span>
            )}
            <span className="ml-3 text-xs text-gray-400">
              Qty {selectedTotals.qty.toLocaleString('en-IN')} · ₹{fmtMoney(selectedTotals.total)}
            </span>
          </div>
          <button onClick={clearSelection}
            className="text-xs text-gray-300 hover:text-white px-3 py-1.5 rounded-lg border border-gray-600">
            Clear
          </button>
          <button onClick={openInvoiceModal}
            className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-1.5 rounded-lg text-sm font-semibold">
            Create Purchase Invoice
          </button>
        </div>
      )}

      {invoiceModalOpen && selectedChallans.length > 0 && (
        <CreateInvoiceModal
          challans={selectedChallans}
          onClose={() => setInvoiceModalOpen(false)}
          onCreated={invoiceId => {
            setInvoiceModalOpen(false)
            clearSelection()
            mutate()
            router.push(`/inventory/invoices/${invoiceId}`)
          }}
        />
      )}
    </div>
  )
}

function CreateInvoiceModal(props: {
  challans: Challan[]
  onClose: () => void
  onCreated: (invoiceId: number) => void
}) {
  const { challans, onClose, onCreated } = props
  const party = challans[0].party
  const today = new Date().toISOString().slice(0, 10)

  const [supplierInvoiceNo, setInvNo] = useState('')
  const [supplierInvoiceDate, setInvDate] = useState(today)
  const [freightAmount, setFreight] = useState('')
  const [otherCharges, setOther] = useState('')
  const [discountAmount, setDiscount] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const freight = Number(freightAmount) || 0
  const other = Number(otherCharges) || 0
  const discount = Number(discountAmount) || 0

  // Flatten all selected challans' lines into the invoice payload.
  // Effective qty = qty - returnedQty (partial returns leave the rest invoiceable).
  // gstRate falls back to alias when the line itself has no stored rate.
  const lines = useMemo(() => challans.flatMap(c => c.lines
    .map(l => {
      const effectiveQty = Number(l.qty) - Number(l.returnedQty ?? 0)
      return { l, effectiveQty }
    })
    .filter(x => x.effectiveQty > 0)
    .map(({ l, effectiveQty }) => ({
      itemId: l.item.id,
      description: l.item.displayName,
      qty: String(effectiveQty),
      unit: l.unit,
      rate: l.rate,
      gstRate: l.gstRate ?? (l.item?.alias?.gstRate != null ? String(Number(l.item.alias.gstRate)) : null),
      discountAmount: l.discountAmount,
      challanLineId: l.id,
    }))
  ), [challans])

  // Recompute totals client-side using the same helper the server uses.
  const isIntra = (party.state || '').toLowerCase() === 'rajasthan'
  const isUnreg = ['Unregistered', 'Composition'].includes(party.gstRegistrationType || '')
  const linesForCalc = useMemo(() =>
    lines.map(l => {
      const qty = Number(l.qty || 0)
      const rate = Number(l.rate || 0)
      const lineDisc = Number(l.discountAmount || 0)
      return { amount: qty * rate - lineDisc, gstRate: Number(l.gstRate || 0) }
    }),
  [lines])
  const calc = useMemo(() => computeInvoiceTotals(linesForCalc, freight, discount, isIntra, isUnreg),
    [linesForCalc, freight, discount, isIntra, isUnreg])
  const grandTotal = calc.total + other

  async function save() {
    if (!supplierInvoiceNo.trim() || !supplierInvoiceDate) {
      setError('Supplier Invoice No and Date are required.')
      return
    }
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/inv/invoices', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partyId: party.id,
          supplierInvoiceNo: supplierInvoiceNo.trim(),
          supplierInvoiceDate,
          challanIds: challans.map(c => c.id),
          lines,
          freightAmount: freight, otherCharges: other, discountAmount: discount,
          notes: notes || null,
        }),
      })
      const d = await res.json()
      if (!res.ok) { setError(d.error || `Save failed (${res.status})`); return }
      onCreated(d.id)
    } catch (e: any) {
      setError(e?.message || 'Save failed')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto"
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl my-6">
        <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-gray-800 dark:text-gray-100">Create Purchase Invoice</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {party.displayName} · {challans.length} challan{challans.length === 1 ? '' : 's'}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg">✕</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Selected challans summary */}
          <div className="bg-gray-50 dark:bg-gray-900/40 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
            <p className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">Selected challans</p>
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              {challans.map(c => (
                <span key={c.id} className="font-mono bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded">
                  KSI/IN/{c.seriesFy}/{String(c.internalSeriesNo).padStart(4, '0')}
                </span>
              ))}
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <label className="block text-xs">
              <span className="text-gray-500 dark:text-gray-400">Supplier Invoice No *</span>
              <input value={supplierInvoiceNo} onChange={e => setInvNo(e.target.value)} autoFocus
                className="mt-0.5 w-full px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
            </label>
            <label className="block text-xs">
              <span className="text-gray-500 dark:text-gray-400">Invoice Date *</span>
              <input type="date" value={supplierInvoiceDate} onChange={e => setInvDate(e.target.value)}
                className="mt-0.5 w-full px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
            </label>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <label className="block text-xs">
              <span className="text-gray-500 dark:text-gray-400">Freight</span>
              <input type="number" step="0.01" value={freightAmount} onChange={e => setFreight(e.target.value)}
                className="mt-0.5 w-full px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
            </label>
            <label className="block text-xs">
              <span className="text-gray-500 dark:text-gray-400">Other charges</span>
              <input type="number" step="0.01" value={otherCharges} onChange={e => setOther(e.target.value)}
                className="mt-0.5 w-full px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
            </label>
            <label className="block text-xs">
              <span className="text-gray-500 dark:text-gray-400">Discount</span>
              <input type="number" step="0.01" value={discountAmount} onChange={e => setDiscount(e.target.value)}
                className="mt-0.5 w-full px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
            </label>
          </div>

          <label className="block text-xs">
            <span className="text-gray-500 dark:text-gray-400">Notes</span>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              className="mt-0.5 w-full px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
          </label>

          <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-3 text-sm space-y-1">
            <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Taxable</span><span>₹{fmtMoney(calc.taxable)}</span></div>
            {freight > 0 && (
              <div className="flex justify-between text-gray-500 dark:text-gray-400 text-[11px]">
                <span>+ Freight @ {calc.majorityRate}% GST</span><span>+ ₹{fmtMoney(freight)}</span>
              </div>
            )}
            {discount > 0 && (
              <div className="flex justify-between text-rose-500 dark:text-rose-400 text-[11px]">
                <span>− Discount @ {calc.majorityRate}% GST</span><span>− ₹{fmtMoney(discount)}</span>
              </div>
            )}
            {!isUnreg && isIntra && calc.totalGst > 0 && (
              <>
                <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">CGST</span><span>₹{fmtMoney(calc.cgst)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">SGST</span><span>₹{fmtMoney(calc.sgst)}</span></div>
              </>
            )}
            {!isUnreg && !isIntra && calc.totalGst > 0 && (
              <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">IGST</span><span>₹{fmtMoney(calc.igst)}</span></div>
            )}
            {other > 0 && (
              <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Other (no GST)</span><span>₹{fmtMoney(other)}</span></div>
            )}
            {Math.abs(calc.roundOff) > 0.001 && (
              <div className="flex justify-between text-gray-500 dark:text-gray-400 text-[11px]">
                <span>Round-off</span><span>{calc.roundOff > 0 ? '+' : '−'} ₹{fmtMoney(Math.abs(calc.roundOff))}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-base border-t border-gray-200 dark:border-gray-700 pt-1">
              <span>Total</span><span>₹{fmtMoney(grandTotal)}</span>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 rounded-lg px-3 py-2 text-xs">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <button onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200">
            Cancel
          </button>
          <button onClick={save} disabled={saving}
            className="px-5 py-2 rounded-lg text-sm bg-indigo-600 hover:bg-indigo-700 text-white font-semibold disabled:opacity-50">
            {saving ? 'Saving…' : 'Save Invoice'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ChallanCard(props: {
  challan: Challan
  expanded: boolean
  onToggleExpand: () => void
  selected: boolean
  onToggleSelect: () => void
  selectableForParty: boolean
  onChange: (updated: Challan) => void
  actionsOn: boolean
  onAfterStatusChange: () => void
}) {
  const { challan, expanded, onToggleExpand, selected, onToggleSelect, selectableForParty, onChange, actionsOn, onAfterStatusChange } = props
  const c = challan
  const linked = c.status === 'Invoiced' || !!c.invoiceLink
  const isTerminal = TERMINAL_STATUSES.has(c.status)
  const canSelect = !isTerminal && selectableForParty
  const [menuOpen, setMenuOpen] = useState(false)
  const [returnOpen, setReturnOpen] = useState(false)
  const [cashOpen, setCashOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  // Lines lock when challan is terminal — same as the existing Invoiced lock.
  const lineDisabled = isTerminal

  async function flipRatesIncludeGst() {
    const body = JSON.stringify({ ratesIncludeGst: !c.ratesIncludeGst })
    const res = await fetch(`/api/inv/challans/${c.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body,
    })
    if (res.ok) onChange(await res.json())
  }

  async function patchLine(lineId: number, patch: Record<string, any>) {
    const res = await fetch(`/api/inv/challans/${c.id}/lines/${lineId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (res.ok) onChange(await res.json())
  }

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-xl border transition ${
      selected ? 'border-indigo-500 ring-2 ring-indigo-300/50'
               : 'border-gray-200 dark:border-gray-700'}`}>
      <div className="p-4 flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          disabled={!canSelect}
          onChange={onToggleSelect}
          title={
            linked ? 'Already linked to an invoice'
              : !selectableForParty ? 'A different party is selected'
              : 'Select for batched invoice'
          }
          className="mt-1 h-4 w-4 rounded border-gray-300 disabled:opacity-30"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <Link href={`/inventory/challans/${c.id}`}
              className="text-sm font-mono font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
              KSI/IN/{c.seriesFy}/{String(c.internalSeriesNo).padStart(4, '0')}
            </Link>
            <div className="flex items-center gap-1">
              <StatusBadge status={c.status} />
              {actionsOn && (
                <div className="relative">
                  <button onClick={() => setMenuOpen(v => !v)}
                    className="text-gray-500 hover:text-gray-800 dark:hover:text-gray-100 px-1.5 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 leading-none">
                    ⋯
                  </button>
                  {menuOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                      <div className="absolute right-0 top-full mt-1 z-20 w-44 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden">
                        <MenuItem
                          label="↩ Return lines…"
                          disabled={isTerminal}
                          onClick={() => { setMenuOpen(false); setReturnOpen(true) }}
                        />
                        <MenuItem
                          label="₹ Mark Cash Paid…"
                          disabled={isTerminal || c.lines.some(l => Number(l.returnedQty ?? 0) > 0)}
                          onClick={() => { setMenuOpen(false); setCashOpen(true) }}
                        />
                        <MenuItem
                          label="✕ Cancel challan…"
                          disabled={isTerminal}
                          danger
                          onClick={() => { setMenuOpen(false); setCancelOpen(true) }}
                        />
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">
            {c.party.displayName}
          </p>
          {c.party.parentGroup && (
            <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{c.party.parentGroup}</p>
          )}
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="text-gray-500 dark:text-gray-400">
              {new Date(c.challanDate).toLocaleDateString('en-IN')} · #{c.challanNo}
            </span>
            <button onClick={onToggleExpand}
              className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium">
              {expanded ? 'Hide ▴' : `${c.lines.length} line${c.lines.length === 1 ? '' : 's'} ▾`}
            </button>
          </div>

          {/* Items summary — name + qty/unit + rate (if available). Rate is
              shown only when set; rateless lines (still being filled in)
              just hide the chip so the line doesn't read "@ ₹0". */}
          {c.lines.length > 0 && (
            <ul className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700 space-y-0.5">
              {c.lines.map(l => (
                <li key={l.id} className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="flex-1 min-w-0 break-words text-gray-700 dark:text-gray-300">
                    {l.item.displayName}
                  </span>
                  <span className="shrink-0 font-medium text-gray-600 dark:text-gray-300">
                    {Number(l.qty)} <span className="text-gray-400 dark:text-gray-500">{l.unit}</span>
                    {l.rate != null && l.rate !== '' && Number(l.rate) > 0 && (
                      <span className="text-gray-400 dark:text-gray-500 ml-1">@ ₹{fmtMoney(l.rate)}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-1.5 pt-1.5 border-t border-gray-100 dark:border-gray-700 flex justify-between text-xs">
            <span className="text-gray-500 dark:text-gray-400">Total</span>
            <span className="font-bold text-gray-800 dark:text-gray-100">
              ₹{fmtMoney(c.totalWithGst ?? c.totalAmount)}
            </span>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 dark:border-gray-700 p-3 space-y-3 bg-gray-50/50 dark:bg-gray-900/30 rounded-b-xl">
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-gray-500 dark:text-gray-400">Rates include GST?</span>
            <button onClick={flipRatesIncludeGst} disabled={lineDisabled}
              className={`text-[11px] font-semibold rounded-full px-3 py-0.5 border transition ${
                c.ratesIncludeGst
                  ? 'bg-amber-500 text-white border-amber-500'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600'
              } disabled:opacity-50`}>
              {c.ratesIncludeGst ? 'Yes' : 'No'}
            </button>
          </div>

          <div className="space-y-3">
            {c.lines.map(l => (
              <LineCard key={l.id} line={l} disabled={lineDisabled} onSave={patch => patchLine(l.id, patch)} />
            ))}
          </div>

          <div className="border-t border-gray-200 dark:border-gray-600 pt-2 mt-2 text-[11px] grid grid-cols-2 gap-y-0.5">
            <span className="text-gray-500 dark:text-gray-400">Subtotal (taxable)</span>
            <span className="text-right font-semibold">₹{fmtMoney(c.totalAmount)}</span>
            <span className="text-gray-500 dark:text-gray-400">GST</span>
            <span className="text-right">₹{fmtMoney(c.totalGstAmount)}</span>
            <span className="font-bold text-gray-900 dark:text-gray-50 pt-0.5">Total with GST</span>
            <span className="text-right font-bold text-gray-900 dark:text-gray-50 pt-0.5">₹{fmtMoney(c.totalWithGst)}</span>
          </div>

          {linked && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400">
              Already invoiced — line edits disabled.
            </p>
          )}
          {c.status === 'Returned' && (
            <p className="text-[11px] text-rose-600 dark:text-rose-400">
              Returned — {c.lines.reduce((s, l) => s + Number(l.returnedQty ?? 0), 0)} units sent back.
            </p>
          )}
          {c.status === 'CashPaid' && (
            <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
              Cash Paid{c.cashPaidNote ? ` · ${c.cashPaidNote}` : ''}.
            </p>
          )}
        </div>
      )}

      {returnOpen && (
        <ReturnLinesModal
          challan={c}
          onClose={() => setReturnOpen(false)}
          onDone={() => { setReturnOpen(false); onAfterStatusChange() }}
        />
      )}
      {cashOpen && (
        <CashPaidModal
          challan={c}
          onClose={() => setCashOpen(false)}
          onDone={() => { setCashOpen(false); onAfterStatusChange() }}
        />
      )}
      {cancelOpen && (
        <CancelChallanModal
          challan={c}
          onClose={() => setCancelOpen(false)}
          onDone={() => { setCancelOpen(false); onAfterStatusChange() }}
        />
      )}
    </div>
  )
}

function MenuItem({ label, onClick, disabled, danger }: {
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`w-full text-left px-3 py-2 text-xs font-medium ${
        disabled
          ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
          : danger
            ? 'text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20'
            : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/40'
      }`}>
      {label}
    </button>
  )
}

function ReturnLinesModal({ challan, onClose, onDone }: {
  challan: Challan
  onClose: () => void
  onDone: () => void
}) {
  // Each line: how many to return now? Bounded by (qty - returnedQty).
  const initial = challan.lines.map(l => ({ lineId: l.id, qty: '' }))
  const [rows, setRows] = useState(initial)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const setQty = (i: number, v: string) =>
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, qty: v } : r))

  async function submit() {
    const lines = rows
      .map((r, i) => ({ lineId: r.lineId, qty: Number(r.qty || 0), line: challan.lines[i] }))
      .filter(r => r.qty > 0)
    if (lines.length === 0) { setError('Enter at least one return qty'); return }
    for (const r of lines) {
      const remaining = Number(r.line.qty) - Number(r.line.returnedQty ?? 0)
      if (r.qty > remaining + 0.0001) {
        setError(`Line ${r.line.lineNo}: ${r.qty} exceeds remaining ${remaining}`)
        return
      }
    }
    setSaving(true); setError('')
    const res = await fetch(`/api/inv/challans/${challan.id}/return`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lines: lines.map(r => ({ lineId: r.lineId, qty: r.qty })),
        reason: reason || undefined,
      }),
    })
    setSaving(false)
    if (!res.ok) { setError((await res.json()).error || 'Save failed'); return }
    onDone()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-800 dark:text-gray-100">Return Lines</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg">✕</button>
        </div>
        <div className="p-5 space-y-3 max-h-[60vh] overflow-y-auto">
          {challan.lines.map((l, i) => {
            const already = Number(l.returnedQty ?? 0)
            const remaining = Number(l.qty) - already
            return (
              <div key={l.id} className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{l.item.displayName}</p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">
                  Total {Number(l.qty)} {l.unit}
                  {already > 0 && <span className="text-rose-500"> · already returned {already}</span>}
                  <span> · remaining <strong>{remaining}</strong></span>
                </p>
                {remaining > 0 ? (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-[11px] text-gray-500 dark:text-gray-400">Return now:</span>
                    <input type="number" step="0.001" min={0} max={remaining} value={rows[i].qty}
                      onChange={e => setQty(i, e.target.value)}
                      className="w-28 px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs" />
                    <span className="text-[11px] text-gray-500 dark:text-gray-400">{l.unit}</span>
                    <button type="button" onClick={() => setQty(i, String(remaining))}
                      className="text-[10px] text-indigo-600 dark:text-indigo-400 underline">all</button>
                  </div>
                ) : (
                  <p className="mt-2 text-[11px] text-gray-400">Fully returned.</p>
                )}
              </div>
            )
          })}
          <label className="block text-xs">
            <span className="text-gray-500 dark:text-gray-400">Reason (optional)</span>
            <input value={reason} onChange={e => setReason(e.target.value)}
              placeholder="e.g. damaged, wrong specs"
              className="mt-0.5 w-full px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
          </label>
          {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
        </div>
        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <button onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200">
            Cancel
          </button>
          <button onClick={submit} disabled={saving}
            className="px-5 py-2 rounded-lg text-sm bg-rose-600 hover:bg-rose-700 text-white font-semibold disabled:opacity-50">
            {saving ? 'Saving…' : 'Return'}
          </button>
        </div>
      </div>
    </div>
  )
}

function CashPaidModal({ challan, onClose, onDone }: {
  challan: Challan
  onClose: () => void
  onDone: () => void
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [date, setDate] = useState(today)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    setSaving(true); setError('')
    const res = await fetch(`/api/inv/challans/${challan.id}/cash-paid`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, note: note || undefined }),
    })
    setSaving(false)
    if (!res.ok) { setError((await res.json()).error || 'Save failed'); return }
    onDone()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-800 dark:text-gray-100">Mark Cash Paid</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg">✕</button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            No invoice will be created. Goods stay in stock; no Tally voucher is pushed
            (you can record it manually if needed). This is final — not reversible.
          </p>
          <label className="block text-xs">
            <span className="text-gray-500 dark:text-gray-400">Date</span>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="mt-0.5 w-full px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
          </label>
          <label className="block text-xs">
            <span className="text-gray-500 dark:text-gray-400">Note (optional)</span>
            <input value={note} onChange={e => setNote(e.target.value)}
              placeholder="e.g. cash bill no, vendor receipt"
              className="mt-0.5 w-full px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
          </label>
          {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
        </div>
        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <button onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200">
            Cancel
          </button>
          <button onClick={submit} disabled={saving}
            className="px-5 py-2 rounded-lg text-sm bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-50">
            {saving ? 'Saving…' : 'Mark Cash Paid'}
          </button>
        </div>
      </div>
    </div>
  )
}

function CancelChallanModal({ challan, onClose, onDone }: {
  challan: Challan
  onClose: () => void
  onDone: () => void
}) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    setSaving(true); setError('')
    const res = await fetch(`/api/inv/challans/${challan.id}/cancel`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reason || undefined }),
    })
    setSaving(false)
    if (!res.ok) { setError((await res.json()).error || 'Cancel failed'); return }
    onDone()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-800 dark:text-gray-100">Cancel Challan</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg">✕</button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Soft-cancel: the series number stays on the books labelled <span className="font-semibold">Cancelled</span>.
            Stock IN is reversed (only the qty still in stock — already-returned units are not OUT&apos;d twice).
          </p>
          <label className="block text-xs">
            <span className="text-gray-500 dark:text-gray-400">Reason (optional)</span>
            <input value={reason} onChange={e => setReason(e.target.value)}
              className="mt-0.5 w-full px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
          </label>
          {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
        </div>
        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <button onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200">
            Back
          </button>
          <button onClick={submit} disabled={saving}
            className="px-5 py-2 rounded-lg text-sm bg-rose-600 hover:bg-rose-700 text-white font-semibold disabled:opacity-50">
            {saving ? 'Saving…' : 'Cancel challan'}
          </button>
        </div>
      </div>
    </div>
  )
}

function LineCard({ line, disabled, onSave }: {
  line: Line
  disabled: boolean
  onSave: (patch: Record<string, any>) => void | Promise<void>
}) {
  // Discount display: percent if discountType=PCT, else flat amount.
  // The input accepts both formats: "5" → flat ₹5, "5%" → 5 percent.
  const initialDiscountText = (() => {
    if (line.discountType === 'PCT' && line.discountValue != null) {
      return `${line.discountValue}%`
    }
    return line.discountAmount ?? ''
  })()
  const aliasGst = line.item?.alias?.gstRate != null ? String(Number(line.item.alias.gstRate)) : ''

  const [qty, setQty] = useState(line.qty)
  const [unit, setUnit] = useState(line.unit)
  const [rate, setRate] = useState(line.rate ?? '')
  const [discount, setDiscount] = useState(initialDiscountText)
  // GST autofill: empty stored gstRate falls back to alias rate so the user
  // doesn't retype it on every line.
  const [gstRate, setGstRate] = useState(line.gstRate ?? aliasGst)
  const [notes, setNotes] = useState(line.notes ?? '')
  const [historyOpen, setHistoryOpen] = useState(false)

  // Re-sync local state from server after each save round-trip
  useEffect(() => {
    setQty(line.qty)
    setUnit(line.unit)
    setRate(line.rate ?? '')
    setDiscount(line.discountType === 'PCT' && line.discountValue != null
      ? `${line.discountValue}%`
      : (line.discountAmount ?? ''))
    setGstRate(line.gstRate ?? aliasGst)
    setNotes(line.notes ?? '')
  }, [line.id, line.qty, line.unit, line.rate, line.discountAmount, line.discountType, line.discountValue, line.gstRate, line.notes, aliasGst])

  // Auto-persist the alias GST rate the FIRST time the row appears with no
  // stored rate. Without this, the field shows "18" but the DB holds null,
  // and any invoice created from this challan inherits 0% (no GST math).
  useEffect(() => {
    if (disabled) return
    if (line.gstRate == null && aliasGst && Number(aliasGst) > 0) {
      onSave({ gstRate: aliasGst })
    }
    // Only depends on line.id + aliasGst — we want this to fire once per line.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line.id, aliasGst, disabled])

  function commit(field: string, value: any) {
    onSave({ [field]: value })
  }

  // Parse the discount input — trailing `%` switches to percent mode.
  function commitDiscount(raw: string) {
    const trimmed = raw.trim()
    if (trimmed === '') {
      // Clear all three discount fields together
      onSave({ discountType: null, discountValue: null, discountAmount: null })
      return
    }
    const isPct = trimmed.endsWith('%')
    const numStr = isPct ? trimmed.slice(0, -1).trim() : trimmed
    const num = Number(numStr)
    if (!Number.isFinite(num) || num < 0) return // ignore garbage; keep current
    if (isPct) {
      onSave({ discountType: 'PCT', discountValue: num })
    } else {
      onSave({ discountType: 'AMT', discountValue: num, discountAmount: num })
    }
  }
  const discountChanged = (() => {
    const stored = line.discountType === 'PCT' && line.discountValue != null
      ? `${line.discountValue}%`
      : (line.discountAmount ?? '')
    return String(discount).trim() !== String(stored).trim()
  })()

  const inp = 'w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-gray-300 focus:border-indigo-400 focus:outline-none rounded px-1.5 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-60'
  const lbl = 'block text-[9px] uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-0.5'

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-2.5 space-y-2">
      {/* Row 1 — Item name + alias (click name → last-5 buys popup) */}
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <button type="button" onClick={() => setHistoryOpen(true)}
            className="text-xs font-semibold text-indigo-700 dark:text-indigo-300 hover:underline leading-tight text-left">
            {line.item.displayName}
          </button>
          {Number(line.returnedQty ?? 0) > 0 && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300 shrink-0">
              {Number(line.returnedQty) >= Number(line.qty) ? 'Returned' : `${Number(line.returnedQty)} returned`}
            </span>
          )}
        </div>
        <p className="text-[10px] text-gray-500 dark:text-gray-400">{line.item.alias.tallyStockItem}</p>
      </div>

      {historyOpen && (
        <ItemHistoryModal itemId={line.item.id} itemName={line.item.displayName}
          onClose={() => setHistoryOpen(false)} />
      )}

      {/* Row 2 — Qty / Unit / Rate / Discount */}
      <div className="grid grid-cols-4 gap-2">
        <div>
          <span className={lbl}>Qty</span>
          <input type="number" step="0.001" disabled={disabled} className={inp}
            value={qty} onChange={e => setQty(e.target.value)}
            onBlur={() => qty !== line.qty && commit('qty', qty)} />
        </div>
        <div>
          <span className={lbl}>Unit</span>
          <input type="text" disabled={disabled} className={inp}
            value={unit} onChange={e => setUnit(e.target.value)}
            onBlur={() => unit !== line.unit && commit('unit', unit)} />
        </div>
        <div>
          <span className={lbl}>Rate</span>
          <input type="number" step="0.0001" disabled={disabled} className={inp}
            value={rate} onChange={e => setRate(e.target.value)}
            onBlur={() => String(rate) !== String(line.rate ?? '')
              && commit('rate', rate === '' ? null : rate)} />
        </div>
        <div>
          <span className={lbl}>Discount <span className="text-gray-400 normal-case">(₹ or %)</span></span>
          <input type="text" inputMode="decimal" disabled={disabled} className={inp}
            placeholder="0 or 5%"
            value={discount} onChange={e => setDiscount(e.target.value)}
            onBlur={() => discountChanged && commitDiscount(discount)} />
        </div>
      </div>

      {/* Row 3 — GST / Amount / Total / Notes */}
      <div className="grid grid-cols-4 gap-2">
        <div>
          <span className={lbl}>
            GST %{line.gstRate == null && aliasGst && (
              <span className="ml-1 text-indigo-500 normal-case">(from item)</span>
            )}
          </span>
          <input type="number" step="0.01" disabled={disabled} className={inp}
            value={gstRate} onChange={e => setGstRate(e.target.value)}
            onBlur={() => String(gstRate) !== String(line.gstRate ?? '')
              && commit('gstRate', gstRate === '' ? null : gstRate)} />
        </div>
        <div>
          <span className={lbl}>Amount</span>
          <p className="px-1.5 py-1 text-xs text-gray-700 dark:text-gray-200 font-medium">₹{fmtMoney(line.amount)}</p>
        </div>
        <div>
          <span className={lbl}>Total</span>
          <p className="px-1.5 py-1 text-xs font-bold text-gray-900 dark:text-gray-50">₹{fmtMoney(line.totalWithGst)}</p>
        </div>
        <div>
          <span className={lbl}>Notes</span>
          <input type="text" disabled={disabled} className={inp} placeholder="—"
            value={notes} onChange={e => setNotes(e.target.value)}
            onBlur={() => notes !== (line.notes ?? '') && commit('notes', notes)} />
        </div>
      </div>
    </div>
  )
}

function ItemHistoryModal({ itemId, itemName, onClose }: {
  itemId: number; itemName: string; onClose: () => void
}) {
  const { data, isLoading } = useSWR<any[]>(`/api/inv/items/${itemId}/recent-rates?n=5`, fetcher)
  const rows = data ?? []
  const aliasBucketed = rows[0]?.aliasBucketed === true
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl">
        <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-gray-800 dark:text-gray-100">Last 5 buys</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {itemName}
              {aliasBucketed && (
                <span className="ml-2 text-[10px] font-semibold text-purple-600 dark:text-purple-400">
                  · also showing sibling items under the same alias
                </span>
              )}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg">✕</button>
        </div>
        <div className="p-3">
          {isLoading ? (
            <p className="p-6 text-center text-xs text-gray-400">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="p-6 text-center text-xs text-gray-400">No prior purchases of this item.</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="text-left pb-1.5">Date</th>
                  <th className="text-left pb-1.5">Party</th>
                  {aliasBucketed && <th className="text-left pb-1.5">Item</th>}
                  <th className="text-right pb-1.5">Qty</th>
                  <th className="text-right pb-1.5">Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className="py-1.5 text-gray-500 dark:text-gray-400">
                      {new Date(r.challanDate).toLocaleDateString('en-IN')}
                    </td>
                    <td className="py-1.5 text-gray-800 dark:text-gray-100">{r.partyName}</td>
                    {aliasBucketed && (
                      <td className="py-1.5 text-gray-700 dark:text-gray-200">
                        {r.itemId === itemId
                          ? <span className="font-semibold">{r.itemName}</span>
                          : <span className="text-gray-500 dark:text-gray-400">{r.itemName}</span>}
                      </td>
                    )}
                    <td className="py-1.5 text-right">{Number(r.qty)} {r.unit}</td>
                    <td className="py-1.5 text-right font-semibold">₹{Number(r.rate).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const palette: Record<string, string> = {
    Draft: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
    PendingInvoice: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    Invoiced: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
    Returned: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
    CashPaid: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    Cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    Verified: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    PendingApproval: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  }
  const label = status === 'CashPaid' ? 'Cash Paid' : status
  return <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${palette[status] || palette.Draft}`}>{label}</span>
}
