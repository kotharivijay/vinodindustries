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

  function createInvoiceFromSelection() {
    if (selected.size === 0) return
    const ids = [...selected].join(',')
    router.push(`/inventory/invoices/new?challans=${ids}`)
  }

  return (
    <div className="p-4 md:p-8 max-w-6xl pb-24">
      <div className="flex items-center gap-3 mb-5">
        <BackButton />
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Inward Challans</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{challans.length} matching</p>
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
        <input type="search" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search challan no…"
          className="flex-1 min-w-[180px] px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs" />
      </div>

      {isLoading ? <div className="p-12 text-center text-gray-400">Loading…</div>
        : !challans.length ? <div className="p-12 text-center text-gray-400">No challans yet.</div>
        : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {challans.map(c => (
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
          <button onClick={createInvoiceFromSelection}
            className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-1.5 rounded-lg text-sm font-semibold">
            Create Purchase Invoice
          </button>
        </div>
      )}
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
          <div className="mt-1 flex justify-between text-xs">
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

          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead className="text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="text-left pb-1.5">Item</th>
                  <th className="text-right pb-1.5 w-16">Qty</th>
                  <th className="text-left pb-1.5 w-12">Unit</th>
                  <th className="text-right pb-1.5 w-20">Rate</th>
                  <th className="text-right pb-1.5 w-12">GST%</th>
                  <th className="text-right pb-1.5 w-20">Amount</th>
                  <th className="text-right pb-1.5 w-20">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {c.lines.map(l => (
                  <LineRow key={l.id} line={l} disabled={linked} onSave={patch => patchLine(l.id, patch)} />
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-200 dark:border-gray-600 font-bold text-gray-800 dark:text-gray-100">
                  <td colSpan={2} className="pt-2 text-right">Subtotal</td>
                  <td colSpan={3}></td>
                  <td className="pt-2 text-right">{fmtMoney(c.totalAmount)}</td>
                  <td></td>
                </tr>
                <tr className="text-gray-600 dark:text-gray-300">
                  <td colSpan={5} className="text-right">GST</td>
                  <td className="text-right">{fmtMoney(c.totalGstAmount)}</td>
                  <td></td>
                </tr>
                <tr className="font-bold text-gray-900 dark:text-gray-50">
                  <td colSpan={5} className="text-right pt-1">Total with GST</td>
                  <td colSpan={2} className="text-right pt-1">₹{fmtMoney(c.totalWithGst)}</td>
                </tr>
              </tfoot>
            </table>
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

function LineRow({ line, disabled, onSave }: {
  line: Line
  disabled: boolean
  onSave: (patch: Record<string, any>) => void | Promise<void>
}) {
  const [qty, setQty] = useState(line.qty)
  const [unit, setUnit] = useState(line.unit)
  const [rate, setRate] = useState(line.rate ?? '')
  const [gstRate, setGstRate] = useState(line.gstRate ?? '')

  // Re-sync from server when the parent challan reloads after a save
  useEffect(() => {
    setQty(line.qty); setUnit(line.unit)
    setRate(line.rate ?? ''); setGstRate(line.gstRate ?? '')
  }, [line.id, line.qty, line.unit, line.rate, line.gstRate])

  function commit(field: string, value: any) {
    onSave({ [field]: value })
  }

  const cell = 'w-full bg-transparent border border-transparent hover:border-gray-300 focus:border-indigo-400 focus:outline-none rounded px-1 py-0.5 text-right disabled:cursor-not-allowed'
  const cellLeft = cell.replace('text-right', 'text-left')

  return (
    <tr className="text-gray-800 dark:text-gray-100">
      <td className="py-1 align-top">
        <span className="block leading-tight">{line.item.displayName}</span>
        <span className="block text-[10px] text-gray-400">{line.item.alias.tallyStockItem}</span>
      </td>
      <td className="py-1">
        <input type="number" step="0.001" disabled={disabled}
          value={qty} onChange={e => setQty(e.target.value)}
          onBlur={() => qty !== line.qty && commit('qty', qty)}
          className={cell} />
      </td>
      <td className="py-1">
        <input type="text" disabled={disabled}
          value={unit} onChange={e => setUnit(e.target.value)}
          onBlur={() => unit !== line.unit && commit('unit', unit)}
          className={cellLeft} />
      </td>
      <td className="py-1">
        <input type="number" step="0.0001" disabled={disabled}
          value={rate} onChange={e => setRate(e.target.value)}
          onBlur={() => String(rate) !== String(line.rate ?? '') && commit('rate', rate === '' ? null : rate)}
          className={cell} />
      </td>
      <td className="py-1">
        <input type="number" step="0.01" disabled={disabled}
          value={gstRate} onChange={e => setGstRate(e.target.value)}
          onBlur={() => String(gstRate) !== String(line.gstRate ?? '') && commit('gstRate', gstRate === '' ? null : gstRate)}
          className={cell} />
      </td>
      <td className="py-1 text-right">{fmtMoney(line.amount)}</td>
      <td className="py-1 text-right font-semibold">{fmtMoney(line.totalWithGst)}</td>
    </tr>
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
