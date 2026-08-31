'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import BackButton from '../BackButton'

const fetcher = (url: string) => fetch(url).then(r => r.json())
const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-IN')

interface GrLot {
  id: number; lotNo: string; source: string; qualityName: string | null; marka: string | null
  than: number; meter: number | null; checkingSlipNo: string | null
  finishDeliveryChallanLine?: { challan: { id: number; challanNo: number; date: string; status: string } } | null
}
interface Gr {
  id: number; slipNo: string; date: string; status: string; notes: string | null
  party: { id: number; name: string }
  lots: GrLot[]
  totalThan: number; greyThan: number; foldThan: number; challanNos: number[]
}

export default function GreyReturnPage() {
  const { data: rows = [], isLoading, mutate } = useSWR<Gr[]>('/api/grey-return', fetcher, { revalidateOnFocus: false })
  const [open, setOpen] = useState<Set<number>>(new Set())
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState<number | null>(null)

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return rows
    return rows.filter(r =>
      r.slipNo.toLowerCase().includes(s) ||
      r.party.name.toLowerCase().includes(s) ||
      r.lots.some(l => l.lotNo.toLowerCase().includes(s)))
  }, [rows, q])

  const totals = useMemo(() => ({
    than: filtered.reduce((s, r) => s + r.totalThan, 0),
    pending: filtered.filter(r => r.challanNos.length === 0).length,
  }), [filtered])

  const toggle = (id: number) => setOpen(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })

  async function del(r: Gr) {
    if (!confirm(`Delete ${r.slipNo} (${r.totalThan} than)? Any fold lines it reduced will be restored.`)) return
    setBusy(r.id)
    try {
      const res = await fetch(`/api/grey-return/${r.id}`, { method: 'DELETE' })
      const d = await res.json().catch(() => ({} as any))
      if (!res.ok) { alert(d.message || d.error || `HTTP ${res.status}`); return }
      mutate()
    } finally { setBusy(null) }
  }

  return (
    <div className="p-4 md:p-6 dark:text-gray-100">
      <div className="flex items-center gap-3 mb-4">
        <BackButton />
        <h1 className="text-lg sm:text-xl font-bold text-gray-800 dark:text-gray-100">Grey Return</h1>
        <Link href="/grey-return/new"
          className="ml-auto text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white whitespace-nowrap">
          + New Return
        </Link>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-3 mb-3">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search slip / party / lot…"
          className="w-full text-[13px] border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 dark:text-gray-100" />
        <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
          {filtered.length} return{filtered.length === 1 ? '' : 's'} · {totals.than} than · {totals.pending} awaiting a delivery challan
        </p>
      </div>

      {isLoading && <div className="p-12 text-center text-gray-400">Loading…</div>}

      {!isLoading && filtered.length === 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-8 text-center text-gray-400 text-sm">
          No grey returns yet. Use <strong>+ New Return</strong> to send unprocessed grey back to a party.
        </div>
      )}

      {filtered.map(r => {
        const isOpen = open.has(r.id)
        const challaned = r.challanNos.length > 0
        return (
          <div key={r.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden mb-2">
            <button onClick={() => toggle(r.id)} className="w-full px-4 py-3 flex items-center justify-between gap-2 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition text-left">
              <span className="flex items-center gap-2 min-w-0">
                <span className={`text-gray-400 text-[10px] shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`}>▶</span>
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-emerald-700 dark:text-emerald-400">
                    {r.slipNo} <span className="text-[11px] font-normal text-gray-400">{fmtDate(r.date)}</span>
                  </span>
                  <span className="block text-[11px] text-gray-500 dark:text-gray-400 truncate">
                    {r.party.name} · {r.lots.length} lot{r.lots.length === 1 ? '' : 's'}
                    {r.greyThan > 0 && <span className="ml-1">· grey {r.greyThan}</span>}
                    {r.foldThan > 0 && <span className="ml-1 text-amber-600 dark:text-amber-400">· fold {r.foldThan}</span>}
                  </span>
                </span>
              </span>
              <span className="text-right shrink-0">
                <span className="block text-lg font-bold text-gray-800 dark:text-gray-100 leading-none">{r.totalThan}</span>
                <span className="block text-[10px] text-gray-400 uppercase">than</span>
              </span>
            </button>

            <div className="px-4 pb-2 flex items-center gap-2 flex-wrap">
              {challaned
                ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                    On challan {r.challanNos.join(', ')}
                  </span>
                : <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                    In delivery-challan queue
                  </span>}
              {!challaned && (
                <button onClick={() => del(r)} disabled={busy === r.id}
                  className="ml-auto text-[11px] text-rose-600 dark:text-rose-400 hover:underline disabled:opacity-50">
                  {busy === r.id ? 'Deleting…' : 'Delete'}
                </button>
              )}
            </div>

            {isOpen && (
              <div className="border-t border-gray-100 dark:border-gray-700 px-3 sm:px-4 py-2">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-700">
                        <th className="py-1.5 pr-2 font-semibold">Lot No</th>
                        <th className="py-1.5 pr-2 font-semibold">Source</th>
                        <th className="py-1.5 pr-2 font-semibold">Quality</th>
                        <th className="py-1.5 pr-2 font-semibold">Marka</th>
                        <th className="py-1.5 pl-2 font-semibold text-right">Than</th>
                        <th className="py-1.5 pl-2 font-semibold text-right">Meter</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                      {r.lots.map(l => (
                        <tr key={l.id}>
                          <td className="py-1.5 pr-2 font-mono text-gray-700 dark:text-gray-200">{l.lotNo}</td>
                          <td className="py-1.5 pr-2">
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${l.source === 'fold'
                              ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                              : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
                              {l.source === 'fold' ? 'in fold' : 'grey'}
                            </span>
                          </td>
                          <td className="py-1.5 pr-2 text-gray-500 dark:text-gray-400">{l.qualityName || '-'}</td>
                          <td className="py-1.5 pr-2 text-gray-500 dark:text-gray-400">{l.marka || '-'}</td>
                          <td className="py-1.5 pl-2 text-right font-bold text-gray-800 dark:text-gray-100">{l.than}</td>
                          <td className="py-1.5 pl-2 text-right text-sky-700 dark:text-sky-400">{l.meter != null ? l.meter.toLocaleString('en-IN') : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-gray-200 dark:border-gray-600 font-bold">
                        <td className="py-1.5 pr-2 text-gray-600 dark:text-gray-300" colSpan={4}>Total</td>
                        <td className="py-1.5 pl-2 text-right text-gray-900 dark:text-gray-50">{r.totalThan}</td>
                        <td className="py-1.5 pl-2 text-right text-sky-700 dark:text-sky-400">
                          {r.lots.some(l => l.meter != null)
                            ? r.lots.reduce((s, l) => s + (l.meter ?? 0), 0).toLocaleString('en-IN')
                            : '-'}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                {r.notes && <p className="mt-2 text-[11px] text-indigo-700 dark:text-indigo-300">📝 {r.notes}</p>}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
