'use client'

import useSWR from 'swr'
import { useParams } from 'next/navigation'
import BackButton from '../../../BackButton'

const fetcher = (url: string) => fetch(url).then(r => r.json())

export default function PODetailPage() {
  const { id } = useParams() as { id: string }
  const { data: po, mutate, isLoading } = useSWR<any>(id ? `/api/inv/pos/${id}` : null, fetcher)

  async function setStatus(status: string) {
    await fetch(`/api/inv/pos/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    mutate()
  }

  if (isLoading) return <div className="p-12 text-center text-gray-400">Loading…</div>
  if (!po) return <div className="p-12 text-center text-gray-400">Not found.</div>

  return (
    <div className="p-4 md:p-8 max-w-4xl">
      <div className="flex items-center gap-3 mb-5">
        <BackButton />
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 font-mono">{po.poNo}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{po.party?.displayName} · {new Date(po.poDate).toLocaleDateString('en-IN')}</p>
        </div>
        <span className="text-xs font-bold px-2 py-1 rounded bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200">{po.status}</span>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
        {po.expectedDate && <p className="text-sm"><span className="text-gray-500">Expected:</span> {new Date(po.expectedDate).toLocaleDateString('en-IN')}</p>}
        {po.terms && <p className="text-xs italic text-gray-500">{po.terms}</p>}
        <table className="w-full text-xs">
          <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300">
            <tr>
              <th className="px-2 py-1.5 text-left">#</th>
              <th className="px-2 py-1.5 text-left">Item</th>
              <th className="px-2 py-1.5 text-right">Qty</th>
              <th className="px-2 py-1.5 text-right">Rcv</th>
              <th className="px-2 py-1.5 text-right">Rate</th>
              <th className="px-2 py-1.5 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {po.lines.map((l: any) => (
              <tr key={l.id}>
                <td className="px-2 py-1 text-gray-500">{l.lineNo}</td>
                <td className="px-2 py-1">{l.item.displayName}</td>
                <td className="px-2 py-1 text-right">{Number(l.qty)} {l.unit}</td>
                <td className="px-2 py-1 text-right">{Number(l.receivedQty)}</td>
                <td className="px-2 py-1 text-right">₹{Number(l.rate).toFixed(2)}</td>
                <td className="px-2 py-1 text-right">₹{Number(l.amount).toLocaleString('en-IN')}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 font-bold"><td colSpan={5} className="px-2 py-2 text-right">Total</td><td className="px-2 py-2 text-right">₹{Number(po.totalAmount || 0).toLocaleString('en-IN')}</td></tr>
          </tfoot>
        </table>

        <div className="flex gap-2 justify-end pt-3 border-t border-gray-200 dark:border-gray-700">
          {po.status === 'Draft' && <button onClick={() => setStatus('Approved')} className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-semibold">Approve</button>}
          {po.status === 'Approved' && <button onClick={() => setStatus('Open')} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold">Open</button>}
          {po.status !== 'Cancelled' && po.status !== 'Closed' && (
            <button onClick={() => setStatus('Cancelled')} className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300 px-4 py-2 rounded-lg text-sm font-semibold border border-red-200 dark:border-red-800">Cancel</button>
          )}
        </div>
      </div>
    </div>
  )
}
