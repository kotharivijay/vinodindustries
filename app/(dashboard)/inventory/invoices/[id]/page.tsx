'use client'

import useSWR from 'swr'
import { useParams } from 'next/navigation'
import BackButton from '../../../BackButton'

const fetcher = (url: string) => fetch(url).then(r => r.json())

export default function InvoiceDetailPage() {
  const { id } = useParams() as { id: string }
  const { data: inv, mutate } = useSWR<any>(id ? `/api/inv/invoices/${id}` : null, fetcher)

  async function voidInv() {
    if (!confirm('Void this invoice? Linked challans will be freed back to PendingInvoice.')) return
    const res = await fetch(`/api/inv/invoices/${id}/void`, { method: 'POST' })
    if (!res.ok) { const d = await res.json(); alert(d.error || 'Failed'); return }
    mutate()
  }
  async function pushToTally() {
    if (!confirm('Push this invoice to Tally as a Purchase voucher?')) return
    const res = await fetch(`/api/inv/invoices/${id}/push-to-tally`, { method: 'POST' })
    const d = await res.json()
    if (d.failures && d.failures.length) {
      alert('Pre-push validation failed:\n' + d.failures.map((f: any) => `• ${f.message}`).join('\n'))
      return
    }
    if (!d.ok) {
      alert('Push failed: ' + (d.error || JSON.stringify(d.parsed || d.body || '').slice(0, 300)))
      mutate()
      return
    }
    alert(`✓ Pushed to Tally — voucher ${d.vchkey || 'created'}`)
    mutate()
  }
  async function previewPayload() {
    const res = await fetch(`/api/inv/invoices/${id}/preview-payload`)
    const d = await res.json()
    const w = window.open('', '_blank')
    if (w) {
      w.document.write(`<pre style="font-family:monospace;font-size:11px;padding:16px">${JSON.stringify(d, null, 2).replace(/[<>]/g, c => c === '<' ? '&lt;' : '&gt;')}</pre>`)
    }
  }

  if (!inv) return <div className="p-12 text-center text-gray-400">Loading…</div>

  return (
    <div className="p-4 md:p-8 max-w-4xl">
      <div className="flex items-center gap-3 mb-5">
        <BackButton />
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 font-mono">{inv.supplierInvoiceNo}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{inv.party?.displayName} · {new Date(inv.supplierInvoiceDate).toLocaleDateString('en-IN')} · {inv.gstTreatment}</p>
        </div>
        <span className={`text-xs font-bold px-2 py-1 rounded ${
          inv.status === 'PushedToTally' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
          inv.status === 'Voided' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' :
          'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200'
        }`}>{inv.status}</span>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
        {inv.challans.length > 0 && (
          <div>
            <h3 className="text-xs font-medium text-gray-500 mb-1">Linked challans</h3>
            <div className="flex flex-wrap gap-2">
              {inv.challans.map((c: any) => (
                <span key={c.challanId} className="text-[11px] font-mono px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300">
                  KSI/IN/{c.challan.seriesFy}/{String(c.challan.internalSeriesNo).padStart(4, '0')}
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
            {inv.lines.map((l: any) => (
              <tr key={l.id}>
                <td className="px-2 py-1 text-gray-500">{l.lineNo}</td>
                <td className="px-2 py-1">{l.description || l.item?.displayName || l.freeTextLabel}</td>
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
          <span className="text-gray-500">Taxable</span><span className="text-right">₹{Number(inv.taxableAmount).toLocaleString('en-IN')}</span>
          {Number(inv.igstAmount) > 0 && <><span className="text-gray-500">IGST</span><span className="text-right">₹{Number(inv.igstAmount).toLocaleString('en-IN')}</span></>}
          {Number(inv.cgstAmount) > 0 && <><span className="text-gray-500">CGST</span><span className="text-right">₹{Number(inv.cgstAmount).toLocaleString('en-IN')}</span></>}
          {Number(inv.sgstAmount) > 0 && <><span className="text-gray-500">SGST</span><span className="text-right">₹{Number(inv.sgstAmount).toLocaleString('en-IN')}</span></>}
          {Number(inv.freightAmount) > 0 && <><span className="text-gray-500">Freight</span><span className="text-right">₹{Number(inv.freightAmount).toLocaleString('en-IN')}</span></>}
          <span className="text-gray-500 font-bold border-t border-gray-200 dark:border-gray-700 pt-1">Total</span>
          <span className="text-right font-bold border-t border-gray-200 dark:border-gray-700 pt-1">₹{Number(inv.totalAmount).toLocaleString('en-IN')}</span>
        </div>

        {inv.tallyVoucherNo && (
          <p className="text-xs text-green-700 dark:text-green-300">✓ Pushed as Tally voucher {inv.tallyVoucherNo}</p>
        )}

        <div className="flex gap-2 justify-end pt-3 border-t border-gray-200 dark:border-gray-700">
          {inv.status !== 'Voided' && (
            <button onClick={previewPayload} className="bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 px-4 py-2 rounded-lg text-sm font-medium">👁 Preview JSON</button>
          )}
          {inv.status !== 'Voided' && inv.status !== 'PushedToTally' && (
            <button onClick={pushToTally} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold">📤 Push to Tally</button>
          )}
          {inv.status !== 'Voided' && (
            <button onClick={voidInv} className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300 px-4 py-2 rounded-lg text-sm font-semibold border border-red-200 dark:border-red-800">Void</button>
          )}
        </div>
      </div>
    </div>
  )
}
