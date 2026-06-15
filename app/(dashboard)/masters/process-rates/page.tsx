'use client'

// Approved Process Rate Register — every party's rate contracts, grouped by
// party with version history. Expand a contract to see its rate lines and the
// grey-inward lots linked to it. Create a new rate (POST → new version),
// edit a contract in place (PUT), or delete one (blocked when lots are linked).

import { useState, useMemo } from 'react'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface ProcessType { id: number; code: string; name: string; rateMode: 'FLAT' | 'BY_COLOR_CATEGORY' }
interface RateLine {
  id: number; processTypeId: number; unit: string
  rate: string | null; rateLight: string | null; rateMedium: string | null; rateDark: string | null
  processType: ProcessType
}
interface GreyLot { id: number; lotNo: string; than: number; date: string }
interface Contract {
  id: number; partyId: number; version: number; status: string; effectiveFrom: string
  validityQty: string | null; validityUnit: string | null; notes: string | null
  createdByEmail: string | null; createdAt: string
  party: { id: number; name: string }
  lines: RateLine[]
  greyEntries: GreyLot[]
}
interface Party { id: number; name: string }

const enIN = (v: string | number | null | undefined) =>
  v == null || v === '' ? '—' : new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(Number(v))
const inr = (v: string | number | null | undefined) => (v == null || v === '' ? '—' : `₹${enIN(v)}`)
const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
const today = () => new Date().toISOString().split('T')[0]

const statusPill: Record<string, string> = {
  active: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400',
  superseded: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400',
  cancelled: 'bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400',
}

export default function ProcessRatesPage() {
  const { data: contracts, mutate, isLoading } = useSWR<Contract[]>('/api/process-rates', fetcher)
  const { data: parties } = useSWR<Party[]>('/api/masters/parties', fetcher)
  const [editing, setEditing] = useState<{ mode: 'edit' | 'create'; contract?: Contract; partyId?: number } | null>(null)
  const [q, setQ] = useState('')

  // Group contracts by party (API returns them party-name → version desc).
  const groups = useMemo(() => {
    const map = new Map<number, { party: { id: number; name: string }; contracts: Contract[] }>()
    for (const c of contracts ?? []) {
      if (!map.has(c.partyId)) map.set(c.partyId, { party: c.party, contracts: [] })
      map.get(c.partyId)!.contracts.push(c)
    }
    let arr = [...map.values()]
    if (q.trim()) arr = arr.filter(g => g.party.name.toLowerCase().includes(q.trim().toLowerCase()))
    return arr
  }, [contracts, q])

  return (
    <div className="p-4 md:p-8 max-w-5xl">
      <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Approved Process Rate Register</h1>
        <button onClick={() => setEditing({ mode: 'create' })}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">
          ＋ New Rate
        </button>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        Party-level dyeing / heat-set rates. Each rate change creates a new version; older versions stay as history.
      </p>

      <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 Filter by party…"
        className="w-full sm:max-w-xs mb-5 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-400" />

      {isLoading ? (
        <p className="text-gray-400">Loading…</p>
      ) : groups.length === 0 ? (
        <p className="text-gray-400">No process rates yet. Click “＋ New Rate” to add one.</p>
      ) : (
        <div className="space-y-5">
          {groups.map(g => (
            <PartyBlock key={g.party.id} party={g.party} contracts={g.contracts}
              onNew={() => setEditing({ mode: 'create', partyId: g.party.id })}
              onEdit={c => setEditing({ mode: 'edit', contract: c })}
              onChanged={mutate} />
          ))}
        </div>
      )}

      {editing && (
        <ContractModal mode={editing.mode} contract={editing.contract}
          presetPartyId={editing.partyId} parties={parties ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); mutate() }} />
      )}
    </div>
  )
}

