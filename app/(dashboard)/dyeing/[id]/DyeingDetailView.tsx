'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { generateSlipPDF, sharePDF, type SlipData } from '@/lib/pdf-share'

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
interface Addition {
  id: number
  roundNo: number
  type: string
  defectType: string | null
  defectPhoto: string | null
  reason: string | null
  createdAt: string
  machine?: { name: string } | null
  operator?: { name: string } | null
  chemicals: Chemical[]
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
  status?: string
  totalRounds?: number
  additions?: Addition[]
}

export default function DyeingDetailView({ id }: { id: string }) {
  const router = useRouter()
  const [entry, setEntry] = useState<Entry | null>(null)
  const [loading, setLoading] = useState(true)
  const [sharing, setSharing] = useState(false)

  useEffect(() => {
    fetch(`/api/dyeing/${id}`)
      .then(r => r.json())
      .then(d => { setEntry(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [id])

  async function handleSharePDF() {
    if (!entry) return
    setSharing(true)
    try {
      const slipLots = entry.lots?.length ? entry.lots : [{ lotNo: entry.lotNo, than: entry.than }]
      const slip: SlipData = {
        slipNo: entry.slipNo,
        date: entry.date,
        shadeName: entry.shadeName ?? entry.foldBatch?.shade?.name ?? null,
        lots: slipLots.map(l => ({ lotNo: l.lotNo, than: l.than })),
        chemicals: (entry.chemicals || []).map(c => ({
          name: c.name,
          quantity: c.quantity,
          unit: c.unit,
          rate: c.rate,
          cost: c.cost,
          processTag: c.processTag,
        })),
        notes: entry.notes,
        status: entry.status,
        machine: entry.machine?.name ?? null,
        operator: entry.operator?.name ?? null,
        totalRounds: entry.totalRounds ?? null,
      }
      const blob = generateSlipPDF(slip)
      await sharePDF(blob, `dyeing_slip_${entry.slipNo}.pdf`)
    } catch (err) {
      console.error('PDF share failed', err)
      alert('Failed to share PDF')
    } finally {
      setSharing(false)
    }
  }

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
          <button
            onClick={handleSharePDF}
            disabled={sharing}
            className="text-sm font-medium text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-300 border border-green-200 dark:border-green-700 rounded-lg px-3 py-1.5 disabled:opacity-50"
          >
            {sharing ? 'Preparing…' : '📄 Share PDF'}
          </button>
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
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Round 1 Cost</span>
                <span className="text-lg font-bold text-purple-700 dark:text-purple-400">&#8377;{totalCost.toFixed(2)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Additions / Re-Dye History */}
      {entry.additions && entry.additions.length > 0 && (
        <div className="space-y-4 mb-4">
          {entry.additions.map((a) => {
            const addCost = a.chemicals?.reduce((s: number, c: Chemical) => s + (c.cost ?? 0), 0) ?? 0
            return (
              <div key={a.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                      Round {a.roundNo} {a.type === 're-dye' ? '(Re-Dye)' : '(Addition)'}
                    </h2>
                    {a.defectType && (
                      <span className="text-[10px] font-medium bg-red-900/30 text-red-300 px-1.5 py-0.5 rounded capitalize">{a.defectType}</span>
                    )}
                  </div>
                  <span className="text-xs text-gray-400">{new Date(a.createdAt).toLocaleDateString('en-IN')}</span>
                </div>

                {a.reason && (
                  <p className="text-xs text-gray-400 mb-2">Reason: {a.reason}</p>
                )}

                {(a.machine || a.operator) && (
                  <div className="flex gap-4 text-xs text-gray-400 mb-2">
                    {a.machine && <span>Machine: {a.machine.name}</span>}
                    {a.operator && <span>Operator: {a.operator.name}</span>}
                  </div>
                )}

                {a.defectPhoto && (
                  <div className="mb-2">
                    <a href={a.defectPhoto} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:underline">View Defect Photo</a>
                  </div>
                )}

                {a.chemicals?.length > 0 && (
                  <div className="space-y-1.5">
                    {a.chemicals.map((c: Chemical) => (
                      <div key={c.id} className="flex items-center justify-between bg-gray-50 dark:bg-gray-900 rounded-lg px-3 py-2">
                        <span className="text-sm text-gray-800 dark:text-gray-100">{c.name}</span>
                        <div className="flex items-center gap-3 text-xs text-gray-500">
                          {c.quantity != null && <span>{c.quantity} {c.unit}</span>}
                          {c.cost != null && c.cost > 0 && <span className="text-purple-400 font-medium">&#8377;{c.cost.toFixed(2)}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {addCost > 0 && (
                  <div className="mt-3 flex items-center justify-between bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-2">
                    <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Round {a.roundNo} Cost</span>
                    <span className="text-sm font-bold text-red-600 dark:text-red-400">+&#8377;{addCost.toFixed(2)}</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Actual Total (all rounds) */}
      {(() => {
        const additionsCost = entry.additions?.reduce((s, a) =>
          s + (a.chemicals?.reduce((s2: number, c: Chemical) => s2 + (c.cost ?? 0), 0) ?? 0), 0) ?? 0
        const actualTotal = totalCost + additionsCost
        if (actualTotal > 0 && additionsCost > 0) {
          return (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 mb-4">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Cost Summary</h2>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Round 1 (Planned)</span>
                  <span className="text-sm text-gray-300">&#8377;{totalCost.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-red-400">Additions / Re-Dye</span>
                  <span className="text-sm text-red-400">+&#8377;{additionsCost.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between border-t border-gray-700 pt-2">
                  <span className="text-sm font-bold text-gray-200">Actual Total</span>
                  <span className="text-lg font-bold text-purple-400">&#8377;{actualTotal.toFixed(2)}</span>
                </div>
                {costPerThan > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-500">Actual Cost/Than</span>
                    <span className="text-sm text-indigo-400">&#8377;{(actualTotal / totalThan).toFixed(2)}</span>
                  </div>
                )}
              </div>
            </div>
          )
        }
        if (totalCost > 0 && additionsCost === 0 && costPerThan > 0) {
          return (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 mb-4">
              <div className="flex items-center justify-between bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl px-4 py-3">
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Cost per Than</span>
                <span className="text-lg font-bold text-indigo-700 dark:text-indigo-400">&#8377;{costPerThan.toFixed(2)}</span>
              </div>
            </div>
          )
        }
        return null
      })()}
    </div>
  )
}
