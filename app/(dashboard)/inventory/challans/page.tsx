'use client'

import { useState, useMemo, useEffect } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import BackButton from '../../BackButton'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const STATUSES = ['Draft', 'PendingInvoice', 'Invoiced', 'Cancelled']

interface Item { id: number; displayName: string; alias: { id: number; tallyStockItem: string; gstRate: string | number } }
interface Line {
  id: number
  lineNo: number
  qty: string
  unit: string
  rate: string | null
  gstRate: string | null
  discountAmount: string | null
  grossAmount: string | null
  amount: string | null
  gstAmount: string | null
  totalWithGst: string | null
  notes: string | null
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
  party: { id: number; displayName: string; parentGroup: string | null }
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
  useEffect(() => {
    try {
      const saved = localStorage.getItem('inv-challans-hide-invoiced')
      if (saved !== null) setHideInvoiced(saved === 'true')
    } catch {}
  }, [])
  useEffect(() => {
    try { localStorage.setItem('inv-challans-hide-invoiced', String(hideInvoiced)) } catch {}
  }, [hideInvoiced])

  const visibleChallans = useMemo(
    () => hideInvoiced ? challans.filter(c => c.status !== 'Invoiced') : challans,
    [challans, hideInvoiced],
  )
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
        <input type="search" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search challan, party, item, alias, tag, invoice no…"
          className="flex-1 min-w-[260px] px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs" />
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
          totals={selectedTotals}
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
  totals: { qty: number; amount: number; gst: number; total: number }
  onClose: () => void
  onCreated: (invoiceId: number) => void
}) {
  const { challans, totals, onClose, onCreated } = props
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
  const grandTotal = totals.amount + totals.gst + freight + other - discount

  // Flatten all selected challans' lines into the invoice payload
  const lines = useMemo(() => challans.flatMap(c => c.lines.map(l => ({
    itemId: l.item.id,
    description: l.item.displayName,
    qty: l.qty,
    unit: l.unit,
    rate: l.rate,
    gstRate: l.gstRate,
    discountAmount: l.discountAmount,
    challanLineId: l.id,
  }))), [challans])

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
            <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Taxable</span><span>₹{fmtMoney(totals.amount)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">GST</span><span>₹{fmtMoney(totals.gst)}</span></div>
            {(freight + other) > 0 && (
              <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Freight + other</span><span>₹{fmtMoney(freight + other)}</span></div>
            )}
            {discount > 0 && (
              <div className="flex justify-between text-rose-600 dark:text-rose-400">
                <span>Discount</span><span>− ₹{fmtMoney(discount)}</span>
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
}) {
  const { challan, expanded, onToggleExpand, selected, onToggleSelect, selectableForParty, onChange } = props
  const c = challan
  const linked = c.status === 'Invoiced' || !!c.invoiceLink
  const canSelect = !linked && c.status !== 'Cancelled' && selectableForParty

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
            <StatusBadge status={c.status} />
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

          {/* Items summary — name + qty/unit per row, wraps cleanly on phones */}
          {c.lines.length > 0 && (
            <ul className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700 space-y-0.5">
              {c.lines.map(l => (
                <li key={l.id} className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="flex-1 min-w-0 break-words text-gray-700 dark:text-gray-300">
                    {l.item.displayName}
                  </span>
                  <span className="shrink-0 font-medium text-gray-600 dark:text-gray-300">
                    {Number(l.qty)} <span className="text-gray-400 dark:text-gray-500">{l.unit}</span>
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
            <button onClick={flipRatesIncludeGst} disabled={linked}
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
              <LineCard key={l.id} line={l} disabled={linked} onSave={patch => patchLine(l.id, patch)} />
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
        </div>
      )}
    </div>
  )
}

function LineCard({ line, disabled, onSave }: {
  line: Line
  disabled: boolean
  onSave: (patch: Record<string, any>) => void | Promise<void>
}) {
  const [qty, setQty] = useState(line.qty)
  const [unit, setUnit] = useState(line.unit)
  const [rate, setRate] = useState(line.rate ?? '')
  const [discount, setDiscount] = useState(line.discountAmount ?? '')
  const [gstRate, setGstRate] = useState(line.gstRate ?? '')
  const [notes, setNotes] = useState(line.notes ?? '')
  const [historyOpen, setHistoryOpen] = useState(false)

  // Re-sync local state from server after each save round-trip
  useEffect(() => {
    setQty(line.qty)
    setUnit(line.unit)
    setRate(line.rate ?? '')
    setDiscount(line.discountAmount ?? '')
    setGstRate(line.gstRate ?? '')
    setNotes(line.notes ?? '')
  }, [line.id, line.qty, line.unit, line.rate, line.discountAmount, line.gstRate, line.notes])

  function commit(field: string, value: any) {
    onSave({ [field]: value })
  }

  const inp = 'w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-gray-300 focus:border-indigo-400 focus:outline-none rounded px-1.5 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-60'
  const lbl = 'block text-[9px] uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-0.5'

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-2.5 space-y-2">
      {/* Row 1 — Item name + alias (click name → last-5 buys popup) */}
      <div>
        <button type="button" onClick={() => setHistoryOpen(true)}
          className="text-xs font-semibold text-indigo-700 dark:text-indigo-300 hover:underline leading-tight text-left">
          {line.item.displayName}
        </button>
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
          <span className={lbl}>Discount</span>
          <input type="number" step="0.01" disabled={disabled} className={inp}
            value={discount} onChange={e => setDiscount(e.target.value)}
            onBlur={() => String(discount) !== String(line.discountAmount ?? '')
              && commit('discountAmount', discount === '' ? null : discount)} />
        </div>
      </div>

      {/* Row 3 — GST / Amount / Total / Notes */}
      <div className="grid grid-cols-4 gap-2">
        <div>
          <span className={lbl}>GST %</span>
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
    Invoiced: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    Cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    Verified: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    PendingApproval: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  }
  return <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${palette[status] || palette.Draft}`}>{status}</span>
}
