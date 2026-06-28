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
  marka: string | null
  party: string | null
  machineName: string | null
  operatorName: string | null
  lots: StockLot[]
  totalThan: number
}

type SortField = 'slipNo' | 'marka' | 'lot' | 'party'

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

const STATUS_BADGE: Record<string, string> = {
  'pending-approval': 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
  'pending':          'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  'in-fold':          'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300',
  'in-dyeing':        'bg-fuchsia-100 dark:bg-fuchsia-900/30 text-fuchsia-700 dark:text-fuchsia-300',
  'finished':         'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
  'merged':           'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300',
}

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

  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState<SortField>('slipNo')
  const [partyFilter, setPartyFilter] = useState<string>('all')
  const [markaFilter, setMarkaFilter] = useState<string>('all')

  const baseCandidates = useMemo(
    () => (stockData?.stock ?? []).filter(s => s.isPcJob && s.totalThan > 0),
    [stockData],
  )

  // Distinct values for the filter dropdowns
  const partyOptions = useMemo(() => {
    const set = new Set<string>()
    for (const s of baseCandidates) {
      const p = s.party || s.lots[0]?.party
      if (p) set.add(p)
    }
    return [...set].sort()
  }, [baseCandidates])

  const markaOptions = useMemo(() => {
    const set = new Set<string>()
    for (const s of baseCandidates) {
      if (s.marka) set.add(s.marka)
    }
    return [...set].sort()
  }, [baseCandidates])

  const pcCandidateSlips = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = baseCandidates.filter(s => {
      const p = s.party || s.lots[0]?.party || ''
      if (partyFilter !== 'all' && p !== partyFilter) return false
      if (markaFilter !== 'all' && (s.marka || '') !== markaFilter) return false
      if (!q) return true
      const haystack = [
        String(s.slipNo),
        s.marka || '',
        p,
        s.shadeName || '',
        ...s.lots.map(l => l.lotNo),
      ].join(' ').toLowerCase()
      return haystack.includes(q)
    })
    const sorted = [...filtered]
    sorted.sort((a, b) => {
      if (sortBy === 'slipNo') return a.slipNo - b.slipNo
      if (sortBy === 'marka') return (a.marka || '').localeCompare(b.marka || '')
      if (sortBy === 'party') return (a.party || a.lots[0]?.party || '').localeCompare(b.party || b.lots[0]?.party || '')
      if (sortBy === 'lot') return (a.lots[0]?.lotNo || '').localeCompare(b.lots[0]?.lotNo || '')
      return 0
    })
    return sorted
  }, [baseCandidates, query, sortBy, partyFilter, markaFilter])

  const [picker, setPicker] = useState<StockEntry | null>(null)

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-6 text-gray-900 dark:text-gray-100">
      <div className="flex items-center justify-between gap-3">
        <BackButton />
        <h1 className="text-xl font-bold">PC Pali Reprocess</h1>
        <div />
      </div>

      <section className="rounded-xl border border-orange-200 dark:border-orange-900/60 bg-orange-50 dark:bg-orange-900/20 p-3">
        <h2 className="text-sm font-semibold text-orange-900 dark:text-orange-200">PC dye slips with remaining stock</h2>
        <p className="text-xs text-orange-800 dark:text-orange-300 mt-1">
          Use this when the in-slip re-dye round didn&apos;t fix the patchy/daagi and the rolls need a fresh fold batch.
        </p>
      </section>

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 text-xs">
          <label className="flex flex-col gap-1">
            <span className="font-semibold text-gray-700 dark:text-gray-300">Search</span>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="slip / lot / marka / party / shade"
              className="border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded px-2 py-1 placeholder-gray-400 dark:placeholder-gray-500"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold text-gray-700 dark:text-gray-300">Party</span>
            <select
              value={partyFilter}
              onChange={e => setPartyFilter(e.target.value)}
              className="border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded px-2 py-1"
            >
              <option value="all">All</option>
              {partyOptions.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold text-gray-700 dark:text-gray-300">Marka</span>
            <select
              value={markaFilter}
              onChange={e => setMarkaFilter(e.target.value)}
              className="border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded px-2 py-1"
            >
              <option value="all">All</option>
              {markaOptions.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold text-gray-700 dark:text-gray-300">Sort by</span>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as SortField)}
              className="border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded px-2 py-1"
            >
              <option value="slipNo">Slip No</option>
              <option value="marka">Marka</option>
              <option value="lot">Lot</option>
              <option value="party">Party</option>
            </select>
          </label>
        </div>
        <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          {pcCandidateSlips.length} of {baseCandidates.length} slips
        </div>
      </div>

      {pcCandidateSlips.length === 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 text-center text-gray-500 dark:text-gray-400 text-sm">
          {baseCandidates.length === 0
            ? 'No PC dye slips with remaining stock.'
            : 'No slips match the current search / filters.'}
        </div>
      )}

      <div className="space-y-2">
        {pcCandidateSlips.map(s => (
          <div key={s.id} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold text-gray-900 dark:text-gray-100">Slip {s.slipNo}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 font-semibold">PC Job</span>
                  {s.shadeName && (
                    <span className="text-xs text-gray-600 dark:text-gray-400">{s.shadeName}</span>
                  )}
                  {s.marka && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium">marka {s.marka}</span>
                  )}
                  {(s.party || s.lots[0]?.party) && (
                    <span className="text-xs text-gray-500 dark:text-gray-400">{s.party || s.lots[0]?.party}</span>
                  )}
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    {s.machineName ?? '—'} · {s.operatorName ?? '—'}
                  </span>
                </div>
                <div className="text-xs text-gray-700 dark:text-gray-300 mt-1">
                  {s.lots.map(l => `${l.lotNo} = ${l.than}`).join(' · ')}
                </div>
              </div>
              <button
                onClick={() => setPicker(s)}
                className="shrink-0 px-3 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-700 dark:bg-orange-700 dark:hover:bg-orange-600 text-white text-xs font-semibold"
              >
                Send to Fold
              </button>
            </div>
          </div>
        ))}
      </div>

      <section className="mt-8">
        <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-2">PC-RP register</h2>
        {(!pcRpList || pcRpList.length === 0) && (
          <div className="text-xs text-gray-500 dark:text-gray-400">No PC-RP lots yet.</div>
        )}
        <div className="space-y-2">
          {(pcRpList ?? []).map(r => (
            <div key={r.id} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <span className="text-sm font-bold text-blue-700 dark:text-blue-400">{r.reproNo}</span>
                  <span className={`ml-2 text-xs px-1.5 py-0.5 rounded font-medium ${STATUS_BADGE[r.status] ?? 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}>{r.status}</span>
                  <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">{r.party.name} · {r.quality.name}</span>
                </div>
                <div className="text-xs text-gray-700 dark:text-gray-300">
                  {r.totalThan} · {r.reason}{r.shadeName ? ` · ${r.shadeName}` : ''}
                </div>
                {r.status === 'pending-approval' && (
                  <button
                    className="text-xs px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white font-semibold"
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
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {r.sources.map(s => `${s.originalLotNo}=${s.than} (dye slip id ${s.sourceDyeingEntryId})`).join(' · ')}
              </div>
              {r.notes && <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 italic">{r.notes}</div>}
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
      <div className="fixed inset-0 bg-black/60 dark:bg-black/70 z-40" onClick={onClose} />
      <div
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(560px,calc(100vw-24px))] max-h-[88vh] overflow-y-auto bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 z-50 text-gray-900 dark:text-gray-100"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <h3 className="text-sm font-bold">
            Send to Fold (PC Rework) — Slip {slip.slipNo}
          </h3>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 text-lg leading-none px-2">×</button>
        </div>
        <div className="p-3 space-y-3 text-sm">
          <div className="rounded bg-gray-50 dark:bg-gray-900/40 p-2 text-xs text-gray-700 dark:text-gray-300">
            {slip.shadeName ? `${slip.shadeName} · ` : ''}{slip.lots.length} lots
          </div>

          <div className="grid grid-cols-1 gap-2">
            <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">Reason
              <select
                className="mt-1 w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded px-2 py-1 text-sm"
                value={reason}
                onChange={e => setReason(e.target.value)}
              >
                {REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">Notes (optional)
              <input
                className="mt-1 w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded px-2 py-1 text-sm placeholder-gray-400 dark:placeholder-gray-500"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="e.g. shade is too light on 2 rolls"
              />
            </label>
          </div>

          <div>
            <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">Per-lot reclaim than</div>
            <div className="space-y-2">
              {slip.lots.map(l => (
                <div key={l.lotNo} className="rounded border border-gray-200 dark:border-gray-700 p-2 text-xs">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="font-mono font-semibold text-gray-800 dark:text-gray-200 break-all" title={l.lotNo}>{l.lotNo}</span>
                    <span className="text-gray-500 dark:text-gray-400 shrink-0 whitespace-nowrap">avail {l.than}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number" min={0} max={l.than}
                      className="w-24 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded px-1.5 py-0.5"
                      value={perLot[l.lotNo] ?? 0}
                      onChange={e => setPerLot(prev => ({ ...prev, [l.lotNo]: Math.max(0, Math.min(l.than, parseInt(e.target.value) || 0)) }))}
                    />
                    <input
                      className="flex-1 min-w-0 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded px-1.5 py-0.5 placeholder-gray-400 dark:placeholder-gray-500"
                      placeholder="lot notes (optional)"
                      value={perLotNotes[l.lotNo] || ''}
                      onChange={e => setPerLotNotes(prev => ({ ...prev, [l.lotNo]: e.target.value }))}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 text-xs font-semibold text-gray-800 dark:text-gray-200">Total reclaim: {totalReclaim}</div>
          </div>

          {error && (
            <div className="rounded bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs p-2">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100 dark:border-gray-700">
            <button onClick={onClose} className="px-3 py-1.5 rounded text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200">Cancel</button>
            <button
              onClick={submit}
              disabled={submitting || totalReclaim === 0}
              className="px-3 py-1.5 rounded text-xs bg-orange-600 hover:bg-orange-700 dark:bg-orange-700 dark:hover:bg-orange-600 text-white font-semibold disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:text-gray-500 dark:disabled:text-gray-400"
            >
              {submitting ? 'Creating…' : 'Create PC-RP'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
