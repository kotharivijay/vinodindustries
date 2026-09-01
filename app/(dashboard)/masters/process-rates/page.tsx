'use client'

// Approved Process Rate Register — every party's rate contracts, grouped by
// party with version history. Expand a contract to see its rate lines and the
// grey-inward lots linked to it. Create a new rate (POST → new version),
// edit a contract in place (PUT), or delete one (blocked when lots are linked).

import { useState, useMemo, useRef, useEffect } from 'react'
import useSWR, { useSWRConfig } from 'swr'
import { LotLink } from '@/lib/viewStatePersist'
import BackButton from '../../BackButton'
import { notesToPoints } from '@/lib/process-rate-notes'

const fetcher = (url: string) => fetch(url).then(r => r.json())
// Back-nav state key — lets /lot/[lotNo] return here with scroll restored.
const PR_VIEW_KEY = 'process-rates-view'

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
      <div className="flex items-center gap-3 mb-2 flex-wrap">
        <BackButton fallback="/dashboard" />
        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Approved Process Rate Register</h1>
        <button onClick={() => setEditing({ mode: 'create' })}
          className="ml-auto px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">
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
        {contracts.map(c => <ContractRow key={c.id} contract={c} siblings={contracts} onEdit={() => onEdit(c)} onChanged={onChanged} />)}
      </div>
    </div>
  )
}

