'use client'

import useSWR from 'swr'
import { useParams, useRouter } from 'next/navigation'
import BackButton from '../../../BackButton'

const fetcher = (url: string) => fetch(url).then(r => r.json())

export default function ChallanDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id
  const { data: c, mutate, isLoading } = useSWR<any>(id ? `/api/inv/challans/${id}` : null, fetcher)

  async function verify() {
    if (!confirm('Verify this challan? Stock IN movements will be created for tracked items.')) return
    const res = await fetch(`/api/inv/challans/${id}/verify`, { method: 'POST' })
    if (!res.ok) { const d = await res.json(); alert(d.error || 'Failed'); return }
    mutate()
  }
  async function cancel() {
    const reason = prompt('Reason for cancellation?'); if (reason === null) return
    const res = await fetch(`/api/inv/challans/${id}/cancel`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }),
    })
    if (!res.ok) { const d = await res.json(); alert(d.error || 'Failed'); return }
    mutate()
  }

  if (isLoading) return <div className="p-12 text-center text-gray-400">Loading…</div>
  if (!c) return <div className="p-12 text-center text-gray-400">Not found.</div>

  return (
    <div className="p-4 md:p-8 max-w-4xl">
      <div className="flex items-center gap-3 mb-5">
        <BackButton />
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Challan {c.challanNo}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 font-mono">KSI/IN/{c.seriesFy}/{String(c.internalSeriesNo).padStart(4, '0')} · {new Date(c.challanDate).toLocaleDateString('en-IN')}</p>
        </div>
        <span className={`text-xs font-bold px-2 py-1 rounded ${
          c.status === 'Invoiced' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
          c.status === 'Cancelled' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' :
          'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200'
        }`}>{c.status}</span>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
        <div className="grid md:grid-cols-2 gap-3 text-sm">
          <div><span className="text-gray-500">Party:</span> <span className="font-medium">{c.party.displayName}</span></div>
          {c.po && <div><span className="text-gray-500">PO:</span> <span className="font-mono">{c.po.poNo}</span></div>}
          {c.biltyNo && <div><span className="text-gray-500">Bilty:</span> {c.biltyNo}</div>}
          {c.vehicleNo && <div><span className="text-gray-500">Vehicle:</span> {c.vehicleNo}</div>}
          {c.transporter && <div><span className="text-gray-500">Transporter:</span> {c.transporter}</div>}
        </div>
        {c.notes && <p className="text-xs text-gray-500 italic">{c.notes}</p>}

        <table className="w-full text-xs mt-3">
          <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300">
            <tr>
              <th className="px-2 py-1.5 text-left">#</th>
              <th className="px-2 py-1.5 text-left">Item</th>
              <th className="px-2 py-1.5 text-left">Alias</th>
              <th className="px-2 py-1.5 text-right">Qty</th>
              <th className="px-2 py-1.5 text-right">Rate</th>
              <th className="px-2 py-1.5 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {c.lines.map((l: any) => (
              <tr key={l.id}>
                <td className="px-2 py-1 text-gray-500">{l.lineNo}</td>
                <td className="px-2 py-1 font-medium text-gray-800 dark:text-gray-100">{l.item.displayName}</td>
                <td className="px-2 py-1 text-gray-500">{l.item.alias.tallyStockItem}</td>
                <td className="px-2 py-1 text-right">{Number(l.qty)} {l.unit}</td>
                <td className="px-2 py-1 text-right">{l.rate ? '₹' + Number(l.rate).toFixed(2) : '—'}</td>
                <td className="px-2 py-1 text-right">{l.amount ? '₹' + Number(l.amount).toLocaleString('en-IN') : '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-300 dark:border-gray-600 font-bold">
              <td colSpan={3} className="px-2 py-2 text-right">Total</td>
              <td className="px-2 py-2 text-right">{Number(c.totalQty || 0)}</td>
              <td></td>
              <td className="px-2 py-2 text-right">{c.totalAmount ? '₹' + Number(c.totalAmount).toLocaleString('en-IN') : '—'}</td>
            </tr>
          </tfoot>
        </table>

        {c.invoiceLink?.invoice && (
          <p className="text-xs text-gray-500 pt-3 border-t border-gray-200 dark:border-gray-700">
            ✓ Linked to invoice <span className="font-mono">{c.invoiceLink.invoice.supplierInvoiceNo}</span> ({c.invoiceLink.invoice.status})
          </p>
        )}

        <div className="flex gap-2 justify-end pt-3 border-t border-gray-200 dark:border-gray-700">
          {(c.status === 'Draft' || c.status === 'PendingApproval') && (
            <button onClick={verify} className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-semibold">Verify</button>
          )}
          {c.status !== 'Invoiced' && c.status !== 'Cancelled' && (
            <button onClick={cancel} className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300 px-4 py-2 rounded-lg text-sm font-semibold border border-red-200 dark:border-red-800">Cancel</button>
          )}
        </div>
      </div>
    </div>
  )
}
