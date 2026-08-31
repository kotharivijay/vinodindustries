'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import BackButton from '../../BackButton'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface Party { id: number; name: string; tag?: string | null }
interface GreyRow { lotNo: string; quality: string; marka: string | null; available: number; checkingSlipNo: string | null }
interface FoldRow { foldBatchLotId: number; lotNo: string; quality: string; marka: string | null; foldNo: string | null; batchNo: number | null; available: number; checkingSlipNo: string | null }
interface Availability { party: Party; grey: GreyRow[]; fold: FoldRow[]; totals: { greyThan: number; foldThan: number; lots: number } }

// Selection keys are source-prefixed: a bare id would collide between a grey
// lot and a fold line.
const gKey = (lotNo: string) => `grey:${lotNo.toLowerCase().trim()}`
const fKey = (id: number) => `fold:${id}`
const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function NewGreyReturnPage() {
  const router = useRouter()
  const [partyId, setPartyId] = useState<number | ''>('')
  const [date, setDate] = useState(todayStr())
  const [notes, setNotes] = useState('')
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<Map<string, number>>(new Map())
  // Despatch metres, kept as raw strings so the field can be left blank (grey
  // moves by than AND metres; meter is optional).
  const [meters, setMeters] = useState<Map<string, string>>(new Map())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // ANY party — grey can be returned to anyone. The 'Pali PC Job' tag gates
  // the FINISHED-goods queue (non-Pali parties use the legacy despatch flow);
  // it must not gate returns, or the 235 untagged parties (Prakash Shirting
  // among them, with 901 returnable than) could never send grey back.
  const { data: parties = [] } = useSWR<Party[]>('/api/masters/parties', fetcher)
  const partyList = useMemo(
    () => [...parties].sort((a, b) => a.name.localeCompare(b.name)),
    [parties],
  )

  const { data: avail, isLoading } = useSWR<Availability>(
    partyId ? `/api/grey-return/available?partyId=${partyId}` : null, fetcher, { revalidateOnFocus: false },
  )
  const { data: nextNo } = useSWR<{ next: string }>('/api/grey-return/next-slip-no', fetcher)

  // Clearing the party must clear the selection — the keys refer to that
  // party's lots and fold lines.
  useEffect(() => { setSel(new Map()); setMeters(new Map()) }, [partyId])

  const match = (r: { lotNo: string; quality: string; marka: string | null }) => {
    const s = q.trim().toLowerCase()
    if (!s) return true
    return r.lotNo.toLowerCase().includes(s) || (r.quality || '').toLowerCase().includes(s) || (r.marka || '').toLowerCase().includes(s)
  }
  const greyRows = (avail?.grey ?? []).filter(match)
  const foldRows = (avail?.fold ?? []).filter(match)

  const setThan = (k: string, raw: string, max: number) => {
    setSel(prev => {
      const n = new Map(prev)
      const v = Math.max(1, Math.min(max, Math.floor(Number(raw)) || 0))
      n.set(k, v)
      return n
    })
  }
  const toggle = (k: string, deflt: number) => {
    setSel(prev => { const n = new Map(prev); n.has(k) ? n.delete(k) : n.set(k, deflt); return n })
    // Un-ticking a row drops its metres too, so a stale figure can't be saved.
    setMeters(prev => { if (!sel.has(k)) return prev; const n = new Map(prev); n.delete(k); return n })
  }
  const setMeter = (k: string, raw: string) => {
    setMeters(prev => { const n = new Map(prev); raw === '' ? n.delete(k) : n.set(k, raw); return n })
  }
  const toggleAll = (keys: { k: string; max: number }[]) => {
    setSel(prev => {
      const n = new Map(prev)
      const allOn = keys.every(x => n.has(x.k))
      for (const x of keys) allOn ? n.delete(x.k) : n.set(x.k, x.max)
      return n
    })
  }

  const totalThan = useMemo(() => { let t = 0; for (const v of sel.values()) t += v; return t }, [sel])

  async function save() {
    setError('')
    if (!partyId || sel.size === 0) return
    const lots = [
      ...greyRows.filter(r => sel.has(gKey(r.lotNo))).map(r => ({
        source: 'grey' as const, lotNo: r.lotNo, than: sel.get(gKey(r.lotNo))!, meter: meters.get(gKey(r.lotNo)) ?? null,
      })),
      ...foldRows.filter(r => sel.has(fKey(r.foldBatchLotId))).map(r => ({
        source: 'fold' as const, lotNo: r.lotNo, than: sel.get(fKey(r.foldBatchLotId))!,
        meter: meters.get(fKey(r.foldBatchLotId)) ?? null, foldBatchLotId: r.foldBatchLotId,
      })),
    ]
    if (!lots.length) return
    setSaving(true)
    try {
      const res = await fetch('/api/grey-return', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partyId: Number(partyId), date, notes, lots }),
      })
      const d = await res.json().catch(() => ({} as any))
      if (!res.ok) { setError(d.messages?.join(' · ') || d.message || d.error || `HTTP ${res.status}`); return }
      router.push('/grey-return')
    } catch (e: any) {
      setError(e?.message || 'Network error')
    } finally { setSaving(false) }
  }

  const Row = ({ k, lotNo, quality, marka, available, checkingSlipNo, extra }: {
    k: string; lotNo: string; quality: string; marka: string | null; available: number; checkingSlipNo: string | null; extra?: string | null
  }) => {
    const on = sel.has(k)
    return (
      // preventDefault on the label: without it, typing in the than input
      // bubbles up and toggles the checkbox (bug already solved in
      // GreyCheckingModal — same fix here).
      <label onClick={e => e.preventDefault()}
        className={`flex items-center gap-2 px-3 py-2 border-b border-gray-50 dark:border-gray-800 cursor-pointer ${on ? 'bg-emerald-50/60 dark:bg-emerald-900/20' : ''}`}>
        <input type="checkbox" checked={on} onChange={() => toggle(k, available)} className="accent-emerald-600 shrink-0" />
        <span className="font-mono text-[12px] font-semibold text-gray-800 dark:text-gray-100 truncate w-36 sm:w-44" title={lotNo}>{lotNo}</span>
        <span className="text-[11px] text-gray-500 dark:text-gray-400 truncate hidden sm:inline w-28">{quality}</span>
        {marka && <span className="text-[10px] text-amber-700 dark:text-amber-400 truncate hidden md:inline w-20">{marka}</span>}
        {extra && <span className="text-[10px] text-indigo-600 dark:text-indigo-400 whitespace-nowrap">{extra}</span>}
        {checkingSlipNo && <span className="text-[9px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 rounded px-1 whitespace-nowrap">✓ {checkingSlipNo}</span>}
        <span className="ml-auto text-[11px] text-gray-400 whitespace-nowrap">avail {available}</span>
        {on && (
          <>
            <input type="number" min={1} max={available} value={sel.get(k) ?? ''}
              title="Than to return"
              onClick={ev => ev.stopPropagation()}
              onChange={ev => setThan(k, ev.target.value, available)}
              className="w-16 text-right text-[12px] font-bold border border-emerald-300 dark:border-emerald-700 rounded px-1.5 py-0.5 bg-white dark:bg-gray-700 dark:text-gray-100" />
            <input type="number" min={0} step="0.01" value={meters.get(k) ?? ''} placeholder="mtr"
              title="Despatch metres (optional)"
              onClick={ev => ev.stopPropagation()}
              onChange={ev => setMeter(k, ev.target.value)}
              className="w-20 text-right text-[12px] border border-sky-300 dark:border-sky-700 rounded px-1.5 py-0.5 bg-white dark:bg-gray-700 dark:text-gray-100" />
          </>
        )}
      </label>
    )
  }

  return (
    <div className="p-4 md:p-6 dark:text-gray-100 pb-28">
      <div className="flex items-center gap-3 mb-4">
        <BackButton />
        <h1 className="text-lg sm:text-xl font-bold text-gray-800 dark:text-gray-100">New Grey Return</h1>
        {nextNo?.next && <span className="ml-auto text-[11px] text-gray-400">Will be assigned: <span className="font-mono font-bold text-gray-600 dark:text-gray-300">{nextNo.next}</span></span>}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4 mb-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">
          Party *
          <select value={partyId} onChange={e => setPartyId(e.target.value ? Number(e.target.value) : '')}
            className="mt-1 w-full border border-gray-300 dark:border-gray-600 rounded-lg px-2.5 py-2 text-[13px] bg-white dark:bg-gray-700 dark:text-gray-100">
            <option value="">Select party…</option>
            {partyList.map(p => <option key={p.id} value={p.id}>{p.name}{p.tag ? ` · ${p.tag}` : ''}</option>)}
          </select>
        </label>
        <label className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">
          Date *
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="mt-1 w-full border border-gray-300 dark:border-gray-600 rounded-lg px-2.5 py-2 text-[13px] bg-white dark:bg-gray-700 dark:text-gray-100" />
        </label>
      </div>

      {!partyId && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-8 text-center text-gray-400 text-sm">
          Pick a party to see what can be returned.
        </div>
      )}

      {partyId && isLoading && <div className="p-12 text-center text-gray-400">Loading…</div>}

      {partyId && avail && !isLoading && (
        <>
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              Available to return · {avail.totals.lots} lot{avail.totals.lots === 1 ? '' : 's'} · {avail.totals.greyThan + avail.totals.foldThan} than
            </p>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 lot / quality / marka"
              className="text-[12px] border border-gray-300 dark:border-gray-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-gray-700 dark:text-gray-100 w-44 sm:w-60" />
          </div>

          {avail.grey.length === 0 && avail.fold.length === 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-8 text-center text-gray-400 text-sm">
              Nothing returnable for this party — all their grey is either despatched or already in dyeing.
            </div>
          )}

          {greyRows.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden mb-3">
              <div className="px-3 py-2 bg-slate-50 dark:bg-slate-900/40 flex items-center justify-between border-b border-gray-100 dark:border-gray-700">
                <label className="flex items-center gap-2 text-[12px] font-bold text-gray-700 dark:text-gray-200 cursor-pointer">
                  <input type="checkbox" className="accent-emerald-600"
                    checked={greyRows.every(r => sel.has(gKey(r.lotNo)))}
                    onChange={() => toggleAll(greyRows.map(r => ({ k: gKey(r.lotNo), max: r.available })))} />
                  GREY — not folded
                </label>
                <span className="text-[11px] text-gray-500 dark:text-gray-400">{greyRows.reduce((s, r) => s + r.available, 0)} than</span>
              </div>
              {greyRows.map(r => (
                <Row key={gKey(r.lotNo)} k={gKey(r.lotNo)} lotNo={r.lotNo} quality={r.quality} marka={r.marka}
                  available={r.available} checkingSlipNo={r.checkingSlipNo} />
              ))}
            </div>
          )}

          {foldRows.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden mb-3">
              <div className="px-3 py-2 bg-amber-50 dark:bg-amber-900/20 flex items-center justify-between border-b border-gray-100 dark:border-gray-700">
                <label className="flex items-center gap-2 text-[12px] font-bold text-gray-700 dark:text-gray-200 cursor-pointer">
                  <input type="checkbox" className="accent-emerald-600"
                    checked={foldRows.every(r => sel.has(fKey(r.foldBatchLotId)))}
                    onChange={() => toggleAll(foldRows.map(r => ({ k: fKey(r.foldBatchLotId), max: r.available })))} />
                  IN FOLD — folded, not dyed
                </label>
                <span className="text-[11px] text-gray-500 dark:text-gray-400">{foldRows.reduce((s, r) => s + r.available, 0)} than</span>
              </div>
              {foldRows.map(r => (
                <Row key={fKey(r.foldBatchLotId)} k={fKey(r.foldBatchLotId)} lotNo={r.lotNo} quality={r.quality} marka={r.marka}
                  available={r.available} checkingSlipNo={r.checkingSlipNo}
                  extra={r.foldNo ? `${r.foldNo} · b${r.batchNo}` : null} />
              ))}
              <p className="px-3 py-2 text-[10px] text-amber-700 dark:text-amber-400 bg-amber-50/50 dark:bg-amber-900/10">
                ⓘ Returning folded cloth also reduces that lot&apos;s line in the fold batch, so the fold program stops expecting to dye it.
              </p>
            </div>
          )}

          <label className="block text-[11px] font-semibold text-gray-600 dark:text-gray-300 mb-3">
            Notes
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. returned unprocessed on party's instruction"
              className="mt-1 w-full border border-gray-300 dark:border-gray-600 rounded-lg px-2.5 py-2 text-[13px] bg-white dark:bg-gray-700 dark:text-gray-100" />
          </label>
        </>
      )}

      {error && (
        <div className="rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 text-xs p-3 mb-3">{error}</div>
      )}

      {sel.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-30 bg-emerald-600 text-white px-4 py-3 flex items-center justify-between gap-3 shadow-lg">
          <div className="min-w-0">
            <p className="text-sm font-bold">{sel.size} lot{sel.size === 1 ? '' : 's'} selected · {totalThan} than</p>
            <p className="text-[11px] text-emerald-100 truncate">{avail?.party?.name}</p>
          </div>
          <button onClick={save} disabled={saving}
            className="bg-white text-emerald-700 font-bold text-sm px-4 py-2 rounded-lg disabled:opacity-60 whitespace-nowrap">
            {saving ? 'Saving…' : 'Save Grey Return'}
          </button>
        </div>
      )}
    </div>
  )
}
