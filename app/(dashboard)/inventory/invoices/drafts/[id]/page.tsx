'use client'

import useSWR from 'swr'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useState } from 'react'
import BackButton from '../../../../BackButton'

const fetcher = (url: string) => fetch(url).then(r => r.json())

export default function DraftPreviewPage() {
  const { id } = useParams() as { id: string }
  const router = useRouter()
  const { data: d, mutate } = useSWR<any>(id ? `/api/inv/invoice-drafts/${id}` : null, fetcher)

  const [showConfirm, setShowConfirm] = useState(false)
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState('')
  const [supplierInvoiceDate, setSupplierInvoiceDate] = useState(new Date().toISOString().slice(0, 10))
  const [promoting, setPromoting] = useState(false)

  async function discard() {
    if (!confirm('Discard this draft? Linked challans stay PendingInvoice.')) return
    const res = await fetch(`/api/inv/invoice-drafts/${id}`, { method: 'DELETE' })
    if (!res.ok) { const j = await res.json(); alert(j.error || 'Failed'); return }
    router.push('/inventory/invoices')
  }

  async function promote() {
    if (!supplierInvoiceNo.trim() || !supplierInvoiceDate) {
      alert('Supplier invoice number and date are required.'); return
    }
    setPromoting(true)
    try {
      const res = await fetch(`/api/inv/invoice-drafts/${id}/promote`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supplierInvoiceNo, supplierInvoiceDate }),
      })
      const j = await res.json()
      if (!res.ok) { alert(j.error || 'Promote failed'); setPromoting(false); return }
      router.push(`/inventory/invoices/${j.id}`)
    } finally { setPromoting(false) }
  }

  if (!d) return <div className="p-12 text-center text-gray-400">Loading…</div>
  if (d.error) return <div className="p-12 text-center text-rose-500">{d.error}</div>

  const isPromoted = !!d.promotedAt
  const lines: any[] = d.lines || []

  return (
    <div className="p-4 md:p-8 max-w-4xl">
      <div className="flex items-center gap-3 mb-5">
        <BackButton />
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">
            Draft Preview <span className="text-gray-400 text-base font-mono">#{d.id}</span>
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {d.party?.displayName} · {d.gstTreatment || 'GST pending'} · updated {new Date(d.updatedAt).toLocaleString('en-IN')}
          </p>
        </div>
        {isPromoted ? (
          <Link href={`/inventory/invoices/${d.promotedInvoiceId}`}
            className="text-xs font-bold bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 px-2 py-1 rounded">
            Promoted → #{d.promotedInvoiceId}
          </Link>
        ) : (
          <span className="text-xs font-bold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-2 py-1 rounded">
            Draft
          </span>
        )}
      </div>

      {/* Soft-warn: this draft's challans appear on other unpromoted drafts */}
      {!isPromoted && (d.collisions || []).length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3 mb-4 text-xs">
          <p className="font-semibold text-amber-700 dark:text-amber-300 mb-1">
            ⚠ Challan overlap with {d.collisions.length} other open draft{d.collisions.length === 1 ? '' : 's'}
          </p>
          <ul className="space-y-0.5 text-amber-700 dark:text-amber-300">
            {d.collisions.map((c: any) => (
              <li key={c.id}>
                <Link href={`/inventory/invoices/drafts/${c.id}`} className="font-mono hover:underline">
                  #{c.id}
                </Link>{' '}— {c.party?.displayName} · updated {new Date(c.updatedAt).toLocaleString('en-IN')}
              </li>
            ))}
          </ul>
          <p className="text-amber-600 dark:text-amber-400 mt-1">
            First promote wins; the loser sees a &quot;challan already invoiced&quot; error.
          </p>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-4">
        {d.challans?.length > 0 && (
          <div>
            <h3 className="text-xs font-medium text-gray-500 mb-1">Linked challans</h3>
            <div className="flex flex-wrap gap-2">
              {d.challans.map((c: any) => (
                <span key={c.id} className="text-[11px] font-mono px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300">
                  KSI/IN/{c.seriesFy}/{String(c.internalSeriesNo).padStart(4, '0')} · ₹{Number(c.totalAmount || 0).toLocaleString('en-IN')}
                </span>
              ))}
            </div>
          </div>
        )}

        <table className="w-full text-xs">
          <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300">
            <tr>
              <th className="px-2 py-1.5 text-left">#</th>
              <th className="px-2 py-1.5 text-left">Description</th>
              <th className="px-2 py-1.5 text-right">Qty</th>
              <th className="px-2 py-1.5 text-right">Rate</th>
              <th className="px-2 py-1.5 text-right">Net</th>
              <th className="px-2 py-1.5 text-right">GST</th>
              <th className="px-2 py-1.5 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {lines.map((l: any, i: number) => (
              <tr key={i}>
                <td className="px-2 py-1 text-gray-500">{l.lineNo}</td>
                <td className="px-2 py-1">{l.description || l.freeTextLabel || '—'}</td>
                <td className="px-2 py-1 text-right">{l.qty != null ? `${Number(l.qty)} ${l.unit || ''}` : '—'}</td>
                <td className="px-2 py-1 text-right">{l.rate != null ? '₹' + Number(l.rate).toFixed(2) : '—'}</td>
                <td className="px-2 py-1 text-right">₹{Number(l.amount).toLocaleString('en-IN')}</td>
                <td className="px-2 py-1 text-right">{l.gstAmount ? '₹' + Number(l.gstAmount).toFixed(2) : '—'}</td>
                <td className="px-2 py-1 text-right">{l.total ? '₹' + Number(l.total).toLocaleString('en-IN') : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-3 text-sm grid grid-cols-2 gap-1">
          <span className="text-gray-500">Taxable</span><span className="text-right">₹{Number(d.taxableAmount || 0).toLocaleString('en-IN')}</span>
          {Number(d.igstAmount) > 0 && <><span className="text-gray-500">IGST</span><span className="text-right">₹{Number(d.igstAmount).toLocaleString('en-IN')}</span></>}
          {Number(d.cgstAmount) > 0 && <><span className="text-gray-500">CGST</span><span className="text-right">₹{Number(d.cgstAmount).toLocaleString('en-IN')}</span></>}
          {Number(d.sgstAmount) > 0 && <><span className="text-gray-500">SGST</span><span className="text-right">₹{Number(d.sgstAmount).toLocaleString('en-IN')}</span></>}
          {Number(d.freightAmount) > 0 && <><span className="text-gray-500">Freight</span><span className="text-right">₹{Number(d.freightAmount).toLocaleString('en-IN')}</span></>}
          {Number(d.otherCharges) > 0 && <><span className="text-gray-500">Other charges</span><span className="text-right">₹{Number(d.otherCharges).toLocaleString('en-IN')}</span></>}
          {Number(d.discountAmount) > 0 && (
            <>
              <span className="text-rose-600 dark:text-rose-400">Discount</span>
              <span className="text-right text-rose-600 dark:text-rose-400">− ₹{Number(d.discountAmount).toLocaleString('en-IN')}</span>
            </>
          )}
          <span className="text-gray-500 font-bold border-t border-gray-200 dark:border-gray-700 pt-1">Total</span>
          <span className="text-right font-bold border-t border-gray-200 dark:border-gray-700 pt-1">₹{Number(d.totalAmount || 0).toLocaleString('en-IN')}</span>
        </div>

        {d.hasPendingReviewItems && !isPromoted && (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            ⚠ One or more items are pending review. Push-to-Tally will be blocked on the promoted invoice until you approve them.
          </p>
        )}

        {!isPromoted && (
          <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-700">
            <button onClick={discard}
              className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300 px-4 py-2 rounded-lg text-sm font-semibold border border-red-200 dark:border-red-800">
              Discard
            </button>
            <Link href={`/inventory/invoices/drafts/new?draftId=${d.id}`}
              className="bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 px-4 py-2 rounded-lg text-sm font-semibold">
              Edit
            </Link>
            <button onClick={() => setShowConfirm(true)}
              className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold">
              Enter Invoice No & Confirm
            </button>
          </div>
        )}
      </div>

      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowConfirm(false)}>
          <div onClick={e => e.stopPropagation()} className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-5 w-full max-w-sm space-y-3">
            <h3 className="text-base font-bold text-gray-800 dark:text-gray-100">Confirm & Promote</h3>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              Creates the real Purchase Invoice and flips the linked challans to Invoiced. Then you can push to Tally from the invoice screen.
            </p>
            <label className="block text-xs">
              <span className="text-gray-500 dark:text-gray-400">Supplier Invoice No *</span>
              <input value={supplierInvoiceNo} onChange={e => setSupplierInvoiceNo(e.target.value)} autoFocus
                className="mt-0.5 w-full px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
            </label>
            <label className="block text-xs">
              <span className="text-gray-500 dark:text-gray-400">Invoice Date *</span>
              <input type="date" value={supplierInvoiceDate} onChange={e => setSupplierInvoiceDate(e.target.value)}
                className="mt-0.5 w-full px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
            </label>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setShowConfirm(false)} className="flex-1 px-3 py-2 rounded-lg text-xs bg-gray-200 dark:bg-gray-700">Cancel</button>
              <button onClick={promote} disabled={promoting}
                className="flex-1 px-3 py-2 rounded-lg text-xs bg-indigo-600 text-white font-semibold disabled:opacity-50">
                {promoting ? 'Promoting…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
