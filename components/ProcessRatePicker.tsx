'use client'

// Process Rate pill + rate-card sheet for the Grey Inward forms.
//
// Behaviour:
//  • Activates when a party is selected. Fetches that party's ACTIVE contract.
//  • Auto-stamps the active contract id onto the form (value.contractId) so the
//    lot links to the rate even if the operator never opens the card.
//  • Clicking the pill opens a card (bottom-sheet on mobile, centred dialog on
//    desktop): view rates + pick which process type this lot is, "Update Rates"
//    (creates a new version for the whole party), or — if no contract exists —
//    an inline "Add Process Rate" form.
//
// The save-time quantity-validity warning lives in the parent form (it needs
// the row's `than`); this component only links the contract + process type.

import { useState, useEffect, useCallback, useRef } from 'react'

export interface ProcessRateValue { contractId: number | null; processTypeId: number | null }

interface ProcessType { id: number; code: string; name: string; rateMode: 'FLAT' | 'BY_COLOR_CATEGORY' }
interface RateLine {
  id: number; processTypeId: number; unit: string
  rate: string | null; rateLight: string | null; rateMedium: string | null; rateDark: string | null
  processType: ProcessType
}
interface Contract {
  id: number; version: number; status: string; effectiveFrom: string
  validityQty: string | null; validityUnit: string | null; notes: string | null
  lines: RateLine[]
}
interface Usage {
  validityUnit: string; validityQty: string | null; kgTracked: boolean
  used: number; remaining: number | null; exceeded: boolean
}

const inr = (v: string | number | null | undefined) =>
  v == null || v === '' ? '—' : `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(Number(v))}`
const nf = (n: number) => new Intl.NumberFormat('en-IN').format(n)
const today = () => new Date().toISOString().split('T')[0]
const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

export default function ProcessRatePicker({
  partyId, value, onChange, autoStamp = true,
}: {
  partyId: number | null
  value: ProcessRateValue
  onChange: (v: ProcessRateValue) => void
  // When true (new entry), selecting a party auto-links its active contract.
  // When false (edit), the lot keeps its already-saved link — the card still
  // shows the party's active rate, but the link isn't overwritten on load.
  autoStamp?: boolean
}) {
  const [contract, setContract] = useState<Contract | null>(null)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'view' | 'form'>('view')
  const [usage, setUsage] = useState<Usage | null>(null)
  const autoStampRef = useRef(autoStamp); autoStampRef.current = autoStamp

  const loadActive = useCallback(async (pid: number) => {
    setLoading(true)
    try {
      const r = await fetch(`/api/process-rates/active?partyId=${pid}`)
      const d = await r.json()
      const c: Contract | null = d.contract ?? null
      setContract(c)
      // Auto-stamp / clear the contract link as the party changes (new entries
      // only — edit preserves the lot's saved link).
      if (autoStampRef.current) onChange({ contractId: c?.id ?? null, processTypeId: c ? value.processTypeId : null })
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!partyId) { setContract(null); if (autoStampRef.current) onChange({ contractId: null, processTypeId: null }); return }
    loadActive(partyId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partyId])

  // Pull quantity usage when the card opens on a capped contract.
  useEffect(() => {
    if (!open || !contract || !partyId || contract.validityQty == null) { setUsage(null); return }
    fetch(`/api/process-rates/qty-usage?partyId=${partyId}&contractId=${contract.id}`)
      .then(r => r.json()).then(setUsage).catch(() => setUsage(null))
  }, [open, contract, partyId])

  function openCard() {
    if (!partyId) return
    setMode(contract ? 'view' : 'form')
    setOpen(true)
  }

  async function afterSave(newContractId: number) {
    await loadActive(partyId!)
    onChange({ contractId: newContractId, processTypeId: null })
    setMode('view')
  }

  // ── Pill ──────────────────────────────────────────────────────────────────
  const pill = (() => {
    if (!partyId) return { cls: 'bg-gray-50 text-gray-400 border-gray-200', label: '● Process Rate' }
    if (loading) return { cls: 'bg-gray-50 text-gray-400 border-gray-200', label: '● Loading…' }
    if (contract) return { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: '● Process Rate ✓' }
    return { cls: 'bg-amber-50 text-amber-700 border-amber-200', label: '● No rate — Add' }
  })()

  return (
    <>
      <button type="button" onClick={openCard} disabled={!partyId}
        className={`inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full border transition disabled:opacity-50 ${pill.cls}`}>
        {pill.label} {partyId && <span className="opacity-60">›</span>}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
          onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-slate-900/45" />
          <div onClick={e => e.stopPropagation()}
            className="relative w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl
                       max-h-[88vh] overflow-y-auto">
            {/* mobile grab handle */}
            <div className="sm:hidden w-9 h-1 bg-slate-300 rounded-full mx-auto mt-2 mb-1" />

            {mode === 'view' && contract ? (
              <ViewCard
                contract={contract} usage={usage} value={value}
                onPickType={pid => onChange({ ...value, processTypeId: pid })}
                onUpdate={() => setMode('form')}
                onClose={() => setOpen(false)}
              />
            ) : (
              <RateForm
                partyId={partyId!} base={contract}
                onCancel={() => (contract ? setMode('view') : setOpen(false))}
                onSaved={afterSave}
              />
            )}
          </div>
        </div>
      )}
    </>
  )
}

