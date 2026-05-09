'use client'

import { useState, useMemo } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import useSWR from 'swr'
import BackButton from '../../../BackButton'

type InvoiceView = 'all' | 'linked' | 'batch'

interface BatchSibling { id: number; vchNumber: string; vchType: string; date: string; amount: number; partyName: string; cash: number; tds: number; discount: number; count: number }

const fetcher = (url: string) => fetch(url).then(r => r.json())
const fmtMoney = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (iso: string) => {
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}-${d.toLocaleString('en-IN', { month: 'short' })}-${String(d.getFullYear()).slice(2)}`
}

const DEFAULT_TDS_RATE = 2 // % — adjustable inline

interface Line { id: number; lineNo: number; stockItem: string; rawQty: string | null; qty: number | null; unit: string | null; altQty: number | null; altUnit: string | null; rate: number | null; rateUnit: string | null; amount: number; discountPct: number | null; baleNo: string | null }
interface Ledger { id: number; ledgerName: string; amount: number; isDeemedPositive: boolean }
interface Allocation { id: number; allocatedAmount: number; tdsAmount?: number; discountAmount?: number; note: string | null; receipt?: { id: number; vchNumber: string; date: string; amount: number } }
interface Invoice {
  id: number; date: string; vchNumber: string; vchType: string; partyName: string; partyGstin: string | null
  totalAmount: number; taxableAmount: number | null; cgstAmount: number | null; sgstAmount: number | null; igstAmount: number | null; roundOff: number | null
  narration: string | null; reference: string | null; buyerPO: string | null; transporter: string | null; agentName: string | null
  lines: Line[]; ledgers: Ledger[]; allocations: Allocation[]
  allocated: number; tds: number; discount: number; consumed: number; pending: number
}
interface Receipt {
  id: number; date: string; vchNumber: string; partyName: string; amount: number; narration: string | null
  instrumentNo: string | null; bankRef: string | null
  carryOverPriorFy?: number
  allocations: { invoiceId: number; allocatedAmount: number; tdsAmount?: number; discountAmount?: number }[]
}

export default function ReceiptDetailPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const id = params.id as string
  const viewParam = searchParams.get('view')
  const initialView: InvoiceView = viewParam === 'linked' ? 'linked' : viewParam === 'batch' ? 'batch' : 'all'
  const { data, mutate, isLoading } = useSWR<{
    receipt: Receipt; invoices: Invoice[]; categoryMap: Record<string, string>;
    batchIds: string[]; batchSiblings: BatchSibling[]; batchInvoiceIds: number[]; batchNote: string | null
  }>(`/api/accounts/receipts/${id}`, fetcher)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const [view, setView] = useState<InvoiceView>(initialView)
  const [editingCarry, setEditingCarry] = useState(false)
  const [carryInput, setCarryInput] = useState('')
  const [savingCarry, setSavingCarry] = useState(false)

  if (isLoading) return <div className="max-w-3xl mx-auto p-3"><BackButton fallback="/accounts/receipts" /><div className="text-center py-8 text-gray-400 text-sm">Loading…</div></div>
  if (!data?.receipt) return <div className="max-w-3xl mx-auto p-3"><BackButton fallback="/accounts/receipts" /><div className="p-8 text-center text-rose-500">Receipt not found</div></div>

  const r = data.receipt
  const allInvoices = data.invoices
  const batchSiblings = data.batchSiblings || []
  const batchInvoiceIds = new Set(data.batchInvoiceIds || [])
  const hasBatch = batchSiblings.length > 0
  const batchNote = data.batchNote || null
  const linkedCount = allInvoices.filter(inv => inv.allocations.some(a => a.receipt?.id === Number(id))).length
  const batchInvoiceCount = allInvoices.filter(inv => batchInvoiceIds.has(inv.id)).length
  const invoices = view === 'linked'
    ? allInvoices.filter(inv => inv.allocations.some(a => a.receipt?.id === Number(id)))
    : view === 'batch'
      ? allInvoices.filter(inv => batchInvoiceIds.has(inv.id))
      : allInvoices
  const receiptUsed = r.allocations.reduce((s, a) => s + (a.allocatedAmount || 0), 0)
  const receiptRemaining = Math.max(0, r.amount - receiptUsed)

  async function saveCarryOver() {
    const v = parseFloat(carryInput)
    if (!Number.isFinite(v) || v < 0) { alert('Enter a valid amount (≥ 0)'); return }
    setSavingCarry(true)
    try {
      const res = await fetch(`/api/accounts/receipts/${id}/carry-over`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ carryOver: v }),
      })
      const d = await res.json()
      if (!res.ok) { alert(d.error || 'Failed'); return }
      setEditingCarry(false)
      mutate()
    } catch (e: any) { alert(e?.message || 'Network error') }
    finally { setSavingCarry(false) }
  }

  async function syncSales() {
    setSyncing(true); setSyncMsg('')
    try {
      const fromIso = '2025-04-01'
      const toIso = new Date().toISOString().slice(0, 10)
      const res = await fetch('/api/tally/ksi-sales-sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: fromIso, to: toIso }),
      })
      const d = await res.json()
      if (!res.ok) { setSyncMsg(d.error || 'Failed'); return }
      setSyncMsg(`Synced ${d.saved} invoices (${d.fetched} fetched)`)
      mutate()
    } catch (e: any) { setSyncMsg(e?.message || 'Network error') }
    finally { setSyncing(false) }
  }

  return (
    <div className="max-w-3xl mx-auto p-3 pb-20">
      <div className="flex items-center gap-2 mb-3">
        <BackButton fallback="/accounts/receipts" />
        <h1 className="text-base font-bold text-gray-800 dark:text-gray-100">Receipt #{r.vchNumber}</h1>
      </div>

      {/* Receipt header card */}
      <div className="bg-white dark:bg-gray-800 border border-emerald-200 dark:border-emerald-700/40 rounded-xl p-3 mb-3">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="min-w-0">
            <div className="text-[10px] text-gray-500 dark:text-gray-400">{fmtDate(r.date)} · Receipt #{r.vchNumber}</div>
            <div className="text-base font-semibold text-gray-800 dark:text-gray-100 break-words">{r.partyName}</div>
            {(r.bankRef || r.instrumentNo) && (
              <div className="text-[11px] text-indigo-600 dark:text-indigo-400 mt-0.5 font-mono break-all">
                {r.instrumentNo && <span>ref: {r.instrumentNo}</span>}
                {r.instrumentNo && r.bankRef && <span> · </span>}
                {r.bankRef && <span>uniq: {r.bankRef}</span>}
              </div>
            )}
            {r.narration && <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 break-words">{r.narration}</div>}
          </div>
          <div className="text-right shrink-0">
            <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">₹{fmtMoney(r.amount)}</div>
            <div className="text-[10px] text-gray-500 mt-0.5">remaining ₹{fmtMoney(receiptRemaining)}</div>
            {editingCarry ? (
              <div className="mt-1 flex items-center gap-1 justify-end">
                <span className="text-[10px] text-amber-700 dark:text-amber-300">⏪ ₹</span>
                <input type="number" value={carryInput}
                  onChange={e => setCarryInput(e.target.value)}
                  placeholder="0"
                  autoFocus
                  className="w-24 px-1.5 py-0.5 rounded border border-amber-300 dark:border-amber-700 bg-white dark:bg-gray-700 text-[11px] tabular-nums" />
                <button onClick={saveCarryOver} disabled={savingCarry}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-40">
                  {savingCarry ? '…' : 'Save'}
                </button>
                <button onClick={() => setEditingCarry(false)} disabled={savingCarry}
                  className="text-[10px] px-1.5 py-0.5 rounded border border-gray-300 dark:border-gray-600 text-gray-500">
                  ✕
                </button>
              </div>
            ) : (r.carryOverPriorFy ?? 0) > 0 ? (
              <button
                onClick={() => { setCarryInput(String(r.carryOverPriorFy ?? 0)); setEditingCarry(true) }}
                className="text-[10px] text-amber-700 dark:text-amber-300 italic mt-0.5 tabular-nums hover:underline"
                title="Click to edit carry-over amount">
                ⏪ carry-over ₹{fmtMoney(r.carryOverPriorFy ?? 0)} ✏
              </button>
            ) : (
              <button
                onClick={() => { setCarryInput(''); setEditingCarry(true) }}
                className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5 hover:underline"
                title="Mark a portion of this receipt as carry-over to prior FY (e.g. FY 24-25)">
                + add carry-over
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Bulk-batch siblings — every other receipt that was committed
         in the same /bulk-allocate call as this one. Tap to open. */}
      {hasBatch && (
        <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-700/40 rounded-xl p-3 mb-3">
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">
              🔗 Bulk batch · {batchSiblings.length + 1} receipts
            </div>
            <button onClick={() => setView('batch')}
              className="text-[10px] underline text-indigo-700 dark:text-indigo-300">
              Show batch invoices ({batchInvoiceCount})
            </button>
          </div>
          {batchNote && (
            <div className="text-[11px] text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-indigo-200 dark:border-indigo-700/40 rounded p-1.5 mb-1.5">
              <span className="font-semibold">📌 Notes:</span> {batchNote}
            </div>
          )}
          <div className="space-y-0.5 text-[11px]">
            {batchSiblings.map(s => (
              <button key={s.id}
                onClick={() => router.push(`/accounts/receipts/${s.id}?view=batch`)}
                className="w-full flex items-center justify-between gap-2 py-1 px-2 rounded hover:bg-indigo-100 dark:hover:bg-indigo-800/30 text-left">
                <span className="font-mono text-emerald-700 dark:text-emerald-300 shrink-0">#{s.vchNumber}</span>
                <span className="text-gray-500 shrink-0">{fmtDate(s.date)}</span>
                <span className="flex-1 text-gray-700 dark:text-gray-200 tabular-nums text-right">₹{fmtMoney(s.amount)}</span>
                <span className="text-[10px] text-indigo-600 dark:text-indigo-400 tabular-nums shrink-0">
                  → ₹{fmtMoney(s.cash)}
                  {s.count > 1 && <span className="text-gray-400"> · {s.count} invs</span>}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Invoices for this party */}
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          {view === 'linked' ? 'Linked invoices'
            : view === 'batch' ? 'Batch invoices'
            : 'Sales / Process invoices for this party'} ({invoices.length})
        </h2>
        <button onClick={syncSales} disabled={syncing}
          className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-[11px] font-semibold">
          {syncing ? 'Syncing…' : 'Sync from Tally'}
        </button>
      </div>
      {(linkedCount > 0 || hasBatch) && (
        <div className="flex items-center gap-1.5 mb-2 text-[11px] flex-wrap">
          <span className="text-gray-500 dark:text-gray-400">Show:</span>
          {linkedCount > 0 && (
            <button onClick={() => setView('linked')}
              className={`px-2.5 py-1 rounded-full border transition ${
                view === 'linked'
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'
              }`}>
              🔗 Linked only ({linkedCount})
            </button>
          )}
          {hasBatch && (
            <button onClick={() => setView('batch')}
              className={`px-2.5 py-1 rounded-full border transition ${
                view === 'batch'
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'
              }`}>
              🔗 Batch ({batchInvoiceCount})
            </button>
          )}
          <button onClick={() => setView('all')}
            className={`px-2.5 py-1 rounded-full border transition ${
              view === 'all'
                ? 'bg-emerald-600 text-white border-emerald-600'
                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'
            }`}>
            All party invoices ({allInvoices.length})
          </button>
        </div>
      )}
      {syncMsg && <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">{syncMsg}</div>}

      {invoices.length === 0 ? (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400 text-sm border border-dashed rounded-xl">
          {view === 'linked' ? (
            <>No invoices linked to this receipt yet.<br />
              <button onClick={() => setView('all')} className="text-[11px] mt-1 underline text-emerald-600 dark:text-emerald-400">
                Show all party invoices to link one
              </button>
            </>
          ) : view === 'batch' ? (
            <>No invoices in this bulk batch.<br />
              <button onClick={() => setView('all')} className="text-[11px] mt-1 underline text-emerald-600 dark:text-emerald-400">
                Show all party invoices
              </button>
            </>
          ) : (
            <>No KSI Process Job invoices for &ldquo;{r.partyName}&rdquo;.<br />
              <span className="text-[11px]">Tap &ldquo;Sync from Tally&rdquo; to backfill.</span>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {invoices.map(inv => (
            <InvoiceCard key={inv.id} inv={inv} receiptId={Number(id)}
              receipt={r}
              receiptRemaining={receiptRemaining}
              categoryMap={data?.categoryMap ?? {}}
              partyName={r.partyName}
              onChange={() => mutate()} />
          ))}
        </div>
      )}
    </div>
  )
}

function InvoiceCard({ inv, receiptId, receipt, receiptRemaining, categoryMap, partyName, onChange }: {
  inv: Invoice; receiptId: number; receipt: Receipt; receiptRemaining: number;
  categoryMap: Record<string, string>; partyName: string;
  onChange: () => void
}) {
  // Prefer the stored taxableAmount; fall back to summing item lines so
  // older rows (synced before taxableAmount was populated) still produce a
  // non-zero TDS auto-calc.
  const itemSum = useMemo(() => inv.lines.reduce((s, l) => s + l.amount, 0), [inv.lines])
  const grossTaxable = inv.taxableAmount && inv.taxableAmount > 0 ? inv.taxableAmount : itemSum
  const myAlloc = inv.allocations.find(a => a.receipt?.id === receiptId)
  // What this receipt can apply to the invoice = invoice's open pending +
  // whatever this receipt has already applied (since editing rebuilds
  // *this* receipt's portion). Lets the same invoice be settled by
  // multiple receipts: each picks up the remaining pending.
  const myConsumed = (myAlloc?.allocatedAmount ?? 0) + (myAlloc?.tdsAmount ?? 0) + (myAlloc?.discountAmount ?? 0)
  const ask = Math.max(0, inv.pending + myConsumed)
  const otherReceiptsPaid = inv.allocations
    .filter(a => a.receipt?.id !== receiptId)
    .reduce((s, a) => s + (a.allocatedAmount || 0) + (a.tdsAmount || 0) + (a.discountAmount || 0), 0)

  // Voucher-level ledgers grouped by category. The Discount pill in the
  // form is a separate at-payment concession — voucher-level discounts
  // (e.g. "Finish Gadi Less") are already part of the invoice and reduce
  // the taxable base used for TDS.
  const ledgerGroups = useMemo(() => {
    const groups: Record<string, Ledger[]> = { sales: [], 'extra-charge': [], discount: [], tax: [], roundoff: [], party: [], ignore: [], unmapped: [] }
    for (const led of inv.ledgers ?? []) {
      const lname = led.ledgerName.toLowerCase()
      let cat = categoryMap[lname]
      if (!cat) {
        if (/cgst|sgst|utgst|igst/.test(lname)) cat = 'tax'
        else if (/round\s*off|roundoff|rounding/.test(lname)) cat = 'roundoff'
        else if (lname === inv.partyName.toLowerCase()) cat = 'party'
        else cat = 'unmapped'
      }
      if (groups[cat]) groups[cat].push(led)
    }
    return groups
  }, [inv.ledgers, inv.partyName, categoryMap])

  // Net taxable for TDS = items − voucher-level discounts + voucher-level
  // extra charges (the actual service amount the party is paying for, before
  // GST). Finish Gadi Less reduces it; freight/packing add to it.
  const voucherDiscount = useMemo(
    () => ledgerGroups['discount'].reduce((s, l) => s + Math.abs(l.amount), 0),
    [ledgerGroups],
  )
  const voucherExtraCharge = useMemo(
    () => ledgerGroups['extra-charge'].reduce((s, l) => s + Math.abs(l.amount), 0),
    [ledgerGroups],
  )
  const taxable = Math.max(0, grossTaxable - voucherDiscount + voucherExtraCharge)

  const [open, setOpen] = useState(false)
  const [tdsRate, setTdsRate] = useState<string>(myAlloc?.tdsAmount && myAlloc.tdsAmount > 0 ? '' : String(DEFAULT_TDS_RATE))
  const [tdsAmt, setTdsAmt] = useState<string>(myAlloc?.tdsAmount ? String(myAlloc.tdsAmount.toFixed(2)) : '')
  const [discPct, setDiscPct] = useState<string>('')
  const [discAmt, setDiscAmt] = useState<string>(myAlloc?.discountAmount ? String(myAlloc.discountAmount.toFixed(2)) : '')
  const [note, setNote] = useState<string>(myAlloc?.note ?? '')
  const [busy, setBusy] = useState(false)

  // Final amount the receipt will allocate = ask − tds − discount
  const numTds = parseFloat(tdsAmt) || 0
  const numDisc = parseFloat(discAmt) || 0
  const final = useMemo(() => Math.max(0, ask - numTds - numDisc), [ask, numTds, numDisc])
  const cappedFinal = useMemo(() => {
    // Cap at receipt remaining + any portion already allocated to this invoice
    const myCash = myAlloc?.allocatedAmount ?? 0
    const cap = receiptRemaining + myCash
    return Math.min(final, cap)
  }, [final, receiptRemaining, myAlloc])

  function autoTds() {
    const rate = parseFloat(tdsRate) || DEFAULT_TDS_RATE
    if (!Number.isFinite(rate) || rate <= 0) return
    const calc = Math.round((taxable * rate) / 100)
    setTdsRate(String(rate))
    setTdsAmt(String(calc))
  }

  function applyDiscPct() {
    const pct = parseFloat(discPct) || 0
    if (pct <= 0) return
    const calc = Math.round((taxable * pct) / 100)
    setDiscAmt(String(calc))
  }

  async function save() {
    if (cappedFinal <= 0) { alert('Final allocation is zero — adjust TDS/Discount.'); return }
    setBusy(true)
    try {
      const res = await fetch(`/api/accounts/receipts/${receiptId}/allocate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceId: inv.id,
          allocatedAmount: cappedFinal,
          tdsAmount: numTds,
          discountAmount: numDisc,
          tdsRatePct: parseFloat(tdsRate) || null,
          note: note || null,
        }),
      })
      const d = await res.json()
      if (!res.ok) { alert(d.error || 'Failed'); return }
      setOpen(false)
      onChange()
    } catch (e: any) { alert(e?.message || 'Network error') }
    finally { setBusy(false) }
  }

  // Build the WhatsApp share text from the *currently saved* allocation
  // values when collapsed, or the in-progress edit values when open. The
  // user usually shares right after saving, so saved values are the
  // common path.
  function buildShareText(): string {
    const cashPart = myAlloc?.allocatedAmount ?? cappedFinal
    const tdsPart = myAlloc?.tdsAmount ?? numTds
    const discPart = myAlloc?.discountAmount ?? numDisc
    const notePart = (myAlloc?.note ?? note)?.trim() || null
    const lines: string[] = []
    lines.push(`🧾 *Receipt Link* — ${partyName}`)
    lines.push(fmtDate(new Date().toISOString()))
    lines.push('')
    if (notePart) {
      lines.push(`📌 *Notes:* ${notePart}`)
      lines.push('')
    }
    lines.push(`*Receipt:* #${receipt.vchNumber} (${fmtDate(receipt.date)}) ₹${fmtMoney(receipt.amount)}`)
    lines.push(`*Invoice:* ${inv.vchType} ${inv.vchNumber} (${fmtDate(inv.date)}) ₹${fmtMoney(inv.totalAmount)}`)
    lines.push('')
    lines.push(`Bank Recpt: ₹${fmtMoney(cashPart)}`)
    if (tdsPart > 0) lines.push(`+ TDS: ₹${fmtMoney(tdsPart)}`)
    if (discPart > 0) lines.push(`+ Discount: ₹${fmtMoney(discPart)}`)
    const settled = cashPart + tdsPart + discPart
    lines.push(`*Settled:* ₹${fmtMoney(settled)} of ₹${fmtMoney(inv.totalAmount)}`)
    return lines.join('\n')
  }
  async function shareWhatsApp() {
    const text = buildShareText()
    if (typeof navigator !== 'undefined' && (navigator as any).share) {
      try {
        await (navigator as any).share({ title: `Receipt Link — ${partyName}`, text })
        return
      } catch { /* user cancelled — fall through */ }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
  }

  // Unlinking always cascades — every receipt allocation for this
  // invoice is removed, not just the current one. Confirmation message
  // lists the other affected receipts so the action is never silent.
  async function unlink() {
    const allRcpts = inv.allocations.map(a => a.receipt).filter(Boolean) as { id: number; vchNumber: string; amount: number }[]
    const others = allRcpts.filter(r => r.id !== receiptId)
    let msg: string
    if (others.length === 0) {
      msg = `Remove link to ${inv.vchNumber}?`
    } else {
      const list = allRcpts.map(r => `  • #${r.vchNumber}`).join('\n')
      msg = `Unlink ${inv.vchNumber} from ALL ${allRcpts.length} receipts?\n\n${list}\n\nThis will reset every allocation on this invoice.`
    }
    if (!confirm(msg)) return
    setBusy(true)
    try {
      const res = await fetch(`/api/accounts/receipts/${receiptId}/allocate`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: inv.id, removeAllReceipts: true }),
      })
      const d = await res.json()
      if (!res.ok) return alert(d.error || 'Failed')
      setOpen(false)
      onChange()
    } catch (e: any) { alert(e?.message || 'Network error') }
    finally { setBusy(false) }
  }

  return (
    <div className={`bg-white dark:bg-gray-800 border rounded-xl p-3 transition ${
      myAlloc ? 'border-emerald-400 ring-1 ring-emerald-200 dark:ring-emerald-700/40' : 'border-gray-100 dark:border-gray-700'
    }`}>
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300">
              {inv.vchType} {inv.vchNumber}
            </span>
            <span className="text-[10px] text-gray-500 dark:text-gray-400">{fmtDate(inv.date)}</span>
            {myAlloc && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                ✓ Linked ₹{fmtMoney(myAlloc.allocatedAmount)}
              </span>
            )}
          </div>
          {inv.partyGstin && <div className="text-[10px] text-gray-500 dark:text-gray-400">GSTIN: {inv.partyGstin}</div>}
        </div>
        <div className="text-right shrink-0">
          <div className="text-base font-bold text-gray-800 dark:text-gray-100 tabular-nums">₹{fmtMoney(inv.totalAmount)}</div>
          <div className="text-[10px] text-rose-600 dark:text-rose-400">pending ₹{fmtMoney(inv.pending)}</div>
          {otherReceiptsPaid > 0 && (
            <div className="text-[10px] text-indigo-600 dark:text-indigo-400" title="Settled by other receipts">
              other rcpts ₹{fmtMoney(otherReceiptsPaid)}
            </div>
          )}
        </div>
      </div>

      {/* Item-level lines */}
      {inv.lines.length > 0 && (
        <div className="border-t border-gray-100 dark:border-gray-700 pt-1.5 mt-1.5 space-y-0.5">
          {inv.lines.map(l => (
            <div key={l.id} className="text-[11px] text-gray-700 dark:text-gray-300">
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium truncate">{l.stockItem}</span>
                <span className="shrink-0 tabular-nums">₹{fmtMoney(l.amount)}</span>
              </div>
              <div className="text-[10px] text-gray-500 dark:text-gray-400">
                {l.qty != null && (
                  <>{l.qty} {l.unit ?? ''}{l.altQty != null && ` = ${l.altQty} ${l.altUnit ?? ''}`}</>
                )}
                {l.rate != null && <span> · @ ₹{l.rate}{l.rateUnit ? `/${l.rateUnit}` : ''}</span>}
                {l.discountPct != null && l.discountPct > 0 && <span> · disc {l.discountPct}%</span>}
                {l.baleNo && <span> · bale {l.baleNo}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Voucher-level math summary */}
      <div className="border-t border-gray-100 dark:border-gray-700 pt-1.5 mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-gray-500 dark:text-gray-400">
        {grossTaxable > 0 && <div>Items: <span className="text-gray-700 dark:text-gray-200 tabular-nums">₹{fmtMoney(grossTaxable)}</span></div>}
        {voucherDiscount > 0 && (
          <div className="text-rose-700 dark:text-rose-400">
            − Discount: <span className="tabular-nums">₹{fmtMoney(voucherDiscount)}</span>
          </div>
        )}
        {voucherExtraCharge > 0 && (
          <div className="text-amber-700 dark:text-amber-400">
            + Extras: <span className="tabular-nums">₹{fmtMoney(voucherExtraCharge)}</span>
          </div>
        )}
        {(voucherDiscount > 0 || voucherExtraCharge > 0) && (
          <div>Taxable (net): <span className="text-gray-700 dark:text-gray-200 font-semibold tabular-nums">₹{fmtMoney(taxable)}</span></div>
        )}
        {(inv.cgstAmount || inv.sgstAmount || inv.igstAmount) ? (
          <div>Tax: <span className="text-gray-700 dark:text-gray-200 tabular-nums">₹{fmtMoney((inv.cgstAmount || 0) + (inv.sgstAmount || 0) + (inv.igstAmount || 0))}</span></div>
        ) : null}
        {(inv.roundOff || 0) !== 0 && <div>Round: <span className="tabular-nums">₹{fmtMoney(inv.roundOff || 0)}</span></div>}
        {(inv.buyerPO || inv.transporter || inv.agentName) && (
          <div className="col-span-2 mt-0.5">
            {inv.buyerPO && <span>PO {inv.buyerPO} </span>}
            {inv.transporter && <span>· Transporter: {inv.transporter} </span>}
            {inv.agentName && <span>· Agent: {inv.agentName}</span>}
          </div>
        )}
      </div>

      {/* Voucher-level ledgers (extras/discounts/unmapped) — informational. */}
      {(ledgerGroups['extra-charge'].length + ledgerGroups['discount'].length + ledgerGroups['unmapped'].length) > 0 && (
        <div className="border-t border-gray-100 dark:border-gray-700 pt-1.5 mt-1.5 space-y-0.5 text-[10px]">
          {ledgerGroups['extra-charge'].map(l => (
            <div key={l.id} className="flex justify-between text-amber-700 dark:text-amber-400">
              <span>+ {l.ledgerName}</span><span className="tabular-nums">₹{fmtMoney(Math.abs(l.amount))}</span>
            </div>
          ))}
          {ledgerGroups['discount'].map(l => (
            <div key={l.id} className="flex justify-between text-rose-700 dark:text-rose-400">
              <span>− {l.ledgerName}</span><span className="tabular-nums">₹{fmtMoney(Math.abs(l.amount))}</span>
            </div>
          ))}
          {ledgerGroups['unmapped'].map(l => (
            <div key={l.id} className="flex justify-between text-gray-500 dark:text-gray-400" title="Categorise this ledger in Sales / Process Register → Categorise Ledgers">
              <span>? {l.ledgerName}</span><span className="tabular-nums">₹{fmtMoney(Math.abs(l.amount))}</span>
            </div>
          ))}
        </div>
      )}

      {/* Allocations summary (from any receipt) */}
      {(inv.tds > 0 || inv.discount > 0 || inv.allocated > 0) && (
        <div className="text-[10px] mt-1.5 text-emerald-700 dark:text-emerald-400">
          Settled: Bank Recpt ₹{fmtMoney(inv.allocated)}{inv.tds > 0 ? ` · TDS ₹${fmtMoney(inv.tds)}` : ''}{inv.discount > 0 ? ` · disc ₹${fmtMoney(inv.discount)}` : ''}
        </div>
      )}

      {/* Saved note for this allocation — visible when collapsed too */}
      {myAlloc?.note && !open && (
        <div className="text-[10px] mt-1 text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-700/40 rounded p-1.5">
          📌 {myAlloc.note}
        </div>
      )}

      {/* Action: pills (TDS / Discount / Link) always visible when collapsed */}
      {!open ? (
        <div className="flex flex-wrap items-center justify-end gap-1.5 mt-2">
          {myAlloc ? (
            <>
              <button onClick={shareWhatsApp}
                title="Share this link's summary on WhatsApp"
                className="text-[11px] px-2.5 py-1 rounded-full border border-emerald-300 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20">
                📤 Share
              </button>
              <button onClick={unlink} disabled={busy}
                className="text-[11px] px-2.5 py-1 rounded-full border border-rose-300 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 disabled:opacity-50">
                ↩ Unlink
              </button>
              <button onClick={() => setOpen(true)} disabled={busy}
                className="text-[11px] px-2.5 py-1 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold">
                ✏ Edit
              </button>
            </>
          ) : (
            <>
              <button onClick={() => { autoTds(); setOpen(true) }}
                disabled={receiptRemaining <= 0}
                className="text-[11px] px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 font-semibold disabled:opacity-40">
                💰 TDS @{DEFAULT_TDS_RATE}%
              </button>
              <button onClick={() => setOpen(true)}
                disabled={receiptRemaining <= 0}
                className="text-[11px] px-2.5 py-1 rounded-full bg-rose-100 dark:bg-rose-900/40 border border-rose-300 dark:border-rose-700 text-rose-800 dark:text-rose-200 font-semibold disabled:opacity-40">
                🏷 Discount
              </button>
              <button onClick={() => setOpen(true)}
                disabled={receiptRemaining <= 0}
                className="text-[11px] px-2.5 py-1 rounded-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-semibold">
                🔗 Link
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="mt-2.5 pt-2.5 border-t border-emerald-200 dark:border-emerald-700/30 space-y-2">
          {/* Pills row */}
          <div className="flex items-center gap-2 flex-wrap text-[11px]">
            <button onClick={autoTds} type="button"
              className="px-2 py-1 rounded-full bg-amber-100 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 font-semibold">
              💰 TDS @{tdsRate || DEFAULT_TDS_RATE}%
            </button>
            <span className="text-gray-400">on taxable ₹{fmtMoney(taxable)}</span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="text-gray-500 w-12">TDS</span>
            <input type="number" value={tdsRate} onChange={e => setTdsRate(e.target.value)}
              placeholder="rate%" step="0.01"
              className="w-16 px-1.5 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700" />
            <span className="text-gray-400">%</span>
            <input type="number" value={tdsAmt} onChange={e => setTdsAmt(e.target.value)}
              placeholder="amount"
              className="flex-1 min-w-[60px] px-1.5 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 tabular-nums" />
            <span className="text-gray-400">₹</span>
          </div>

          <div className="flex items-center gap-2 flex-wrap text-[11px]">
            <button type="button"
              className="px-2 py-1 rounded-full bg-rose-100 dark:bg-rose-900/40 border border-rose-300 dark:border-rose-700 text-rose-800 dark:text-rose-200 font-semibold">
              🏷 Discount
            </button>
            <span className="text-gray-400">% or ₹</span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="text-gray-500 w-12">Disc</span>
            <input type="number" value={discPct} onChange={e => setDiscPct(e.target.value)}
              onBlur={applyDiscPct}
              placeholder="%" step="0.01"
              className="w-16 px-1.5 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700" />
            <span className="text-gray-400">%</span>
            <input type="number" value={discAmt} onChange={e => setDiscAmt(e.target.value)}
              placeholder="amount"
              className="flex-1 min-w-[60px] px-1.5 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 tabular-nums" />
            <span className="text-gray-400">₹</span>
          </div>

          {/* Final summary */}
          <div className="bg-gray-50 dark:bg-gray-700/40 rounded-lg p-2 text-[11px]">
            <div className="flex justify-between">
              <span>Ask {otherReceiptsPaid > 0 && <span className="text-[10px] text-indigo-600 dark:text-indigo-400">(pending of ₹{fmtMoney(inv.totalAmount)})</span>}</span>
              <span className="tabular-nums">₹{fmtMoney(ask)}</span>
            </div>
            {otherReceiptsPaid > 0 && (
              <div className="flex justify-between text-[10px] text-indigo-600 dark:text-indigo-400">
                <span>already paid by other receipts</span>
                <span className="tabular-nums">−₹{fmtMoney(otherReceiptsPaid)}</span>
              </div>
            )}
            {numTds > 0 && <div className="flex justify-between text-amber-700 dark:text-amber-400"><span>− TDS</span><span className="tabular-nums">₹{fmtMoney(numTds)}</span></div>}
            {numDisc > 0 && <div className="flex justify-between text-rose-700 dark:text-rose-400"><span>− Discount</span><span className="tabular-nums">₹{fmtMoney(numDisc)}</span></div>}
            <div className="flex justify-between font-bold border-t border-gray-200 dark:border-gray-600 mt-1 pt-1">
              <span>Final to allocate</span>
              <span className="tabular-nums text-emerald-700 dark:text-emerald-400">₹{fmtMoney(cappedFinal)}</span>
            </div>
            {cappedFinal < final && (
              <div className="text-[10px] text-amber-700 dark:text-amber-400 mt-0.5">
                Capped to receipt remaining (was ₹{fmtMoney(final)}).
              </div>
            )}
          </div>

          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)"
            className="w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-[11px]" />

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setOpen(false)} disabled={busy}
              className="text-[11px] px-2.5 py-1 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300">
              Cancel
            </button>
            <button onClick={save} disabled={busy || cappedFinal <= 0}
              className="text-[11px] px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-semibold">
              {busy ? 'Saving…' : (myAlloc ? 'Update Link' : 'Link ₹' + fmtMoney(cappedFinal))}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
