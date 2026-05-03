'use client'

import { useState } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import BackButton from '../../BackButton'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const STATUSES = ['Draft', 'PendingInvoice', 'Invoiced', 'Cancelled']

export default function ChallansListPage() {
  const [status, setStatus] = useState<string>('')
  const [search, setSearch] = useState('')
  const qs = new URLSearchParams()
  if (status) qs.set('status', status)
  if (search) qs.set('q', search)
  const { data, isLoading } = useSWR<any[]>(`/api/inv/challans?${qs.toString()}`, fetcher)

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <div className="flex items-center gap-3 mb-5">
        <BackButton />
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Inward Challans</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{data?.length || 0} matching</p>
        </div>
        <Link href="/inventory/challans/new" className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-semibold">+ New</Link>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <button onClick={() => setStatus('')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${!status ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300'}`}>All</button>
        {STATUSES.map(s => (
          <button key={s} onClick={() => setStatus(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${status === s ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300'}`}>{s}</button>
        ))}
        <input type="search" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search challan no…"
          className="flex-1 min-w-[180px] px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs" />
      </div>

      {isLoading ? <div className="p-12 text-center text-gray-400">Loading…</div>
        : !data?.length ? <div className="p-12 text-center text-gray-400">No challans yet.</div>
        : (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300">
              <tr>
                <th className="px-3 py-2 text-left">Series</th>
                <th className="px-3 py-2 text-left">Challan No</th>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Party</th>
                <th className="px-3 py-2 text-right">Lines</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {data.map((c: any) => (
                <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                  <td className="px-3 py-1.5">
                    <Link href={`/inventory/challans/${c.id}`} className="text-indigo-600 dark:text-indigo-400 font-mono hover:underline">
                      KSI/IN/{c.seriesFy}/{String(c.internalSeriesNo).padStart(4, '0')}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5 font-medium text-gray-800 dark:text-gray-100">{c.challanNo}</td>
                  <td className="px-3 py-1.5 text-gray-500">{new Date(c.challanDate).toLocaleDateString('en-IN')}</td>
                  <td className="px-3 py-1.5 text-gray-700 dark:text-gray-200">{c.party?.displayName}</td>
                  <td className="px-3 py-1.5 text-right text-gray-500">{c.lines?.length}</td>
                  <td className="px-3 py-1.5 text-right text-gray-700 dark:text-gray-200 font-semibold">
                    {c.totalAmount ? '₹' + Number(c.totalAmount).toLocaleString('en-IN') : '—'}
                  </td>
                  <td className="px-3 py-1.5">
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200">{c.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