// ── Party block: header + its contracts (active first) ──────────────────────
function PartyBlock({ party, contracts, onNew, onEdit, onChanged }: {
  party: { id: number; name: string }; contracts: Contract[]
  onNew: () => void; onEdit: (c: Contract) => void; onChanged: () => void
}) {
  const active = contracts.find(c => c.status === 'active')
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-700">
        <div className="min-w-0">
          <h2 className="font-bold text-gray-800 dark:text-gray-100 truncate">{party.name}</h2>
          <p className="text-[11px] text-gray-400">
            {active ? `Active v${active.version} · effective ${fmtDate(active.effectiveFrom)}` : 'No active rate'}
            {' · '}{contracts.length} version{contracts.length > 1 ? 's' : ''}
          </p>
        </div>
        <button onClick={onNew}
          className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-700 rounded-lg px-3 py-1.5 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 whitespace-nowrap">
          ＋ New rate
        </button>
      </div>
      <div className="divide-y divide-gray-100 dark:divide-gray-700">
        {contracts.map(c => <ContractRow key={c.id} contract={c} onEdit={() => onEdit(c)} onChanged={onChanged} />)}
      </div>
    </div>
  )
}

// ── Expandable contract row ─────────────────────────────────────────────────
function ContractRow({ contract: c, onEdit, onChanged }: { contract: Contract; onEdit: () => void; onChanged: () => void }) {
  const [open, setOpen] = useState(c.status === 'active')
  const [busy, setBusy] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)

  async function del() {
    if (!confirm(`Delete v${c.version} for ${c.party.name}? This cannot be undone.`)) return
    setBusy(true)
    const res = await fetch(`/api/process-rates/${c.id}`, { method: 'DELETE' })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { alert(d.error ?? 'Delete failed'); return }
    onChanged()
  }

  return (
    <div>
      <div className="flex items-center gap-3 px-4 py-3">
        <button onClick={() => setOpen(o => !o)} className="text-gray-400 hover:text-gray-600 text-xs w-4">{open ? '▼' : '▶'}</button>
        <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${statusPill[c.status] ?? statusPill.superseded}`}>
          v{c.version} · {c.status}
        </span>
        {/* Link button sits above the contract date */}
        <div className="flex flex-col items-start gap-0.5">
          <button onClick={() => setLinkOpen(true)}
            className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-700 rounded px-1.5 py-0.5 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 whitespace-nowrap">
            🔗 Link lots
          </button>
          <span className="text-[11px] text-gray-500 dark:text-gray-400 hidden sm:inline">{fmtDate(c.effectiveFrom)}</span>
        </div>
        {c.validityQty != null && (
          <span className="text-[10px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 rounded px-1.5 py-0.5">
            cap {enIN(c.validityQty)} {c.validityUnit}
          </span>
        )}
        <span className="text-[11px] text-gray-400 ml-auto whitespace-nowrap">
          {c.lines.length} line{c.lines.length > 1 ? 's' : ''} · {c.greyEntries.length} lot{c.greyEntries.length !== 1 ? 's' : ''}
        </span>
        <div className="flex gap-1">
          <button onClick={onEdit} className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline px-1">Edit</button>
          <button onClick={del} disabled={busy} className="text-[11px] text-rose-600 dark:text-rose-400 hover:underline px-1 disabled:opacity-50">Delete</button>
        </div>
      </div>

      {open && (
        <div className="px-4 pb-4 pl-11 space-y-3">
          {/* Rate lines */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {c.lines.map(l => (
              <div key={l.id} className="border border-gray-100 dark:border-gray-700 rounded-lg px-3 py-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-gray-700 dark:text-gray-200">{l.processType.name}</span>
                  <span className="text-[9px] uppercase tracking-wide text-gray-400">
                    {l.processType.rateMode === 'FLAT' ? 'flat' : 'by colour'} · /{l.unit}
                  </span>
                </div>
                {l.processType.rateMode === 'FLAT' ? (
                  <div className="text-sm font-extrabold text-gray-900 dark:text-gray-50">{inr(l.rate)}<span className="text-[10px] font-medium text-gray-400"> /{l.unit}</span></div>
                ) : (
                  <div className="grid grid-cols-3 gap-1.5 text-center">
                    <Cat k="Light" v={l.rateLight} cls="text-amber-600 dark:text-amber-400" />
                    <Cat k="Medium" v={l.rateMedium} cls="text-orange-600 dark:text-orange-400" />
                    <Cat k="Dark" v={l.rateDark} cls="text-violet-600 dark:text-violet-400" />
                  </div>
                )}
              </div>
            ))}
          </div>

          {c.notes && <p className="text-[11px] text-gray-500 dark:text-gray-400 italic">“{c.notes}”</p>}

          {/* Linked lot cards */}
          <div>
            <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1.5">Linked lots ({c.greyEntries.length})</p>
            {c.greyEntries.length === 0 ? (
              <p className="text-[11px] text-gray-400">No grey-inward lots linked to this version yet.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {c.greyEntries.map(lot => (
                  <div key={lot.id} className="border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 bg-gray-50 dark:bg-gray-700/40">
                    <div className="text-[12px] font-mono font-bold text-gray-700 dark:text-gray-200">{lot.lotNo}</div>
                    <div className="text-[9px] text-gray-400">{lot.than} than · {fmtDate(lot.date)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {linkOpen && (
        <LinkLotsModal contract={c} onClose={() => setLinkOpen(false)}
          onLinked={() => { setLinkOpen(false); onChanged() }} />
      )}
    </div>
  )
}

// ── Link non-linked lots to this contract (multi-select) ────────────────────
function LinkLotsModal({ contract: c, onClose, onLinked }: { contract: Contract; onClose: () => void; onLinked: () => void }) {
  const { data, isLoading } = useSWR<{ lots: GreyLot[] }>(`/api/process-rates/${c.id}/lots`, fetcher)
  const lots = data?.lots ?? []
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [saving, setSaving] = useState(false)

  const allChecked = lots.length > 0 && sel.size === lots.length
  const toggle = (id: number) => setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleAll = () => setSel(allChecked ? new Set() : new Set(lots.map(l => l.id)))

  async function link() {
    if (!sel.size) return
    setSaving(true)
    const res = await fetch(`/api/process-rates/${c.id}/lots`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ greyEntryIds: [...sel] }),
    })
    setSaving(false)
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error ?? 'Link failed'); return }
    onLinked()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-900/45" />
      <div onClick={e => e.stopPropagation()}
        className="relative w-full sm:max-w-md bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[88vh] flex flex-col">
        <div className="sm:hidden w-9 h-1 bg-slate-300 rounded-full mx-auto mt-2 mb-1" />
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          <span className="text-sm font-bold text-gray-800 dark:text-gray-100">Link lots — {c.party.name} · v{c.version}</span>
          {lots.length > 0 && (
            <button onClick={toggleAll} className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">
              {allChecked ? 'Clear all' : 'Select all'}
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {isLoading ? (
            <p className="text-gray-400 text-sm px-1 py-4">Loading…</p>
          ) : lots.length === 0 ? (
            <p className="text-gray-400 text-sm px-1 py-4">No unlinked lots for this party — every lot is already linked.</p>
          ) : lots.map(lot => {
            const on = sel.has(lot.id)
            return (
              <button key={lot.id} type="button" onClick={() => toggle(lot.id)}
                className={`w-full flex items-center gap-3 text-left border rounded-lg px-3 py-2 transition ${
                  on ? 'border-indigo-400 ring-1 ring-indigo-300 bg-indigo-50/50 dark:bg-indigo-900/20' : 'border-gray-200 dark:border-gray-600 hover:border-gray-300'
                }`}>
                <span className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] ${on ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-300 dark:border-gray-500'}`}>{on ? '✓' : ''}</span>
                <span className="font-mono font-bold text-[13px] text-gray-700 dark:text-gray-200">{lot.lotNo}</span>
                <span className="text-[11px] text-gray-400 ml-auto">{lot.than} than · {fmtDate(lot.date)}</span>
              </button>
            )
          })}
        </div>

        <div className="flex gap-2 p-3 border-t border-gray-100 dark:border-gray-700">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-xs font-bold text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600">Cancel</button>
          <button onClick={link} disabled={saving || sel.size === 0} className="flex-1 py-2.5 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">
            {saving ? 'Linking…' : `Link ${sel.size || ''} lot${sel.size === 1 ? '' : 's'}`.trim()}
          </button>
        </div>
      </div>
    </div>
  )
}

