'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import useSWR from 'swr'
import BackButton from '../../../BackButton'

const fetcher = (url: string) => fetch(url).then(r => r.json())
const fmtMoney = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (iso: string) => {
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}-${d.toLocaleString('en-IN', { month: 'short' })}-${String(d.getFullYear()).slice(2)}`
}

interface Line { id: number; lineNo: number; stockItem: string; rawQty: string | null; qty: number | null; unit: string | null; rate: number | null; amount: number; discountPct: number | null; baleNo: string | null }
interface Allocation { id: number; allocatedAmount: number; note: string | null; receipt?: { id: number; vchNumber: string; date: string; amount: number } }
interface Invoice {
  id: number; date: string; vchNumber: string; vchType: string; partyName: string; partyGstin: string | null
  totalAmount: number; taxableAmount: number | null; cgstAmount: number | null; sgstAmount: number | null; igstAmount: number | null; roundOff: number | null
  narration: string | null; reference: string | null; buyerPO: string | null; transporter: string | null; agentName: string | null
  lines: Line[]; allocations: Allocation[]; allocated: number; pending: number
}
interface Receipt {
  id: number; date: string; vchNumber: string; partyName: string; amount: number; narration: string | null
  instrumentNo: string | null; bankRef: string | null; allocations: { invoiceId: number; allocatedAmount: number }[]
}

export default function ReceiptDetailPage() {
  const params = useParams()
  const id = params.id as string
  const { data, mutate, isLoading } = useSWR<{ receipt: Receipt; invoices: Invoice[] }>(
    `/api/accounts/receipts/${id}`, fetcher,
  )
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')

  if (isLoading) return <div className="max-w-3xl mx-auto p-3"><BackButton /><div className="text-center py-8 text-gray-400 text-sm">Loading…</div></div>
  if (!data?.receipt) return <div className="max-w-3xl mx-auto p-3"><BackButton /><div className="p-8 text-center text-rose-500">Receipt not found</div></div>

  const r = data.receipt
  const invoices = data.invoices
  const linkedInvoiceIds = new Set(r.allocations.map(a => a.invoiceId))
  const receiptRemaining = r.amount - r.allocations.reduce((s, a) => s + a.allocatedAmount, 0)

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

  async function linkInvoice(inv: Invoice) {
    const suggested = Math.min(receiptRemaining, inv.pending) || 0
    const input = window.prompt(`Allocate amount to ${inv.vchNumber}?\nReceipt remaining: ₹${fmtMoney(receiptRemaining)} | Invoice pending: ₹${fmtMoney(inv.pending)}`, String(suggested.toFixed(2)))
    if (input === null) return
    const amt = parseFloat(input)
    if (!Number.isFinite(amt) || amt <= 0) return alert('Invalid amount')
    const note = window.prompt('Note (optional):') || undefined
    try {
      const res = await fetch(`/api/accounts/receipts/${id}/allocate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: inv.id, allocatedAmount: amt, note }),
      })
      const d = await res.json()
      if (!res.ok) return alert(d.error || 'Failed')
      mutate()
    } catch (e: any) { alert(e?.message || 'Network error') }
  }

  async function unlinkInvoice(inv: Invoice) {
    if (!confirm(`Remove link to ${inv.vchNumber}?`)) return
    try {
      const res = await fetch(`/api/accounts/receipts/${id}/allocate`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: inv.id }),
      })
      const d = await res.json()
      if (!res.ok) return alert(d.error || 'Failed')
      mutate()
    } catch (e: any) { alert(e?.message || 'Network error') }
  }

  return (
    <div className="max-w-3xl mx-auto p-3 pb-20">
      <div className="flex items-center gap-2 mb-3">
        <BackButton />
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
          </div>
        </div>
      </div>

      {/* Invoices for this party */}
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          Sales / Process Invoices for this party ({invoices.length})
        </h2>
        <button onClick={syncSales} disabled={syncing}
          className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-[11px] font-semibold">
          {syncing ? 'Syncing…' : 'Sync from Tally'}
        </button>
      </div>
      {syncMsg && <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">{syncMsg}</div>}

      {invoices.length === 0 ? (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400 text-sm border border-dashed rounded-xl">
          No KSI Process Job invoices for &ldquo;{r.partyName}&rdquo;.<br />
          <span className="text-[11px]">Tap &ldquo;Sync from Tally&rdquo; to backfill.</span>
        </div>
      ) : (
        <div className="space-y-2">
          {invoices.map(inv => {
            const isLinked = linkedInvoiceIds.has(inv.id)
            return (
              <div key={inv.id}
                className={`bg-white dark:bg-gray-800 border rounded-xl p-3 transition ${
                  isLinked ? 'border-emerald-400 ring-1 ring-emerald-200 dark:ring-emerald-700/40' : 'border-gray-100 dark:border-gray-700'
                }`}>
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300">
                        {inv.vchType} {inv.vchNumber}
                      </span>
                      <span className="text-[10px] text-gray-500 dark:text-gray-400">{fmtDate(inv.date)}</span>
                      {isLinked && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                          ✓ Linked
                        </span>
                      )}
                    </div>
                    {inv.partyGstin && <div className="text-[10px] text-gray-500 dark:text-gray-400">GSTIN: {inv.partyGstin}</div>}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-base font-bold text-gray-800 dark:text-gray-100 tabular-nums">₹{fmtMoney(inv.totalAmount)}</div>
                    <div className="text-[10px] text-gray-500">pending ₹{fmtMoney(inv.pending)}</div>
                  </div>
                </div>
                {/* Item-level lines */}
                {inv.lines.length > 0 && (
                  <div className="border-t border-gray-100 dark:border-gray-700 pt-1.5 mt-1.5 space-y-0.5">
                    {inv.lines.map(l => (
                      <div key={l.id} className="text-[11px] text-gray-600 dark:text-gray-300 flex items-center justify-between gap-2">
                        <span className="truncate">{l.stockItem}</span>
                        <span className="shrink-0 text-gray-500 tabular-nums">
                          {l.rawQty} {l.rate != null && `@ ₹${l.rate}`} · ₹{fmtMoney(l.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {/* Tax + total breakdown */}
                {(inv.cgstAmount || inv.sgstAmount || inv.igstAmount) && (
                  <div className="text-[10px] text-gray-500 mt-1">
                    Taxable ₹{fmtMoney(inv.taxableAmount || 0)}
                    {inv.cgstAmount ? ` · CGST ₹${fmtMoney(inv.cgstAmount)}` : ''}
                    {inv.sgstAmount ? ` · SGST ₹${fmtMoney(inv.sgstAmount)}` : ''}
                    {inv.igstAmount ? ` · IGST ₹${fmtMoney(inv.igstAmount)}` : ''}
                  </div>
                )}
                {(inv.buyerPO || inv.reference) && (
                  <div className="text-[10px] text-gray-500 mt-0.5">
                    {inv.buyerPO && <span>PO: {inv.buyerPO} </span>}
                    {inv.reference && <span>· Ref: {inv.reference}</span>}
                  </div>
                )}
                {/* Allocations from other receipts */}
                {inv.allocations.length > 0 && (
                  <div className="text-[10px] text-emerald-700 dark:text-emerald-300 mt-1">
                    Allocated: {inv.allocations.map(a => `Rcpt#${a.receipt?.vchNumber} ₹${fmtMoney(a.allocatedAmount)}`).join(' · ')}
                  </div>
                )}
                {/* Action button */}
                <div className="flex justify-end mt-2">
                  {isLinked ? (
                    <button onClick={() => unlinkInvoice(inv)}
                      className="text-[11px] px-2.5 py-1 rounded-lg border border-rose-300 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20">
                      ↩ Unlink
                    </button>
                  ) : (
                    <button onClick={() => linkInvoice(inv)}
                      disabled={receiptRemaining <= 0}
                      className="text-[11px] px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-semibold">
                      🔗 Link Receipt
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
