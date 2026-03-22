'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface Lot { id: number; lotNo: string; than: number; meter: number | null }
interface Chemical {
  id: number
  name: string
  quantity: number | null
  unit: string
  rate: number | null
  cost: number | null
}
interface Entry {
  id: number
  date: string
  slipNo: number
  lotNo: string
  than: number
  meter: number | null
  mandi: number | null
  notes: string | null
  lots: Lot[]
  chemicals: Chemical[]
}

export default function FinishDetailView({ id }: { id: string }) {
  const router = useRouter()
  const [entry, setEntry] = useState<Entry | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/finish/${id}`)
      .then(r => r.json())
      .then(d => { setEntry(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [id])

  if (loading) return <div className="p-8 text-gray-400">Loading...</div>
  if (!entry) return <div className="p-8 text-red-500">Entry not found.</div>

  const lots = entry.lots?.length ? entry.lots : [{ id: 0, lotNo: entry.lotNo, than: entry.than, meter: entry.meter }]
  const totalThan = lots.reduce((s, l) => s + l.than, 0)
  const totalMeter = lots.reduce((s, l) => s + (l.meter ?? 0), 0)
  const totalCost = entry.chemicals?.reduce((s, c) => s + (c.cost ?? 0), 0) ?? 0
  const costPerThan = totalThan > 0 ? totalCost / totalThan : 0

  return (
    <div className="p-4 md:p-8 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 rounded-lg px-4 py-2 text-sm font-medium transition">&larr; Back</button>
        <h1 className="text-xl font-bold text-gray-800">Finish Slip #{entry.slipNo}</h1>
        <Link href={`/finish/${id}/edit`} className="ml-auto text-sm font-medium text-teal-600 hover:text-teal-800 border border-teal-200 rounded-lg px-3 py-1.5">
          Edit
        </Link>
      </div>

      {/* Slip Info Card */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Slip Details</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs text-gray-400">Date</p>
            <p className="font-medium text-gray-800">{new Date(entry.date).toLocaleDateString('en-IN')}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Slip No</p>
            <p className="font-medium text-gray-800">{entry.slipNo}</p>
          </div>
          {entry.mandi != null && (
            <div>
              <p className="text-xs text-gray-400">Mandi (liters)</p>
              <p className="font-medium text-gray-800">{entry.mandi}</p>
            </div>
          )}
          {entry.notes && (
            <div className="col-span-2">
              <p className="text-xs text-gray-400">Notes</p>
              <p className="text-gray-600">{entry.notes}</p>
            </div>
          )}
        </div>
      </div>

      {/* Lots Card */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700">Lots</h2>
          <span className="text-xs text-gray-400">{lots.length} lot{lots.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="space-y-2">
          {lots.map((l, i) => (
            <div key={l.id || i} className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-2.5">
              <Link href={`/lot/${encodeURIComponent(l.lotNo)}`} className="text-sm font-semibold text-teal-700 hover:underline">
                {l.lotNo}
              </Link>
              <div className="flex gap-3 text-sm text-gray-600">
                <span>{l.than} than</span>
                {l.meter != null && l.meter > 0 && <span>{l.meter} m</span>}
              </div>
            </div>
          ))}
        </div>
        {lots.length > 1 && (
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
            <span className="text-sm font-semibold text-gray-700">Total</span>
            <div className="flex gap-3">
              <span className="text-lg font-bold text-emerald-600">{totalThan} than</span>
              {totalMeter > 0 && <span className="text-lg font-bold text-gray-500">{totalMeter.toFixed(1)} m</span>}
            </div>
          </div>
        )}
      </div>

      {/* Chemicals Card */}
      {entry.chemicals?.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">Chemicals Used</h2>
            <span className="text-xs text-gray-400">{entry.chemicals.length} items</span>
          </div>
          <div className="space-y-2">
            {entry.chemicals.map((c) => (
              <div key={c.id} className="border border-gray-200 rounded-xl p-3 bg-gray-50">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-gray-800">{c.name}</span>
                  {c.cost != null && c.cost > 0 && (
                    <span className="text-sm font-semibold text-teal-700">&#8377;{c.cost.toFixed(2)}</span>
                  )}
                </div>
                <div className="flex gap-4 text-xs text-gray-500">
                  {c.quantity != null && <span>{c.quantity} {c.unit}</span>}
                  {c.rate != null && <span>@ &#8377;{c.rate}/{c.unit}</span>}
                </div>
              </div>
            ))}
          </div>

          {/* Cost Summary */}
          {totalCost > 0 && (
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between bg-teal-50 border border-teal-200 rounded-xl px-4 py-3">
                <span className="text-sm font-semibold text-gray-700">Total Finish Cost</span>
                <span className="text-lg font-bold text-teal-700">&#8377;{totalCost.toFixed(2)}</span>
              </div>
              {costPerThan > 0 && (
                <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                  <span className="text-sm font-semibold text-gray-700">Cost per Than</span>
                  <span className="text-lg font-bold text-emerald-700">&#8377;{costPerThan.toFixed(2)}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
