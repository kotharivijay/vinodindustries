'use client'

import useSWR from 'swr'
import Link from 'next/link'
import BackButton from '../../BackButton'

const fetcher = (url: string) => fetch(url).then(r => r.json())

export default function InvoiceListPage() {
  const { data } = useSWR<any[]>('/api/inv/invoices', fetcher)

  return (
    <div className="p-4 md:p-8 max-w-5xl">
      <div className="flex items-center gap-3 mb-5">
        <BackButton />
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Purchase Invoices</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{data?.length || 0} invoices</p>
        </div>
        <Link href="/inventory/invoices/new" className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-semibold">+ New Invoice</Link>
      </div>

      {!data?.length ? <div className="p-12 text-center text-gray-400">No invoices yet.</div>
        : (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300">
              <tr>
                <th className="px-3 py-2 text-left">Invoice No</th>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Party</th>
                <th className="px-3 py-2 text-left">GST</th>
                <th className="px-3 py-2 text-right">Lines</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {data.map((inv: any) => (
                <tr key={inv.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                  <td className="px-3 py-1.5"><Link href={`/inventory/invoices/${inv.id}`} className="text-indigo-600 dark:text-indigo-400 font-mono hover:underline">{inv.supplierInvoiceNo}</Link></td>
                  <td className="px-3 py-1.5 text-gray-500">{new Date(inv.supplierInvoiceDate).toLocaleDateString('en-IN')}</td>
                  <td className="px-3 py-1.5 text-gray-700 dark:text-gray-200">{inv.party?.displayName}</td>
                  <td className="px-3 py-1.5"><span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300">{inv.gstTreatment}</span></td>
                  <td className="px-3 py-1.5 text-right text-gray-500">{inv._count?.lines}</td>
                  <td className="px-3 py-1.5 text-right text-gray-700 dark:text-gray-200 font-semibold">₹{Number(inv.totalAmount || 0).toLocaleString('en-IN')}</td>
                  <td className="px-3 py-1.5"><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    inv.status === 'PushedToTally' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
                    inv.status === 'Voided' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' :
                    inv.status === 'PushPending' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' :
                    'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200'
                  }`}>{inv.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
