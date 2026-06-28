'use client'

import { useState, useMemo } from 'react'
import useSWR from 'swr'
import BackButton from '../../BackButton'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface StockLot {
  lotNo: string
  than: number
  party: string | null
  quality: string | null
  weight: string | null
}

interface StockEntry {
  id: number
  slipNo: number
  date: string
  shadeName: string | null
  shadeDescription: string | null
  isPcJob: boolean
  machineName: string | null
  operatorName: string | null
  lots: StockLot[]
  totalThan: number
}

interface PcRpRow {
  id: number
  reproNo: string
  status: string
  totalThan: number
  reason: string
  notes: string | null
  shadeName: string | null
  weight: string | null
  marka: string | null
  createdAt: string
  party: { name: string }
  quality: { name: string }
  sources: {
    id: number
    sourceDyeingEntryId: number
    originalLotNo: string
    than: number
    notes: string | null
  }[]
}

const REASONS = [
  { value: 'patchy', label: 'Patchy' },
  { value: 'daagi', label: 'Daagi' },
  { value: 'shade_mismatch', label: 'Shade mismatch' },
  { value: 'customer_reject', label: 'Customer reject' },
  { value: 'other', label: 'Other' },
]

export default function PcReprocessPage() {
  const { data: stockData, mutate: mutateStock } = useSWR<{ stock: StockEntry[] }>(
    '/api/finish/stock',
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30_000 },
  )
  const { data: pcRpList, mutate: mutateList } = useSWR<PcRpRow[]>(
    '/api/dyeing/pc-reprocess',
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 10_000 },
  )

  const pcCandidateSlips = useMemo(() => {
    const all = stockData?.stock ?? []
    return all.filter(s => s.isPcJob && s.totalThan > 0)
  }, [stockData])

  const [picker, setPicker] = useState<StockEntry | null>(null)

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3">
        <BackButton />
        <h1 className="text-xl font-bold">PC Pali Reprocess</h1>
        <div />
      </div>

      <section className="rounded-xl border border-orange-200 bg-orange-50 p-3">
        <h2 className="text-sm font-semibold text-orange-900">PC dye slips with remaining stock</h2>
        <p className="text-xs text-orange-800 mt-1">
          Use this when the in-slip re-dye round didn&apos;t fix the patchy/daagi and the rolls need a fresh fold batch.
        </p>
      </section>

      {pcCandidateSlips.length === 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-center text-gray-500 text-sm">
          No PC dye slips with remaining stock.
        </div>
      )}

      <div className="space-y-2">
        {pcCandidateSlips.map(s => (
          <div key={s.id} className="rounded-xl border border-gray-200 bg-white p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold text-gray-900">Slip {s.slipNo}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-semibold">PC Job</span>
                  {s.shadeName && (
                    <span className="text-xs text-gray-600">{s.shadeName}</span>
                  )}
                  <span className="text-xs text-gray-400">
                    {s.machineName ?? '—'} · {s.operatorName ?? '—'}
                  </span>
                </div>
                <div className="text-xs text-gray-700 mt-1">
                  {s.lots.map(l => `${l.lotNo} = ${l.than}T`).join(' · ')}
                </div>
              </div>
              <button
                onClick={() => setPicker(s)}
                className="shrink-0 px-3 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold"
              >
                Send to Fold
              </button>
            </div>
          </div>
        ))}
      </div>

      <section className="mt-8">
        <h2 className="text-sm font-bold text-gray-900 mb-2">PC-RP register</h2>
        {(!pcRpList || pcRpList.length === 0) && (
          <div className="text-xs text-gray-500">No PC-RP lots yet.</div>
        )}
        <div className="space-y-2">
          {(pcRpList ?? []).map(r => (
            <div key={r.id} className="rounded-xl border border-gray-200 bg-white p-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <span className="text-sm font-bold text-blue-700">{r.reproNo}</span>
                  <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">{r.status}</span>
                  <span className="ml-2 text-xs text-gray-500">{r.party.name} · {r.quality.name}</span>
                </div>
                <div className="text-xs text-gray-700">
                  {r.totalThan}T · {r.reason}{r.shadeName ? ` · ${r.shadeName}` : ''}
                </div>
                {r.status === 'pending-approval' && (
                  <button
                    className="text-xs px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                    onClick={async () => {
                      const res = await fetch(`/api/dyeing/pc-reprocess/${r.id}/approve`, { method: 'PATCH' })
                      if (res.ok) mutateList()
                      else alert((await res.json()).message ?? 'Approve failed')
                    }}
                  >
                    Approve
                  </button>
                )}
              </div>
              <div className="mt-1 text-xs text-gray-500">
                {r.sources.map(s => `${s.originalLotNo}=${s.than}T (dye slip id ${s.sourceDyeingEntryId})`).join(' · ')}
              </div>
              {r.notes && <div className="mt-1 text-xs text-gray-500 italic">{r.notes}</div>}
            </div>
          ))}
        </div>
      </section>

      {picker && (
        <SendToFoldModal
          slip={picker}
          onClose={() => setPicker(null)}
          onSuccess={() => { setPicker(null); mutateStock(); mutateList() }}
        />
      )}
    </div>
  )
}