// ── View card ─────────────────────────────────────────────────────────────
function ViewCard({
  contract, usage, value, onPickType, onUpdate, onClose,
}: {
  contract: Contract; usage: Usage | null; value: ProcessRateValue
  onPickType: (id: number | null) => void; onUpdate: () => void; onClose: () => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between bg-emerald-50 border-b border-emerald-100 px-4 py-3 rounded-t-2xl">
        <span className="text-sm font-bold text-emerald-800">Approved Process Rate</span>
        <span className="text-[10px] font-bold text-emerald-700 bg-white border border-emerald-200 rounded-full px-2 py-0.5">
          v{contract.version} · {contract.status}
        </span>
      </div>

      <div className="p-4 space-y-2.5">
        <p className="text-[11px] text-slate-500">
          Tap a process to mark which one this lot is booked for (optional).
        </p>
        {contract.lines.map(l => {
          const picked = value.processTypeId === l.processTypeId
          return (
            <button key={l.id} type="button"
              onClick={() => onPickType(picked ? null : l.processTypeId)}
              className={`w-full text-left border rounded-xl px-3 py-2.5 transition ${
                picked ? 'border-emerald-400 ring-1 ring-emerald-300 bg-emerald-50/40' : 'border-slate-200 hover:border-slate-300'
              }`}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[12.5px] font-bold text-slate-700">{l.processType.name}</span>
                <span className="text-[9px] uppercase tracking-wide text-slate-400">
                  {l.processType.rateMode === 'FLAT' ? 'flat' : 'by colour'} · /{l.unit}
                </span>
              </div>
              {l.processType.rateMode === 'FLAT' ? (
                <div className="text-[15px] font-extrabold text-slate-900">{inr(l.rate)} <span className="text-[10px] font-semibold text-slate-400">per {l.unit}</span></div>
              ) : (
                <div className="grid grid-cols-3 gap-1.5">
                  <Cat k="Light" v={l.rateLight} cls="text-yellow-600" />
                  <Cat k="Medium" v={l.rateMedium} cls="text-orange-600" />
                  <Cat k="Deep" v={l.rateDark} cls="text-violet-600" />
                </div>
              )}
              {picked && <div className="text-[10px] font-semibold text-emerald-700 mt-1.5">✓ this lot</div>}
            </button>
          )
        })}

        {/* Quantity validity progress bar */}
        {contract.validityQty != null && usage ? (() => {
          const cap = Number(contract.validityQty)
          const pct = cap > 0 ? Math.min(100, Math.round((usage.used / cap) * 100)) : 0
          const bar = usage.exceeded ? 'bg-rose-500' : pct >= 85 ? 'bg-amber-500' : 'bg-emerald-500'
          const txt = usage.exceeded ? 'text-rose-600' : 'text-emerald-600'
          return (
            <div>
              <div className="flex items-center justify-between text-[11px] mb-1 gap-2">
                <span className="text-slate-500">Quantity validity · since {fmtDate(contract.effectiveFrom)}</span>
                <span className={`font-bold whitespace-nowrap ${txt}`}>{nf(usage.used)} {usage.validityUnit} / {nf(cap)} {usage.validityUnit} · {pct}%</span>
              </div>
              <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                <div className={`h-full ${bar} transition-all`} style={{ width: `${pct}%` }} />
              </div>
              {!usage.kgTracked && <p className="text-[10px] text-amber-600 mt-1">kg cap approximated by than count</p>}
            </div>
          )
        })() : (
          <p className="text-[11px] text-slate-500">Effective {fmtDate(contract.effectiveFrom)}{contract.validityQty == null ? ' · no quantity cap' : ''}</p>
        )}

        {/* Notes */}
        {contract.notes && (
          <div className="flex gap-2 items-start text-[12px] text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
            <span>📝</span><span>{contract.notes}</span>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onUpdate}
            className="flex-1 py-2.5 rounded-xl text-[12px] font-bold text-indigo-600 bg-white border border-indigo-200 hover:bg-indigo-50">
            ✎ Update Rates
          </button>
          <button type="button" onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-[12px] font-bold text-white bg-emerald-600 hover:bg-emerald-700">
            Done ✓
          </button>
        </div>
      </div>
    </div>
  )
}

function Cat({ k, v, cls }: { k: string; v: string | null; cls: string }) {
  return (
    <div className="text-center border border-slate-100 rounded-lg py-1.5">
      <div className={`text-[9px] uppercase tracking-wide font-semibold ${cls}`}>{k}</div>
      <div className="text-[13px] font-extrabold text-slate-900 mt-0.5">{inr(v)}</div>
    </div>
  )
}

// ── Add / Update form ───────────────────────────────────────────────────────
interface DraftLine { processTypeId: number; rateMode: string; unit: string; rate: string; rateLight: string; rateMedium: string; rateDark: string }

function RateForm({
  partyId, base, onCancel, onSaved,
}: {
  partyId: number; base: Contract | null
  onCancel: () => void; onSaved: (newContractId: number) => void
}) {
  const [types, setTypes] = useState<ProcessType[]>([])
  const [effectiveFrom, setEffectiveFrom] = useState(today())
  const [validityQty, setValidityQty] = useState(base?.validityQty ?? '')
  const [validityUnit, setValidityUnit] = useState(base?.validityUnit ?? 'than')
  const [notes, setNotes] = useState(base?.notes ?? '')
  const [lines, setLines] = useState<DraftLine[]>([])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    fetch('/api/process-rates/types').then(r => r.json()).then((t: ProcessType[]) => {
      setTypes(t)
      // Prefill from the contract being updated, else start with one blank line.
      if (base?.lines.length) {
        setLines(base.lines.map(l => ({
          processTypeId: l.processTypeId, rateMode: l.processType.rateMode, unit: l.unit,
          rate: l.rate ?? '', rateLight: l.rateLight ?? '', rateMedium: l.rateMedium ?? '', rateDark: l.rateDark ?? '',
        })))
      }
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const available = types.filter(t => !lines.some(l => l.processTypeId === t.id))

  function addLine(typeId: number) {
    const t = types.find(x => x.id === typeId); if (!t) return
    setLines(prev => [...prev, { processTypeId: t.id, rateMode: t.rateMode, unit: 'kg', rate: '', rateLight: '', rateMedium: '', rateDark: '' }])
  }
  const setLine = (i: number, patch: Partial<DraftLine>) =>
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, ...patch } : l))
  const removeLine = (i: number) => setLines(prev => prev.filter((_, idx) => idx !== i))

  async function save() {
    if (!lines.length) { setErr('Add at least one rate line'); return }
    setSaving(true); setErr('')
    const res = await fetch('/api/process-rates', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        partyId, effectiveFrom,
        validityQty: validityQty.trim() || null,
        validityUnit: validityQty.trim() ? validityUnit : null,
        notes: notes.trim() || null,
        lines: lines.map(l => ({
          processTypeId: l.processTypeId, unit: l.unit,
          rate: l.rateMode === 'FLAT' ? l.rate : null,
          rateLight: l.rateMode === 'BY_COLOR_CATEGORY' ? l.rateLight : null,
          rateMedium: l.rateMode === 'BY_COLOR_CATEGORY' ? l.rateMedium : null,
          rateDark: l.rateMode === 'BY_COLOR_CATEGORY' ? l.rateDark : null,
        })),
      }),
    })
    const d = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) { setErr(d.error ?? 'Failed to save'); return }
    onSaved(d.id)
  }

  const nameOf = (id: number) => types.find(t => t.id === id)?.name ?? `#${id}`

  return (
    <div>
      <div className="flex items-center justify-between bg-indigo-50 border-b border-indigo-100 px-4 py-3 rounded-t-2xl">
        <span className="text-sm font-bold text-indigo-800">{base ? 'Update Process Rate' : 'Add Process Rate'}</span>
        {base && <span className="text-[10px] font-semibold text-indigo-600">new version → supersedes v{base.version}</span>}
      </div>

      <div className="p-4 space-y-3">
        {err && <div className="text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</div>}

        <div className="grid grid-cols-3 gap-2">
          <label className="col-span-1 text-[11px] font-semibold text-slate-600">
            Effective from
            <input type="date" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} className={inp} />
          </label>
          <label className="col-span-1 text-[11px] font-semibold text-slate-600">
            Valid till qty <span className="text-slate-400 font-normal">(opt)</span>
            <input type="number" value={validityQty} onChange={e => setValidityQty(e.target.value)} placeholder="—" className={inp} />
          </label>
          <label className="col-span-1 text-[11px] font-semibold text-slate-600">
            Unit
            <select value={validityUnit} onChange={e => setValidityUnit(e.target.value)} className={inp}>
              <option value="than">than</option><option value="mtr">mtr</option><option value="kg">kg</option>
            </select>
          </label>
        </div>

        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={l.processTypeId} className="border border-slate-200 rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[12.5px] font-bold text-slate-700">{nameOf(l.processTypeId)}</span>
                <div className="flex items-center gap-2">
                  <select value={l.unit} onChange={e => setLine(i, { unit: e.target.value })}
                    className="text-[11px] border border-slate-300 rounded px-1.5 py-0.5">
                    <option value="kg">/kg</option><option value="mtr">/mtr</option><option value="than">/than</option>
                  </select>
                  <button type="button" onClick={() => removeLine(i)} className="text-rose-500 text-[11px] hover:underline">remove</button>
                </div>
              </div>
              {l.rateMode === 'FLAT' ? (
                <input type="number" step="0.01" value={l.rate} onChange={e => setLine(i, { rate: e.target.value })}
                  placeholder="Rate" className={inp} />
              ) : (
                <div className="grid grid-cols-3 gap-1.5">
                  <input type="number" step="0.01" value={l.rateLight} onChange={e => setLine(i, { rateLight: e.target.value })} placeholder="Light" className={inp} />
                  <input type="number" step="0.01" value={l.rateMedium} onChange={e => setLine(i, { rateMedium: e.target.value })} placeholder="Medium" className={inp} />
                  <input type="number" step="0.01" value={l.rateDark} onChange={e => setLine(i, { rateDark: e.target.value })} placeholder="Deep" className={inp} />
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

        <label className="block text-[11px] font-semibold text-slate-600">
          Notes <span className="text-slate-400 font-normal">(opt)</span>
          <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. confirmed on call by Rahul" className={inp} />
        </label>

        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl text-[12px] font-bold text-slate-600 bg-white border border-slate-300 hover:bg-slate-50">
            Cancel
          </button>
          <button type="button" onClick={save} disabled={saving}
            className="flex-1 py-2.5 rounded-xl text-[12px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60">
            {saving ? 'Saving…' : base ? 'Save new version' : 'Save rate'}
          </button>
        </div>
      </div>
    </div>
  )
}

const inp = 'mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-400'
