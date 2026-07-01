'use client'

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import BackButton from '../BackButton'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface QueueRow {
  felId: number
  lotNo: string
  than: number
  meter: number | null
  quality: string
  shade: string | null
  shadeCategory: string | null
}
interface QueueFp {
  finishEntryId: number
  finishSlipNo: number
  date: string
  totalThan: number
  rows: QueueRow[]
}
interface QueueParty {
  partyId: number
  partyName: string
  partyTag: string | null
  totalThan: number
  finishPrograms: QueueFp[]
}

interface ChallanLine {
  id: number
  lotNo: string
  qualityName: string | null
  shadeName: string | null
  shadeCategory: string | null
  than: number
  finishSlipNo: number
}
interface Challan {
  id: number
  challanNo: number
  date: string
  status: string
  transport: string | null
  lrNo: string | null
  vehicleNo: string | null
  party: { id: number; name: string; tag: string | null }
  lines: ChallanLine[]
}

export default function DeliveryChallanPage() {
  const [tab, setTab] = useState<'queue' | 'issued'>('queue')
  const { data: queue, mutate: mutateQueue } = useSWR<{ parties: QueueParty[] }>(
    '/api/delivery-challan/queue',
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 20_000 },
  )
  const { data: issued, mutate: mutateIssued } = useSWR<Challan[]>(
    '/api/delivery-challan',
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 20_000 },
  )

  // Selection per (partyId, felId)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Optional manual challan number (e.g. "DC-1"). When set for a multi-party
  // batch, the first challan uses this number and subsequent ones auto-
  // increment from there.
  const [manualDcNo, setManualDcNo] = useState('')

  const parties = queue?.parties ?? []
  const selectedByParty = useMemo(() => {
    const m = new Map<number, number[]>()
    for (const p of parties) {
      const ids: number[] = []
      for (const fp of p.finishPrograms) for (const r of fp.rows) if (picked.has(r.felId)) ids.push(r.felId)
      if (ids.length) m.set(p.partyId, ids)
    }
    return m
  }, [parties, picked])

  function togglePick(id: number) {
    setPicked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function toggleAllInFp(fp: QueueFp) {
    const ids = fp.rows.map(r => r.felId)
    setPicked(prev => {
      const next = new Set(prev)
      const allIn = ids.every(id => next.has(id))
      if (allIn) ids.forEach(id => next.delete(id))
      else ids.forEach(id => next.add(id))
      return next
    })
  }
  function togglePartyAll(p: QueueParty) {
    const ids: number[] = []
    for (const fp of p.finishPrograms) for (const r of fp.rows) ids.push(r.felId)
    setPicked(prev => {
      const next = new Set(prev)
      const allIn = ids.every(id => next.has(id))
      if (allIn) ids.forEach(id => next.delete(id))
      else ids.forEach(id => next.add(id))
      return next
    })
  }

  async function createChallans() {
    if (selectedByParty.size === 0) return
    setCreating(true)
    setError(null)
    // Parse manual seed if provided
    let seed: number | null = null
    if (manualDcNo.trim()) {
      const raw = manualDcNo.trim().replace(/^DC-/i, '')
      const parsed = parseInt(raw)
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setError('Manual DC no. must be a positive integer or "DC-N"')
        setCreating(false)
        return
      }
      seed = parsed
    }
    try {
      let offset = 0
      for (const [partyId, felIds] of selectedByParty.entries()) {
        const body: any = { partyId, finishEntryLotIds: felIds }
        if (seed != null) body.challanNo = seed + offset
        const res = await fetch('/api/delivery-challan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.message || err.error || 'Create failed')
        }
        offset++
      }
      setPicked(new Set())
      setManualDcNo('')
      mutateQueue()
      mutateIssued()
      setTab('issued')
    } catch (e: any) {
      setError(e.message ?? 'Something went wrong')
    } finally {
      setCreating(false)
    }
  }

  async function cancelChallan(c: Challan) {
    if (!confirm(`Cancel DC-${c.challanNo}? Its finish-lots return to the queue.`)) return
    const res = await fetch(`/api/delivery-challan/${c.id}`, { method: 'DELETE' })
    if (res.ok) { mutateQueue(); mutateIssued() }
    else alert((await res.json()).message ?? 'Cancel failed')
  }

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-4 text-gray-900 dark:text-gray-100">
      <div className="flex items-center justify-between gap-3">
        <BackButton />
        <h1 className="text-xl font-bold">Delivery Challan</h1>
        <div />
      </div>

      <div className="flex border-b border-gray-200 dark:border-gray-700">
        <button
          onClick={() => setTab('queue')}
          className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition ${
            tab === 'queue'
              ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400 dark:border-emerald-500'
              : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
          }`}
        >
          Queue {parties.length > 0 && (
            <span className="ml-1 text-xs opacity-70">
              ({parties.reduce((s, p) => s + p.finishPrograms.reduce((a, fp) => a + fp.rows.length, 0), 0)})
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('issued')}
          className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition ${
            tab === 'issued'
              ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400 dark:border-emerald-500'
              : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
          }`}
        >
          Issued Challans {issued && issued.length > 0 && <span className="ml-1 text-xs opacity-70">({issued.length})</span>}
        </button>
      </div>

      {tab === 'queue' && (
        <>
          <div className="sticky top-0 z-30 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-800/95 backdrop-blur p-3 flex items-center justify-between gap-2 flex-wrap">
            <div className="text-xs">
              <span className="text-gray-700 dark:text-gray-300 font-semibold">{picked.size}</span>
              <span className="text-gray-500 dark:text-gray-400"> lots selected across </span>
              <span className="text-gray-700 dark:text-gray-300 font-semibold">{selectedByParty.size}</span>
              <span className="text-gray-500 dark:text-gray-400"> party group(s)</span>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                DC no
                <input
                  value={manualDcNo}
                  onChange={e => setManualDcNo(e.target.value)}
                  placeholder="auto"
                  className="w-24 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded px-2 py-1 placeholder-gray-400 dark:placeholder-gray-500"
                />
              </label>
              <button
                onClick={createChallans}
                disabled={selectedByParty.size === 0 || creating}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-600 text-white text-xs font-semibold disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:text-gray-500 dark:disabled:text-gray-400"
              >
                {creating ? 'Creating…' : `Create ${selectedByParty.size} challan${selectedByParty.size === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 text-xs p-3">
              {error}
            </div>
          )}

          {parties.length === 0 && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 text-center text-gray-500 dark:text-gray-400 text-sm">
              No PC Pali finished cloth pending delivery.
            </div>
          )}

          <div className="space-y-3">
            {parties.map(p => (
              <div key={p.partyId} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
                <div className="px-4 py-2 bg-amber-50 dark:bg-amber-900/20 flex items-center justify-between gap-2 flex-wrap">
                  <label className="text-sm font-bold flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={p.finishPrograms.every(fp => fp.rows.every(r => picked.has(r.felId)))}
                      onChange={() => togglePartyAll(p)}
                      className="accent-emerald-600"
                    />
                    {p.partyName}
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 font-semibold">
                      Pali PC Job → Delivery Challan
                    </span>
                  </label>
                  <div className="text-xs text-gray-600 dark:text-gray-300">
                    {p.totalThan} than · {p.finishPrograms.length} finish program{p.finishPrograms.length === 1 ? '' : 's'}
                  </div>
                </div>
                {p.finishPrograms.map(fp => {
                  // Sort rows within FP by shade category for a clean visual
                  const byCat = new Map<string, QueueRow[]>()
                  for (const r of fp.rows) {
                    const k = r.shadeCategory || 'Uncategorised'
                    if (!byCat.has(k)) byCat.set(k, [])
                    byCat.get(k)!.push(r)
                  }
                  const catNames = [...byCat.keys()].sort()
                  return (
                    <div key={fp.finishEntryId} className="border-t border-gray-200 dark:border-gray-700 p-3">
                      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 overflow-hidden">
                        <div className="px-3 py-2 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between gap-2">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={fp.rows.every(r => picked.has(r.felId))}
                              onChange={() => toggleAllInFp(fp)}
                              className="accent-emerald-600"
                            />
                            <span className="text-sm font-bold text-gray-900 dark:text-gray-100">FP-{fp.finishSlipNo}</span>
                            <span className="text-xs text-gray-500 dark:text-gray-400">{new Date(fp.date).toLocaleDateString('en-IN')}</span>
                          </label>
                          <div className="text-xs text-gray-600 dark:text-gray-300">{fp.totalThan} than</div>
                        </div>
                        {catNames.map(cat => {
                          const rows = byCat.get(cat)!
                          const catThan = rows.reduce((s, r) => s + r.than, 0)
                          return (
                            <div key={cat}>
                              <div className="px-3 py-1 bg-gray-100 dark:bg-gray-800 text-[11px] font-semibold text-gray-700 dark:text-gray-200">
                                {cat} · {catThan} than
                              </div>
                              <div className="text-xs divide-y divide-gray-100 dark:divide-gray-800">
                                {rows.map(r => (
                                  <label key={r.felId} className="flex items-center gap-3 px-3 py-1.5 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={picked.has(r.felId)}
                                      onChange={() => togglePick(r.felId)}
                                      className="accent-emerald-600"
                                    />
                                    <span className="font-mono text-gray-800 dark:text-gray-200 w-40 truncate" title={r.lotNo}>{r.lotNo}</span>
                                    <span className="text-gray-500 dark:text-gray-400 text-[11px]">{r.quality}</span>
                                    {r.shade && <span className="text-gray-500 dark:text-gray-400 text-[11px]">· {r.shade}</span>}
                                    <span className="ml-auto text-gray-700 dark:text-gray-300">{r.than} than</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'issued' && (
        <div className="space-y-3">
          {(!issued || issued.length === 0) && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 text-center text-gray-500 dark:text-gray-400 text-sm">
              No challans issued yet.
            </div>
          )}
          {(issued ?? []).map(c => (
            <div key={c.id} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
              <div className="flex items-start justify-between gap-3 p-4 border-b border-gray-100 dark:border-gray-700">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-base font-bold text-emerald-700 dark:text-emerald-400">DC-{c.challanNo}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${c.status === 'issued' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}`}>{c.status}</span>
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                    {c.party.name} · {new Date(c.date).toLocaleDateString('en-IN')}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-2xl font-bold text-gray-900 dark:text-gray-100 leading-none">
                    {c.lines.reduce((s, l) => s + l.than, 0)}
                  </div>
                  <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">than · {c.lines.length} lots</div>
                </div>
              </div>
              <div className="px-4 py-2 text-xs text-gray-600 dark:text-gray-400 space-y-0.5">
                {c.lines.slice(0, 4).map(l => (
                  <div key={l.id}>
                    <span className="font-mono">{l.lotNo}</span>
                    {l.shadeCategory && <span className="ml-2 text-[10px] text-gray-500">[{l.shadeCategory}]</span>}
                    <span className="ml-auto float-right">{l.than} than</span>
                  </div>
                ))}
                {c.lines.length > 4 && <div className="text-gray-400 dark:text-gray-500">+{c.lines.length - 4} more…</div>}
              </div>
              <div className="flex items-center justify-end gap-2 px-4 py-2 bg-gray-50 dark:bg-gray-900/30 border-t border-gray-100 dark:border-gray-700">
                <Link
                  href={`/delivery/${c.id}/print`}
                  target="_blank"
                  className="text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 text-white font-semibold"
                >
                  Print
                </Link>
                {c.status === 'issued' && (
                  <button
                    onClick={() => cancelChallan(c)}
                    className="text-xs px-3 py-1.5 rounded bg-rose-600 hover:bg-rose-700 dark:bg-rose-700 dark:hover:bg-rose-600 text-white font-semibold"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