function Cat({ k, v, cls }: { k: string; v: string | null; cls: string }) {
  return (
    <div className="border border-gray-100 dark:border-gray-700 rounded py-1">
      <div className={`text-[9px] uppercase font-semibold ${cls}`}>{k}</div>
      <div className="text-[12px] font-extrabold text-gray-900 dark:text-gray-50">{inr(v)}</div>
    </div>
  )
}

// ── Create / Edit modal ─────────────────────────────────────────────────────
interface DraftLine { processTypeId: number; rateMode: string; unit: string; rate: string; rateLight: string; rateMedium: string; rateDark: string }

function ContractModal({ mode, contract, presetPartyId, parties, onClose, onSaved }: {
  mode: 'edit' | 'create'; contract?: Contract; presetPartyId?: number
  parties: Party[]; onClose: () => void; onSaved: () => void
}) {
  const { data: types } = useSWR<ProcessType[]>('/api/process-rates/types', fetcher)
  const [partyId, setPartyId] = useState<number | ''>(contract?.partyId ?? presetPartyId ?? '')
  const [effectiveFrom, setEffectiveFrom] = useState(contract ? contract.effectiveFrom.split('T')[0] : today())
  const [validityQty, setValidityQty] = useState(contract?.validityQty ?? '')
  const [validityUnit, setValidityUnit] = useState(contract?.validityUnit ?? 'than')
  const [notes, setNotes] = useState(contract?.notes ?? '')
  const [lines, setLines] = useState<DraftLine[]>(
    contract?.lines.map(l => ({
      processTypeId: l.processTypeId, rateMode: l.processType.rateMode, unit: l.unit,
      rate: l.rate ?? '', rateLight: l.rateLight ?? '', rateMedium: l.rateMedium ?? '', rateDark: l.rateDark ?? '',
    })) ?? [],
  )
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const available = (types ?? []).filter(t => !lines.some(l => l.processTypeId === t.id))
  const nameOf = (id: number) => (types ?? []).find(t => t.id === id)?.name ?? `#${id}`

  function addLine(typeId: number) {
    const t = (types ?? []).find(x => x.id === typeId); if (!t) return
    setLines(prev => [...prev, { processTypeId: t.id, rateMode: t.rateMode, unit: 'kg', rate: '', rateLight: '', rateMedium: '', rateDark: '' }])
  }
  const setLine = (i: number, patch: Partial<DraftLine>) => setLines(prev => prev.map((l, idx) => idx === i ? { ...l, ...patch } : l))
  const removeLine = (i: number) => setLines(prev => prev.filter((_, idx) => idx !== i))

  async function save() {
    if (mode === 'create' && !partyId) { setErr('Pick a party'); return }
    if (!lines.length) { setErr('Add at least one rate line'); return }
    setSaving(true); setErr('')
    const payload = {
      partyId: Number(partyId), effectiveFrom,
      validityQty: String(validityQty).trim() || null,
      validityUnit: String(validityQty).trim() ? validityUnit : null,
      notes: notes.trim() || null,
      lines: lines.map(l => ({
        processTypeId: l.processTypeId, unit: l.unit,
        rate: l.rateMode === 'FLAT' ? l.rate : null,
        rateLight: l.rateMode === 'BY_COLOR_CATEGORY' ? l.rateLight : null,
        rateMedium: l.rateMode === 'BY_COLOR_CATEGORY' ? l.rateMedium : null,
        rateDark: l.rateMode === 'BY_COLOR_CATEGORY' ? l.rateDark : null,
      })),
    }
    const res = mode === 'edit'
      ? await fetch(`/api/process-rates/${contract!.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      : await fetch('/api/process-rates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const d = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) { setErr(d.error ?? 'Save failed'); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-900/45" />
      <div onClick={e => e.stopPropagation()}
        className="relative w-full sm:max-w-lg bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="sm:hidden w-9 h-1 bg-slate-300 rounded-full mx-auto mt-2 mb-1" />
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          <span className="text-sm font-bold text-gray-800 dark:text-gray-100">
            {mode === 'edit' ? `Edit v${contract!.version} — ${contract!.party.name}` : 'New Process Rate'}
          </span>
          {mode === 'create' && <span className="text-[10px] text-indigo-600 dark:text-indigo-400">creates active version</span>}
        </div>

        <div className="p-4 space-y-3">
          {err && <div className="text-xs text-rose-700 bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800 rounded-lg px-3 py-2">{err}</div>}

          {mode === 'create' && (
            <label className="block text-[11px] font-semibold text-gray-600 dark:text-gray-300">
              Party
              <select value={partyId} onChange={e => setPartyId(e.target.value ? Number(e.target.value) : '')} className={inp}>
                <option value="">Select party…</option>
                {parties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          )}

          <div className="grid grid-cols-3 gap-2">
            <label className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">Effective from
              <input type="date" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} className={inp} />
            </label>
            <label className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">Valid till qty <span className="text-gray-400 font-normal">(opt)</span>
              <input type="number" value={validityQty} onChange={e => setValidityQty(e.target.value)} placeholder="—" className={inp} />
            </label>
            <label className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">Unit
              <select value={validityUnit} onChange={e => setValidityUnit(e.target.value)} className={inp}>
                <option value="than">than</option><option value="mtr">mtr</option><option value="kg">kg</option>
              </select>
            </label>
          </div>

          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={l.processTypeId} className="border border-gray-200 dark:border-gray-600 rounded-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-gray-700 dark:text-gray-200">{nameOf(l.processTypeId)}</span>
                  <div className="flex items-center gap-2">
                    <select value={l.unit} onChange={e => setLine(i, { unit: e.target.value })} className="text-[11px] border border-gray-300 dark:border-gray-600 dark:bg-gray-700 rounded px-1.5 py-0.5">
                      <option value="kg">/kg</option><option value="mtr">/mtr</option><option value="than">/than</option>
                    </select>
                    <button type="button" onClick={() => removeLine(i)} className="text-rose-500 text-[11px] hover:underline">remove</button>
                  </div>
                </div>
                {l.rateMode === 'FLAT' ? (
                  <input type="number" step="0.01" value={l.rate} onChange={e => setLine(i, { rate: e.target.value })} placeholder="Rate" className={inp} />
                ) : (
                  <div className="grid grid-cols-3 gap-1.5">
                    <input type="number" step="0.01" value={l.rateLight} onChange={e => setLine(i, { rateLight: e.target.value })} placeholder="Light" className={inp} />
                    <input type="number" step="0.01" value={l.rateMedium} onChange={e => setLine(i, { rateMedium: e.target.value })} placeholder="Medium" className={inp} />
                    <input type="number" step="0.01" value={l.rateDark} onChange={e => setLine(i, { rateDark: e.target.value })} placeholder="Dark" className={inp} />
                  </div>
                )}
              </div>
            ))}
          </div>

          {available.length > 0 && (
            <select value="" onChange={e => e.target.value && addLine(Number(e.target.value))} className={inp}>
              <option value="">+ Add process type…</option>
              {available.map(t => <option key={t.id} value={t.id}>{t.name} ({t.rateMode === 'FLAT' ? 'flat' : 'L/M/D'})</option>)}
            </select>
          )}

          <label className="block text-[11px] font-semibold text-gray-600 dark:text-gray-300">Notes <span className="text-gray-400 font-normal">(opt)</span>
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. confirmed on call by Rahul" className={inp} />
          </label>

          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-xs font-bold text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600">Cancel</button>
            <button onClick={save} disabled={saving} className="flex-1 py-2.5 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60">
              {saving ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Save rate'}
            </button>
          </div>
          {mode === 'edit' && <p className="text-[10px] text-gray-400 text-center">Editing fixes this version in place. To change rates going forward, use “＋ New rate” instead.</p>}
        </div>
      </div>
    </div>
  )
}

const inp = 'mt-1 w-full border border-gray-300 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-[13px] bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-400'
