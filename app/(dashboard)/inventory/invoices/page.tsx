'use client'

import { useState } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import BackButton from '../../BackButton'

const fetcher = (url: string) => fetch(url).then(r => r.json())

type Tab = 'invoices' | 'drafts'

export default function InvoiceListPage() {
  const [tab, setTab] = useState<Tab>('invoices')
  const { data: invoices } = useSWR<any[]>(tab === 'invoices' ? '/api/inv/invoices' : null, fetcher)
  const { data: drafts } = useSWR<any[]>(tab === 'drafts' ? '/api/inv/invoice-drafts' : null, fetcher)
  // Always pull a count for the Drafts tab pill so the user sees pending
  // work at a glance even when they're on the Invoices tab.
  const { data: draftsForCount } = useSWR<any[]>('/api/inv/invoice-drafts', fetcher)
  const draftCount = draftsForCount?.length ?? 0

  return (
    <div className="p-4 md:p-8 max-w-5xl">
      <div className="flex items-center gap-3 mb-3">
        <BackButton />
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Purchase Invoices</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {tab === 'invoices' ? `${invoices?.length || 0} invoices` : `${drafts?.length || 0} open drafts`}
          </p>
        </div>
        {tab === 'invoices' ? (
          <>
            <Link href="/inventory/invoices/drafts/new"
              className="bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700 px-3 py-2 rounded-lg text-xs font-semibold">
              + New Draft
            </Link>
            <Link href="/inventory/invoices/new"
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-semibold">
              + New Invoice
            </Link>
          </>
        ) : (
          <Link href="/inventory/invoices/drafts/new"
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-semibold">
            + New Draft
          </Link>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-200 dark:border-gray-700">
        {([
          ['invoices', 'Invoices'],
          ['drafts', `Drafts${draftCount > 0 ? ` (${draftCount})` : ''}`],
        ] as [Tab, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition ${
              tab === k
                ? 'border-indigo-600 text-indigo-700 dark:text-indigo-300'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'invoices' && (
        !invoices?.length ? <div className="p-12 text-center text-gray-400">No invoices yet.</div>
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
                {invoices.map((inv: any) => (
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
        )
      )}

      {tab === 'drafts' && (
        !drafts?.length ? <div className="p-12 text-center text-gray-400">No open drafts. Create one to preview an invoice before finalising.</div>
          : (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300">
                <tr>
                  <th className="px-3 py-2 text-left">Draft #</th>
                  <th className="px-3 py-2 text-left">Updated</th>
                  <th className="px-3 py-2 text-left">Party</th>
                  <th className="px-3 py-2 text-left">GST</th>
                  <th className="px-3 py-2 text-right">Challans</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-left">Flags</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {drafts.map((d: any) => (
                  <tr key={d.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                    <td className="px-3 py-1.5"><Link href={`/inventory/invoices/drafts/${d.id}`} className="text-indigo-600 dark:text-indigo-400 font-mono hover:underline">#{d.id}</Link></td>
                    <td className="px-3 py-1.5 text-gray-500">{new Date(d.updatedAt).toLocaleString('en-IN')}</td>
                    <td className="px-3 py-1.5 text-gray-700 dark:text-gray-200">{d.party?.displayName}</td>
                    <td className="px-3 py-1.5">{d.gstTreatment && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300">{d.gstTreatment}</span>}</td>
                    <td className="px-3 py-1.5 text-right text-gray-500">{(d.challanIds || []).length}</td>
                    <td className="px-3 py-1.5 text-right text-gray-700 dark:text-gray-200 font-semibold">₹{Number(d.totalAmount || 0).toLocaleString('en-IN')}</td>
                    <td className="px-3 py-1.5">
                      {d.hasPendingReviewItems && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">Review</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  )
}