// ── Expandable contract row ─────────────────────────────────────────────────
function ContractRow({ contract: c, siblings, onEdit, onChanged }: { contract: Contract; siblings: Contract[]; onEdit: () => void; onChanged: () => void }) {
  const [open, setOpen] = useState(c.status === 'active')
  const [busy, setBusy] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [unlinkOpen, setUnlinkOpen] = useState(false)
  const { mutate: globalMutate } = useSWRConfig()
  // Revalidate every process-rate cache (candidate lists + usage bars) so a
  // just-(un)linked lot can't linger in another version's modal and the bars
  // recompute their linked totals.
  const refreshAll = () => globalMutate((key: any) => typeof key === 'string' && key.includes('/process-rates'))

  const [sharing, setSharing] = useState(false)
  async function share() {
    setSharing(true)
    try {
      const { shareProcessRateImage } = await import('@/lib/process-rate-share')
      await shareProcessRateImage({
        partyName: c.party.name,
        version: c.version,
        status: c.status,
        effectiveFrom: c.effectiveFrom,
        validityQty: c.validityQty,
        validityUnit: c.validityUnit,
        notes: c.notes,
        lines: c.lines.map(l => ({
          processTypeName: l.processType.name,
          rateMode: l.processType.rateMode,
          unit: l.unit,
          rate: l.rate, rateLight: l.rateLight, rateMedium: l.rateMedium, rateDark: l.rateDark,
        })),
        linkedLots: c.greyEntries.length,
        linkedThan: c.greyEntries.reduce((s, g) => s + g.than, 0),
      })
    } catch (e: any) {
      alert('Share failed: ' + (e?.message ?? 'unknown error'))
    } finally { setSharing(false) }
  }

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
          <button onClick={share} disabled={sharing}
            title="Share this rate card on WhatsApp as an image"
            className="text-[11px] text-emerald-600 dark:text-emerald-400 hover:underline px-1 disabled:opacity-50 whitespace-nowrap">
            {sharing ? '…' : '📤 Share'}
          </button>
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

          <ValidityBar c={c} />

          {c.notes && (
            <div className="text-[12px] text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2 mb-1">
                <span>📝</span>
                <span className="text-[10px] uppercase tracking-wide font-semibold opacity-70">Terms &amp; notes</span>
              </div>
              {/* Notes are typed as one run-on line with the point numbers
                  buried in it — split and renumber for readability. */}
              <ol className="space-y-1">
                {notesToPoints(c.notes).map((p, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="font-bold shrink-0 tabular-nums">{p.n}.</span>
                    <span>{p.text}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Rate rules — contract-defined billing adjustments, evaluated on
              the delivery-challan billing view */}
          <RulesEditor contract={c} siblings={siblings} />

          {/* Linked lot cards */}
          <div>
            <div className="flex items-center justify-between mb-1.5 gap-2">
              <p className="text-[10px] uppercase tracking-wide text-gray-400">Linked lots ({c.greyEntries.length})</p>
              {c.greyEntries.length > 0 && (
                <button onClick={() => setUnlinkOpen(true)}
                  className="text-[10px] font-semibold text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800 rounded px-1.5 py-0.5 hover:bg-rose-50 dark:hover:bg-rose-900/20 whitespace-nowrap">
                  ⛓️‍💥 Unlink
                </button>
              )}
            </div>
            {c.greyEntries.length === 0 ? (
              <p className="text-[11px] text-gray-400">No grey-inward lots linked to this version yet.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {c.greyEntries.map(lot => (
                  <LotLink key={lot.id} lotNo={lot.lotNo} storageKey={PR_VIEW_KEY}
                    className="block border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 bg-gray-50 dark:bg-gray-700/40 hover:border-indigo-300 dark:hover:border-indigo-600 hover:bg-indigo-50/50 dark:hover:bg-indigo-900/20 transition">
                    <div className="text-[12px] font-mono font-bold text-indigo-700 dark:text-indigo-300 hover:underline">{lot.lotNo}</div>
                    <div className="text-[9px] text-gray-400">{lot.than} than · {fmtDate(lot.date)}</div>
                  </LotLink>
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
      {unlinkOpen && (
        <UnlinkLotsModal contract={c} onClose={() => setUnlinkOpen(false)}
          onUnlinked={() => { setUnlinkOpen(false); onChanged(); refreshAll() }} />
      )}
    </div>
  )
}

// ── Rate rules: contract-defined billing adjustments ────────────────────────
// Batch-size surcharges, Jet-1 discount, width extras, LR-triggered and
// manual charges. Stored per contract version (copied forward on supersede);
// evaluated by lib/process-rate-rules.ts on the delivery-challan billing view.
interface RuleRow {
  id?: number
  processTypeId: number | '' // '' = all lines
  trigger: 'auto' | 'lr' | 'manual'
  minThan: string; maxThan: string; widthInch: string; machineNumber: string
  amountPerThan: string
  label: string
}
function RulesEditor({ contract: c, siblings }: { contract: Contract; siblings: Contract[] }) {
  const { data: saved = [], mutate } = useSWR<any[]>(`/api/process-rates/${c.id}/rules`, fetcher, { revalidateOnFocus: false })
  const { mutate: globalMutate } = useSWRConfig()
  const [editing, setEditing] = useState(false)
  const [rows, setRows] = useState<RuleRow[]>([])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  // Copy-to-version panel: pick rules, pick target versions, copy (append).
  const [copyOpen, setCopyOpen] = useState(false)
  const [copyRules, setCopyRules] = useState<Set<number>>(new Set())
  const [copyTargets, setCopyTargets] = useState<Set<number>>(new Set())
  const [copying, setCopying] = useState(false)
  const [copyMsg, setCopyMsg] = useState('')
  const otherVersions = siblings.filter(s => s.id !== c.id).sort((a, b) => b.version - a.version)

  function startEdit() {
    setRows(saved.map(r => ({
      id: r.id,
      processTypeId: r.processTypeId ?? '',
      trigger: r.trigger,
      minThan: r.minThan != null ? String(r.minThan) : '',
      maxThan: r.maxThan != null ? String(r.maxThan) : '',
      widthInch: r.widthInch != null ? String(r.widthInch) : '',
      machineNumber: r.machineNumber != null ? String(r.machineNumber) : '',
      amountPerThan: String(r.amountPerThan),
      label: r.label,
    })))
    setErr(''); setEditing(true)
  }
  const setRow = (i: number, patch: Partial<RuleRow>) => setRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r))
  const addRow = () => setRows(prev => [...prev, { processTypeId: '', trigger: 'auto', minThan: '', maxThan: '', widthInch: '', machineNumber: '', amountPerThan: '', label: '' }])
  const delRow = (i: number) => setRows(prev => prev.filter((_, idx) => idx !== i))

  async function save() {
    setSaving(true); setErr('')
    try {
      const res = await fetch(`/api/process-rates/${c.id}/rules`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules: rows.map(r => ({
          processTypeId: r.processTypeId === '' ? null : Number(r.processTypeId),
          trigger: r.trigger,
          minThan: r.minThan || null, maxThan: r.maxThan || null,
          widthInch: r.widthInch || null, machineNumber: r.machineNumber || null,
          amountPerThan: r.amountPerThan, label: r.label,
        })) }),
      })
      const d = await res.json().catch(() => ({} as any))
      if (!res.ok) { setErr(d.messages?.join(' · ') || d.error || `HTTP ${res.status}`); return }
      mutate(); setEditing(false)
    } finally { setSaving(false) }
  }

  function openCopy() {
    // Default: all rules selected, no targets yet.
    setCopyRules(new Set(saved.map(r => r.id)))
    setCopyTargets(new Set())
    setCopyMsg('')
    setCopyOpen(true)
  }
  const toggleSet = (set: Set<number>, setFn: (s: Set<number>) => void, id: number) => {
    const n = new Set(set); n.has(id) ? n.delete(id) : n.add(id); setFn(n)
  }
  async function doCopy() {
    if (copyRules.size === 0 || copyTargets.size === 0) return
    setCopying(true); setCopyMsg('')
    try {
      const res = await fetch(`/api/process-rates/${c.id}/rules/copy`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ruleIds: [...copyRules], targetContractIds: [...copyTargets] }),
      })
      const d = await res.json().catch(() => ({} as any))
      if (!res.ok) { setCopyMsg(d.message || d.error || `HTTP ${res.status}`); return }
      const parts = (d.results ?? []).map((r: any) => {
        const skips: string[] = []
        if (r.skippedDuplicate) skips.push(`${r.skippedDuplicate} already there`)
        if (r.skippedNoLine) skips.push(`${r.skippedNoLine} no matching rate line`)
        return `v${r.version}: ${r.copied} copied${skips.length ? ` (${skips.join(', ')})` : ''}`
      })
      setCopyMsg(`✓ ${parts.join(' · ')}`)
      // Refresh every version's rules list so the target cards update.
      globalMutate((k: any) => typeof k === 'string' && k.includes('/process-rates'))
    } finally { setCopying(false) }
  }

  // Human-readable condition summary for the read view.
  const condText = (r: any) => {
    if (r.trigger === 'lr') return 'when line has a real LR'
    if (r.trigger === 'manual') return 'manual tick on the bill'
    const parts: string[] = []
    if (r.minThan != null && r.maxThan != null) parts.push(`batch ${r.minThan}–${r.maxThan} than`)
    else if (r.maxThan != null) parts.push(`batch ≤ ${r.maxThan} than`)
    else if (r.minThan != null) parts.push(`batch ≥ ${r.minThan} than`)
    if (r.widthInch != null) parts.push(`width ${r.widthInch}"`)
    if (r.machineNumber != null) parts.push(`Jet ${r.machineNumber}`)
    return parts.join(' · ') || '(no condition)'
  }
  const inpS = 'border border-gray-300 dark:border-gray-600 rounded px-1.5 py-1 text-[11px] bg-white dark:bg-gray-700 dark:text-gray-100'

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5 gap-2">
        <p className="text-[10px] uppercase tracking-wide text-gray-400">Rate rules ({saved.length})</p>
        {!editing && (
          <span className="flex items-center gap-1">
            {saved.length > 0 && otherVersions.length > 0 && (
              <button onClick={() => copyOpen ? setCopyOpen(false) : openCopy()}
                title="Copy selected rules to other versions of this party's contract"
                className="text-[10px] font-semibold text-sky-600 dark:text-sky-400 border border-sky-200 dark:border-sky-700 rounded px-1.5 py-0.5 hover:bg-sky-50 dark:hover:bg-sky-900/20 whitespace-nowrap">
                ⧉ Copy to…
              </button>
            )}
            <button onClick={startEdit}
              className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-700 rounded px-1.5 py-0.5 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 whitespace-nowrap">
              ⚙ {saved.length ? 'Edit rules' : 'Add rules'}
            </button>
          </span>
        )}
      </div>

      {!editing && saved.length === 0 && (
        <p className="text-[11px] text-gray-400">No billing rules — lines bill at the plain contract rate.</p>
      )}
      {!editing && saved.length > 0 && (
        <div className="space-y-1">
          {saved.map(r => (
            <div key={r.id} className="flex items-center gap-2 text-[11px] border border-gray-100 dark:border-gray-700 rounded-lg px-2.5 py-1.5">
              {copyOpen && (
                <input type="checkbox" checked={copyRules.has(r.id)}
                  onChange={() => toggleSet(copyRules, setCopyRules, r.id)}
                  className="accent-sky-600 shrink-0" />
              )}
              <span className="font-semibold text-gray-700 dark:text-gray-200 truncate">{r.label}</span>
              <span className="text-gray-400 truncate">{r.processType?.name ?? 'All lines'} · {condText(r)}</span>
              <span className={`ml-auto font-bold tabular-nums whitespace-nowrap ${Number(r.amountPerThan) < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>
                {Number(r.amountPerThan) > 0 ? '+' : ''}{Number(r.amountPerThan)} /than
              </span>
            </div>
          ))}

          {/* Copy-to-versions panel: rules tick above, versions tick here.
              Copies APPEND to the target; exact duplicates and rules whose
              process type has no rate line there are skipped server-side. */}
          {copyOpen && (
            <div className="border border-sky-200 dark:border-sky-800 bg-sky-50/50 dark:bg-sky-900/10 rounded-lg px-3 py-2 space-y-2">
              <p className="text-[10px] uppercase tracking-wide font-semibold text-sky-700 dark:text-sky-300">
                Copy {copyRules.size} rule{copyRules.size === 1 ? '' : 's'} to:
              </p>
              <div className="flex flex-wrap gap-2">
                {otherVersions.map(v => (
                  <label key={v.id} className="flex items-center gap-1.5 text-[11px] text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1 cursor-pointer bg-white dark:bg-gray-800">
                    <input type="checkbox" checked={copyTargets.has(v.id)}
                      onChange={() => toggleSet(copyTargets, setCopyTargets, v.id)}
                      className="accent-sky-600" />
                    <span className="font-bold">v{v.version}</span>
                    <span className="text-gray-400">· {v.status} · {v.lines.length} line{v.lines.length === 1 ? '' : 's'}</span>
                  </label>
                ))}
              </div>
              {copyMsg && (
                <p className={`text-[11px] ${copyMsg.startsWith('✓') ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>{copyMsg}</p>
              )}
              <div className="flex items-center gap-2">
                <button onClick={doCopy} disabled={copying || copyRules.size === 0 || copyTargets.size === 0}
                  className="text-[11px] font-bold text-white bg-sky-600 hover:bg-sky-700 rounded px-2.5 py-1 disabled:opacity-50">
                  {copying ? 'Copying…' : `Copy to ${copyTargets.size} version${copyTargets.size === 1 ? '' : 's'}`}
                </button>
                <button onClick={() => setCopyOpen(false)} className="text-[11px] text-gray-500 dark:text-gray-400 hover:underline">Close</button>
              </div>
            </div>
          )}
        </div>
      )}

      {editing && (
        <div className="space-y-2">
          {err && <div className="text-xs text-rose-700 bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800 rounded-lg px-3 py-2">{err}</div>}
          {rows.map((r, i) => (
            <div key={i} className="border border-gray-200 dark:border-gray-600 rounded-xl p-2 space-y-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <input value={r.label} onChange={e => setRow(i, { label: e.target.value })} placeholder="Label (shown on the bill)"
                  className={`${inpS} flex-1 min-w-[10rem] font-semibold`} />
                <select value={r.processTypeId} onChange={e => setRow(i, { processTypeId: e.target.value === '' ? '' : Number(e.target.value) })} className={inpS}>
                  <option value="">All lines</option>
                  {c.lines.map(l => <option key={l.processTypeId} value={l.processTypeId}>{l.processType.name}</option>)}
                </select>
                <select value={r.trigger} onChange={e => setRow(i, { trigger: e.target.value as RuleRow['trigger'] })} className={inpS}>
                  <option value="auto">auto (conditions)</option>
                  <option value="lr">when real LR</option>
                  <option value="manual">manual tick</option>
                </select>
                <button onClick={() => delRow(i)} className="text-rose-500 text-[11px] hover:underline px-1">remove</button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {r.trigger === 'auto' && (
                  <>
                    <label className="text-[10px] text-gray-500 flex items-center gap-1">batch ≥
                      <input type="number" value={r.minThan} onChange={e => setRow(i, { minThan: e.target.value })} className={`${inpS} w-14`} /></label>
                    <label className="text-[10px] text-gray-500 flex items-center gap-1">batch ≤
                      <input type="number" value={r.maxThan} onChange={e => setRow(i, { maxThan: e.target.value })} className={`${inpS} w-14`} /></label>
                    <label className="text-[10px] text-gray-500 flex items-center gap-1">width
                      <input type="number" value={r.widthInch} onChange={e => setRow(i, { widthInch: e.target.value })} className={`${inpS} w-14`} placeholder={'44'} /></label>
                    <label className="text-[10px] text-gray-500 flex items-center gap-1">Jet no
                      <input type="number" value={r.machineNumber} onChange={e => setRow(i, { machineNumber: e.target.value })} className={`${inpS} w-12`} /></label>
                  </>
                )}
                <label className="text-[10px] text-gray-500 flex items-center gap-1 ml-auto">₹/than
                  <input type="number" step="0.01" value={r.amountPerThan} onChange={e => setRow(i, { amountPerThan: e.target.value })}
                    placeholder="+20 / -25" className={`${inpS} w-20 text-right font-bold`} /></label>
              </div>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <button onClick={addRow} className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline">+ Add rule</button>
            <div className="ml-auto flex gap-2">
              <button onClick={() => setEditing(false)} className="text-[11px] text-gray-500 dark:text-gray-400 border border-gray-300 dark:border-gray-600 rounded px-2.5 py-1">Cancel</button>
              <button onClick={save} disabled={saving}
                className="text-[11px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded px-2.5 py-1 disabled:opacity-50">
                {saving ? 'Saving…' : 'Save rules'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Unlink linked lots from this contract (multi-select) ────────────────────
function UnlinkLotsModal({ contract: c, onClose, onUnlinked }: { contract: Contract; onClose: () => void; onUnlinked: () => void }) {
  const lots = c.greyEntries // already the contract's linked lots
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [saving, setSaving] = useState(false)

  const allChecked = lots.length > 0 && sel.size === lots.length
  const toggle = (id: number) => setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleAll = () => setSel(allChecked ? new Set() : new Set(lots.map(l => l.id)))
  const selThan = lots.reduce((s, l) => s + (sel.has(l.id) ? l.than : 0), 0)
  const totalThan = lots.reduce((s, l) => s + l.than, 0)

  async function unlink() {
    if (!sel.size) return
    setSaving(true)
    const res = await fetch(`/api/process-rates/${c.id}/lots`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unlinkIds: [...sel] }),
    })
    setSaving(false)
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error ?? 'Unlink failed'); return }
    onUnlinked()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-900/45" />
      <div onClick={e => e.stopPropagation()}
        className="relative w-full sm:max-w-md bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[88vh] flex flex-col">
        <div className="sm:hidden w-9 h-1 bg-slate-300 rounded-full mx-auto mt-2 mb-1" />
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          <span className="text-sm font-bold text-gray-800 dark:text-gray-100">Unlink lots — {c.party.name} · v{c.version}</span>
          {lots.length > 0 && (
            <button onClick={toggleAll} className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">
              {allChecked ? 'Clear all' : 'Select all'}
            </button>
          )}
        </div>

        {lots.length > 0 && (
          <div className="flex items-center justify-between px-4 py-2 bg-rose-50 dark:bg-rose-900/20 border-b border-rose-100 dark:border-rose-900/40 text-[12px]">
            <span className="text-gray-600 dark:text-gray-300">
              Selected <span className="font-bold text-rose-700 dark:text-rose-300">{sel.size}</span> of {lots.length} lots
            </span>
            <span className="text-gray-600 dark:text-gray-300">
              Than <span className="font-bold text-rose-700 dark:text-rose-300 text-sm">{selThan.toLocaleString('en-IN')}</span>
              <span className="text-gray-400 dark:text-gray-500"> / {totalThan.toLocaleString('en-IN')}</span>
            </span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {lots.length === 0 ? (
            <p className="text-gray-400 text-sm px-1 py-4">No lots linked to this contract.</p>
          ) : lots.map(lot => {
            const on = sel.has(lot.id)
            return (
              <button key={lot.id} type="button" onClick={() => toggle(lot.id)}
                className={`w-full flex items-center gap-3 text-left border rounded-lg px-3 py-2 transition ${
                  on ? 'border-rose-400 ring-1 ring-rose-300 bg-rose-50/50 dark:bg-rose-900/20' : 'border-gray-200 dark:border-gray-600 hover:border-gray-300'
                }`}>
                <span className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] ${on ? 'bg-rose-600 border-rose-600 text-white' : 'border-gray-300 dark:border-gray-500'}`}>{on ? '✓' : ''}</span>
                <span className="font-mono font-bold text-[13px] text-gray-700 dark:text-gray-200">{lot.lotNo}</span>
                <span className="text-[11px] text-gray-400 ml-auto">{lot.than} than · {fmtDate(lot.date)}</span>
              </button>
            )
          })}
        </div>

        <div className="flex gap-2 p-3 border-t border-gray-100 dark:border-gray-700">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-xs font-bold text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600">Cancel</button>
          <button onClick={unlink} disabled={saving || sel.size === 0} className="flex-1 py-2.5 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50">
            {saving ? 'Unlinking…' : `Unlink ${sel.size || ''} lot${sel.size === 1 ? '' : 's'}`.trim()}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Link non-linked lots to this contract (multi-select) ────────────────────
function LinkLotsModal({ contract: c, onClose, onLinked }: { contract: Contract; onClose: () => void; onLinked: () => void }) {
  const { data, isLoading } = useSWR<{ lots: GreyLot[] }>(`/api/process-rates/${c.id}/lots`, fetcher)
  const { mutate: globalMutate } = useSWRConfig()
  const lots = data?.lots ?? []
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [saving, setSaving] = useState(false)

  const allChecked = lots.length > 0 && sel.size === lots.length
  const toggle = (id: number) => setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleAll = () => setSel(allChecked ? new Set() : new Set(lots.map(l => l.id)))
  const selThan = lots.reduce((s, l) => s + (sel.has(l.id) ? l.than : 0), 0)
  const totalThan = lots.reduce((s, l) => s + l.than, 0)

  async function link() {
    if (!sel.size) return
    setSaving(true)
    const res = await fetch(`/api/process-rates/${c.id}/lots`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ greyEntryIds: [...sel] }),
    })
    setSaving(false)
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error ?? 'Link failed'); return }
    // Refresh candidate lists + usage bars so these lots drop out everywhere
    // and the linked totals recompute.
    globalMutate((key: any) => typeof key === 'string' && key.includes('/process-rates'))
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

        {lots.length > 0 && (
          <div className="flex items-center justify-between px-4 py-2 bg-indigo-50 dark:bg-indigo-900/20 border-b border-indigo-100 dark:border-indigo-900/40 text-[12px]">
            <span className="text-gray-600 dark:text-gray-300">
              Selected <span className="font-bold text-indigo-700 dark:text-indigo-300">{sel.size}</span> of {lots.length} lots
            </span>
            <span className="text-gray-600 dark:text-gray-300">
              Than <span className="font-bold text-indigo-700 dark:text-indigo-300 text-sm">{selThan.toLocaleString('en-IN')}</span>
              <span className="text-gray-400 dark:text-gray-500"> / {totalThan.toLocaleString('en-IN')}</span>
            </span>
          </div>
        )}

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

// Quantity bar — "used" is the total `than` of the lots LINKED to this contract.
// Shows a progress bar against the cap when one is set; otherwise just the
// linked total so you can always see consumption.
function ValidityBar({ c }: { c: Contract }) {
  const { data: u } = useSWR<{ used: number; validityUnit: string; exceeded: boolean; kgTracked: boolean }>(
    `/api/process-rates/qty-usage?partyId=${c.partyId}&contractId=${c.id}`, fetcher)
  if (!u) return <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-700 animate-pulse" />

  if (c.validityQty == null) {
    return (
      <div className="flex items-center justify-between text-[11px] gap-2">
        <span className="text-gray-500 dark:text-gray-400">Linked total · since {fmtDate(c.effectiveFrom)}</span>
        <span className="font-bold text-gray-700 dark:text-gray-200 whitespace-nowrap">{enIN(u.used)} {u.validityUnit} · no cap</span>
      </div>
    )
  }

  const cap = Number(c.validityQty)
  const pct = cap > 0 ? Math.min(100, Math.round((u.used / cap) * 100)) : 0
  const bar = u.exceeded ? 'bg-rose-500' : pct >= 85 ? 'bg-amber-500' : 'bg-emerald-500'
  const txt = u.exceeded ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-1 gap-2">
        <span className="text-gray-500 dark:text-gray-400">Quantity validity · since {fmtDate(c.effectiveFrom)}</span>
        <span className={`font-bold whitespace-nowrap ${txt}`}>{enIN(u.used)} {u.validityUnit} / {enIN(cap)} {u.validityUnit} · {pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
        <div className={`h-full ${bar} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      {!u.kgTracked && <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">kg cap approximated by than count</p>}
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
    setLines(prev => [...prev, { processTypeId: t.id, rateMode: t.rateMode, unit: 'than', rate: '', rateLight: '', rateMedium: '', rateDark: '' }])
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
              <PartySearchSelect parties={parties} value={partyId} onChange={setPartyId} />
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
                <option value="than">than</option><option value="mtr">mtr</option>
              </select>
            </label>
          </div>

          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={l.processTypeId} className="border border-gray-200 dark:border-gray-600 rounded-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-gray-700 dark:text-gray-200">{nameOf(l.processTypeId)}</span>
                  <div className="flex items-center gap-2">
                    {/* kg is not offered — rates are per than (weight is never
                        stored numerically, so a per-kg rate can't be billed). */}
                    <select value={l.unit} onChange={e => setLine(i, { unit: e.target.value })} className="text-[11px] border border-gray-300 dark:border-gray-600 dark:bg-gray-700 rounded px-1.5 py-0.5">
                      <option value="than">/than</option><option value="mtr">/mtr</option>
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

// Searchable party dropdown — type to filter, click to pick. Falls back to the
// full list when the query is empty or equals the current selection.
function PartySearchSelect({ parties, value, onChange }: {
  parties: Party[]; value: number | ''; onChange: (id: number | '') => void
}) {
  const selected = parties.find(p => p.id === value)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Show the selected party name once it's known (and not mid-typing).
  useEffect(() => { if (selected && !query) setQuery(selected.name) }, [selected, query])
  // Close on outside click; revert the text to the current selection.
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        if (selected) setQuery(selected.name)
      }
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [selected])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const base = (!q || q === selected?.name.toLowerCase()) ? parties : parties.filter(p => p.name.toLowerCase().includes(q))
    return base.slice(0, 60)
  }, [parties, query, selected])

  return (
    <div ref={ref} className="relative">
      <input
        className={inp}
        value={query}
        placeholder="Search party…"
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
      />
      {open && (
        <div className="absolute z-30 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 shadow-lg">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500">No party found</div>
          ) : filtered.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => { onChange(p.id); setQuery(p.name); setOpen(false) }}
              className={`w-full text-left px-3 py-1.5 text-[13px] text-gray-800 dark:text-gray-100 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 ${p.id === value ? 'bg-indigo-50 dark:bg-indigo-900/20 font-semibold' : ''}`}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
