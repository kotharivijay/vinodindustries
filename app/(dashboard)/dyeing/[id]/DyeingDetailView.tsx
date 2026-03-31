'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface Lot { id: number; lotNo: string; than: number }
interface Chemical {
  id: number
  name: string
  quantity: number | null
  unit: string
  rate: number | null
  cost: number | null
  processTag?: string | null
}
interface Entry {
  id: number
  date: string
  slipNo: number
  lotNo: string
  than: number
  notes: string | null
  shadeName?: string | null
  lots: Lot[]
  chemicals: Chemical[]
  machine?: { id: number; name: string } | null
  operator?: { id: number; name: string } | null
  foldBatch?: {
    batchNo: number
    foldProgram?: { foldNo: string }
    shade?: { name: string }
  } | null
}

export default function DyeingDetailView({ id }: { id: string }) {
  const router = useRouter()
  const [entry, setEntry] = useState<Entry | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/dyeing/${id}`)
      .then(r => r.json())
      .then(d => { setEntry(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [id])

  if (loading) return <div className="p-8 text-gray-400">Loading...</div>
  if (!entry) return <div className="p-8 text-red-500">Entry not found.</div>

  const lots = entry.lots?.length ? entry.lots : [{ id: 0, lotNo: entry.lotNo, than: entry.than }]
  const totalThan = lots.reduce((s, l) => s + l.than, 0)
  const totalCost = entry.chemicals?.reduce((s, c) => s + (c.cost ?? 0), 0) ?? 0
  const costPerThan = totalThan > 0 ? totalCost / totalThan : 0

  return (
    <div className="p-4 md:p-8 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg px-4 py-2 text-sm font-medium transition">&larr; Back</button>
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Slip #{entry.slipNo}</h1>
        <div className="ml-auto flex gap-2">
          <Link href={`/dyeing/${id}/print`} target="_blank" className="text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5">
            Print
          </Link>
          <Link href={`/dyeing/${id}/edit`} className="text-sm font-medium text-purple-600 dark:text-purple-400 hover:text-purple-800 dark:hover:text-purple-300 border border-purple-200 dark:border-purple-700 rounded-lg px-3 py-1.5">
            Edit
          </Link>
        </div>
      </div>

      {/* Slip Info Card */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 mb-4">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Slip Details</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs text-gray-400">Date</p>
            <p className="font-medium text-gray-800 dark:text-gray-100">{new Date(entry.date).toLocaleDateString('en-IN')}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Slip No</p>
            <p className="font-medium text-gray-800 dark:text-gray-100">{entry.slipNo}</p>
          </div>
          {entry.shadeName && (
            <div>
              <p className="text-xs text-gray-400">Shade</p>
              <p className="font-medium text-gray-800 dark:text-gray-100">{entry.shadeName}</p>
            </div>
          )}
          {entry.foldBatch && (
            <div>
              <p className="text-xs text-gray-400">Fold / Batch</p>
              <p className="font-medium text-gray-800 dark:text-gray-100">Fold {entry.foldBatch.foldProgram?.foldNo ?? '?'} / Batch {entry.foldBatch.batchNo}</p>
            </div>
          )}
          {entry.machine && (
            <div>
              <p className="text-xs text-gray-400">Machine</p>
              <p className="font-medium text-gray-800 dark:text-gray-100">{entry.machine.name}</p>
            </div>
          )}
          {entry.operator && (
            <div>
              <p className="text-xs text-gray-400">Operator</p>
              <p className="font-medium text-gray-800 dark:text-gray-100">{entry.operator.name}</p>
            </div>
          )}
          {entry.notes && (
            <div className="col-span-2">
              <p className="text-xs text-gray-400">Notes</p>
              <p className="text-gray-600 dark:text-gray-400">{entry.notes}</p>
            </div>
          )}
        </div>
      </div>

      {/* Lots Card */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Lots</h2>
          <span className="text-xs text-gray-400">{lots.length} lot{lots.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="space-y-2">
          {lots.map((l, i) => (
            <div key={l.id || i} className="flex items-center justify-between bg-gray-50 dark:bg-gray-900 rounded-lg px-4 py-2.5">
              <Link href={`/lot/${encodeURIComponent(l.lotNo)}`} className="text-sm font-semibold text-purple-700 dark:text-purple-400 hover:underline">
                {l.lotNo}
              </Link>
              <span className="text-sm text-gray-600 dark:text-gray-400">{l.than} than</span>
            </div>
          ))}
        </div>
        {lots.length > 1 && (
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Total Than</span>
            <span className="text-lg font-bold text-indigo-600 dark:text-indigo-400">{totalThan}</span>
          </div>
        )}
      </div>

      {/* Chemicals Card */}
      {entry.chemicals?.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Chemicals Used</h2>
            <span className="text-xs text-gray-400">{entry.chemicals.length} items</span>
          </div>
          <div className="space-y-2">
            {entry.chemicals.map((c) => (
              <div key={c.id} className="border border-gray-200 dark:border-gray-600 rounded-xl p-3 bg-gray-50 dark:bg-gray-900">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{c.name}</span>
                    {c.processTag && (
                      <span className="text-[10px] font-medium bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded">{c.processTag}</span>
                    )}
                  </div>
                  {c.cost != null && c.cost > 0 && (
                    <span className="text-sm font-semibold text-purple-700 dark:text-purple-400">&#8377;{c.cost.toFixed(2)}</span>
                  )}
                </div>
                <div className="flex gap-4 text-xs text-gray-500 dark:text-gray-400">
                  {c.quantity != null && <span>{c.quantity} {c.unit}</span>}
                  {c.rate != null && <span>@ &#8377;{c.rate}/{c.unit}</span>}
                </div>
              </div>
            ))}
          </div>

          {/* Cost Summary */}
          {totalCost > 0 && (
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-xl px-4 py-3">
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Total Dyeing Cost</span>
                <span className="text-lg font-bold text-purple-700 dark:text-purple-400">&#8377;{totalCost.toFixed(2)}</span>
              </div>
              {costPerThan > 0 && (
                <div className="flex items-center justify-between bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl px-4 py-3">
                  <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Cost per Than</span>
                  <span className="text-lg font-bold text-indigo-700 dark:text-indigo-400">&#8377;{costPerThan.toFixed(2)}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