function SendToFoldModal({
  slip, onClose, onSuccess,
}: {
  slip: StockEntry
  onClose: () => void
  onSuccess: () => void
}) {
  const [reason, setReason] = useState('patchy')
  const [notes, setNotes] = useState('')
  // Per-lot than reclaim, defaults to the remaining than on the slip
  const [perLot, setPerLot] = useState<Record<string, number>>(() => {
    const m: Record<string, number> = {}
    for (const l of slip.lots) m[l.lotNo] = l.than
    return m
  })
  const [perLotNotes, setPerLotNotes] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const totalReclaim = useMemo(
    () => slip.lots.reduce((s, l) => s + (Number(perLot[l.lotNo]) || 0), 0),
    [perLot, slip.lots],
  )

  async function submit() {
    setError(null)
    const sources = slip.lots
      .map(l => ({
        sourceDyeingEntryId: slip.id,
        originalLotNo: l.lotNo,
        than: Number(perLot[l.lotNo]) || 0,
        notes: perLotNotes[l.lotNo] || null,
      }))
      .filter(s => s.than > 0)
    if (sources.length === 0) { setError('At least one source row must have than > 0'); return }
    setSubmitting(true)
    try {
      const res = await fetch('/api/dyeing/pc-reprocess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, notes: notes || null, sources }),
      })
      const data = await res.json()
      if (!res.ok) { setError((data.messages?.join('; ')) || data.error || 'Failed'); return }
      onSuccess()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />
      <div
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(560px,calc(100vw-24px))] max-h-[88vh] overflow-y-auto bg-white rounded-xl shadow-2xl border border-gray-200 z-50"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-800">
            Send to Fold (PC Rework) — Slip {slip.slipNo}
          </h3>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-700 text-lg leading-none px-2">×</button>
        </div>
        <div className="p-3 space-y-3 text-sm">
          <div className="rounded bg-gray-50 p-2 text-xs text-gray-700">
            {slip.shadeName ? `${slip.shadeName} · ` : ''}{slip.lots.length} lots
          </div>

          <div className="grid grid-cols-1 gap-2">
            <label className="text-xs font-semibold text-gray-700">Reason
              <select
                className="mt-1 w-full border border-gray-300 rounded px-2 py-1 text-sm"
                value={reason}
                onChange={e => setReason(e.target.value)}
              >
                {REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-gray-700">Notes (optional)
              <input
                className="mt-1 w-full border border-gray-300 rounded px-2 py-1 text-sm"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="e.g. shade is too light on 2 rolls"
              />
            </label>
          </div>

          <div>
            <div className="text-xs font-semibold text-gray-700 mb-1">Per-lot reclaim than</div>
            <div className="space-y-1">
              {slip.lots.map(l => (
                <div key={l.lotNo} className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-gray-800 w-44 truncate" title={l.lotNo}>{l.lotNo}</span>
                  <span className="text-gray-500 w-16">avail {l.than}T</span>
                  <input
                    type="number" min={0} max={l.than}
                    className="w-20 border border-gray-300 rounded px-1.5 py-0.5"
                    value={perLot[l.lotNo] ?? 0}
                    onChange={e => setPerLot(prev => ({ ...prev, [l.lotNo]: Math.max(0, Math.min(l.than, parseInt(e.target.value) || 0)) }))}
                  />
                  <input
                    className="flex-1 border border-gray-200 rounded px-1.5 py-0.5"
                    placeholder="lot notes (optional)"
                    value={perLotNotes[l.lotNo] || ''}
                    onChange={e => setPerLotNotes(prev => ({ ...prev, [l.lotNo]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
            <div className="mt-2 text-xs font-semibold text-gray-800">Total reclaim: {totalReclaim}T</div>
          </div>

          {error && <div className="rounded bg-rose-50 border border-rose-200 text-rose-700 text-xs p-2">{error}</div>}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
            <button onClick={onClose} className="px-3 py-1.5 rounded text-xs bg-gray-100 hover:bg-gray-200">Cancel</button>
            <button
              onClick={submit}
              disabled={submitting || totalReclaim === 0}
              className="px-3 py-1.5 rounded text-xs bg-orange-600 hover:bg-orange-700 text-white font-semibold disabled:bg-gray-300"
            >
              {submitting ? 'Creating…' : 'Create PC-RP'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
