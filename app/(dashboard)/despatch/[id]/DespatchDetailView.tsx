'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface Entry {
  id: number
  date: string
  challanNo: number
  lotNo: string
  than: number
  billNo: string | null
  rate: number | null
  pTotal: number | null
  lrNo: string | null
  bale: number | null
  narration: string | null
  grayInwDate: string | null
  jobDelivery: string | null
  party: { name: string }
  quality: { name: string }
  transport: { name: string } | null
  changeLogs: { id: number; field: string; oldValue: string; newValue: string; changedBy: string; createdAt: string }[]
}

export default function DespatchDetailView({ id }: { id: string }) {
  const router = useRouter()
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // First fetch the entry to get challanNo, then fetch all entries with same challan
    fetch(`/api/despatch/${id}`)
      .then(r => r.json())
      .then(entry => {
        if (entry.challanNo) {
          return fetch(`/api/despatch/challan/${entry.challanNo}`).then(r => r.json())
        }
        return [entry]
      })
      .then(data => { setEntries(Array.isArray(data) ? data : [data]); setLoading(false) })
      .catch(() => setLoading(false))
  }, [id])

  if (loading) return <div className="p-8 text-gray-400">Loading...</div>
  if (entries.length === 0) return <div className="p-8 text-red-500">Entry not found.</div>

  const first = entries[0]
  const totalThan = entries.reduce((s, e) => s + e.than, 0)
  const totalAmount = entries.reduce((s, e) => s + (e.pTotal ?? 0), 0)
  const allChangeLogs = entries.flatMap(e => (e.changeLogs || []).map(c => ({ ...c, lotNo: e.lotNo })))

  return (
    <div className="p-4 md:p-8 max-w-2xl">
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg px-4 py-2 text-sm font-medium transition">
          &larr; Back
        </button>
        <h1 className="text-xl font-bold text-gray-800">Challan #{first.challanNo}</h1>
      </div>

      {/* Challan Info */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 mb-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Challan Details</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs text-gray-400 dark:text-gray-500">Date</p>
            <p className="font-medium">{new Date(first.date).toLocaleDateString('en-IN')}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 dark:text-gray-500">Party</p>
            <p className="font-medium">{first.party.name}</p>
          </div>
          {first.grayInwDate && (
            <div>
              <p className="text-xs text-gray-400 dark:text-gray-500">Grey Inward Date</p>
              <p>{new Date(first.grayInwDate).toLocaleDateString('en-IN')}</p>
            </div>
          )}
          {first.jobDelivery && (
            <div>
              <p className="text-xs text-gray-400 dark:text-gray-500">Job Delivery</p>
              <p>{first.jobDelivery}</p>
            </div>
          )}
        </div>
      </div>

      {/* Lot entries */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700">Lots in this Challan</h2>
          <span className="text-xs text-gray-400 dark:text-gray-500">{entries.length} lot{entries.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="space-y-3">
          {entries.map(e => (
            <div key={e.id} className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 bg-gray-50 dark:bg-gray-700/50">
              <div className="flex items-center justify-between mb-2">
                <Link href={`/lot/${encodeURIComponent(e.lotNo)}`} className="text-sm font-semibold text-indigo-700 hover:underline">
                  {e.lotNo}
                </Link>
                <Link href={`/despatch/${e.id}/edit`} className="text-xs text-indigo-500 border border-indigo-200 rounded px-2 py-0.5 hover:bg-indigo-50">
                  Edit
                </Link>
              </div>
              <p className="text-xs text-gray-500 mb-2">{e.quality.name}</p>
              {e.narration && <p className="text-xs text-gray-400 mb-2 italic">{e.narration}</p>}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div>
                  <span className="text-gray-400">Than</span>
                  <p className="font-bold text-gray-800">{e.than}</p>
                </div>
                <div>
                  <span className="text-gray-400">Rate</span>
                  <p className="font-medium">{e.rate ? `₹${e.rate}` : '—'}</p>
                </div>
                <div>
                  <span className="text-gray-400">Bill No</span>
                  <p>{e.billNo || '—'}</p>
                </div>
                <div>
                  <span className="text-gray-400">P.Total</span>
                  <p className="font-medium text-orange-700">{e.pTotal ? `₹${e.pTotal.toFixed(2)}` : '—'}</p>
                </div>
              </div>
              {(e.lrNo || e.bale || e.transport) && (
                <div className="flex flex-wrap gap-3 mt-2 text-[10px] text-gray-400">
                  {e.lrNo && <span>LR: {e.lrNo}</span>}
                  {e.transport && <span>Transport: {e.transport.name}</span>}
                  {e.bale && <span>Bale: {e.bale}</span>}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Totals */}
        {entries.length > 1 && (
          <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 flex justify-between text-sm">
            <span className="font-semibold text-gray-700">Total</span>
            <div className="flex gap-4">
              <span className="font-bold text-gray-800">{totalThan} than</span>
              {totalAmount > 0 && <span className="font-bold text-orange-700">₹{totalAmount.toFixed(2)}</span>}
            </div>
          </div>
        )}
      </div>

      {/* Change History */}
      {allChangeLogs.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 mb-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Change History</h2>
          <div className="space-y-2">
            {allChangeLogs.map(c => (
              <div key={c.id} className="flex items-center gap-3 text-xs bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <span className="text-gray-400">{new Date(c.createdAt).toLocaleDateString('en-IN')}</span>
                <span className="font-medium text-amber-800">{c.field}: {c.oldValue} → {c.newValue}</span>
                <span className="text-gray-400">({c.lotNo})</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
