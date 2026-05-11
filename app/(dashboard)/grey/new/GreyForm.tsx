'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import ComboSelect from '@/components/ComboSelect'

interface Option { id: number; name: string; tag?: string | null; lotPrefixes?: string[] | null }
interface Masters { parties: Option[]; qualities: Option[]; weavers: Option[]; transports: Option[] }

export default function GreyForm() {
  const router = useRouter()
  const [masters, setMasters] = useState<Masters>({ parties: [], qualities: [], weavers: [], transports: [] })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    sn: '', date: new Date().toISOString().split('T')[0], challanNo: '',
    partyId: null as number | null, qualityId: null as number | null,
    weight: '', than: '', grayMtr: '',
    transportId: null as number | null, transportLrNo: '',
    bale: '', baleNo: '', echBaleThan: '',
    weaverId: null as number | null, viverNameBill: '',
    lrNo: '', lotNo: '', marka: '',
  })

  useEffect(() => {
    const load = async (type: string) => {
      const res = await fetch(`/api/masters/${type}`)
      return res.json()
    }
    Promise.all([load('parties'), load('qualities'), load('weavers'), load('transports')]).then(
      ([parties, qualities, weavers, transports]) =>
        setMasters({ parties, qualities, weavers, transports })
    )
  }, [])

  // Pre-fill SN with max(SN)+1 so the operator sees the next inward number
  // ready to confirm — no more typing or relying on the silent "Auto" path.
  // They can still overwrite if they need to insert a missed row in between.
  useEffect(() => {
    fetch('/api/grey/next-sn').then(r => r.ok ? r.json() : null).then(d => {
      if (d?.next) setForm(prev => prev.sn ? prev : { ...prev, sn: String(d.next) })
    }).catch(() => {})
  }, [])

  // Auto-fill A-Lot No from selected party's prefix + SN. The operator can
  // pick any of the party's saved prefixes (PS / PSRG / PSPC) via the chip
  // row, or override the field entirely (then auto-fill stops). State:
  //   selectedPrefix: which chip is active (defaults to the party's first
  //                   prefix when party changes).
  //   lotNoTouched:   true once the operator types something that isn't the
  //                   current auto-template — we stop overwriting their work.
  const [selectedPrefix, setSelectedPrefix] = useState<string | null>(null)
  const [lotNoTouched, setLotNoTouched] = useState(false)
  const selectedParty = masters.parties.find(p => p.id === form.partyId) || null
  const partyPrefixes = selectedParty?.lotPrefixes ?? []

  // When party changes, reset the active prefix to the party's default and
  // re-enable auto-fill (operator effectively starts a fresh row context).
  useEffect(() => {
    setSelectedPrefix(partyPrefixes[0] || null)
    setLotNoTouched(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.partyId])

  // Recompute lotNo whenever (party, prefix, sn) changes — but only if the
  // operator hasn't typed something custom.
  useEffect(() => {
    if (lotNoTouched) return
    if (!selectedPrefix) return
    if (!form.sn) return
    const computed = `${selectedPrefix}-${form.sn}`
    if (computed !== form.lotNo) setForm(prev => ({ ...prev, lotNo: computed }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPrefix, form.sn, lotNoTouched])

  function pickPrefix(p: string) {
    setSelectedPrefix(p)
    setLotNoTouched(false)  // re-enable auto-fill so the chip click takes effect
  }
  function resetLotAuto() {
    setLotNoTouched(false)
    if (selectedPrefix && form.sn) {
      setForm(prev => ({ ...prev, lotNo: `${selectedPrefix}-${form.sn}` }))
    }
  }

  async function addMaster(type: string, name: string): Promise<Option> {
    // Pass force=true so the masters API doesn't return its "did you mean…?"
    // 200 needsConfirm shape — auto-create on a fast data-entry path means
    // the operator already decided to create a new one. Exact duplicates
    // still come back as 409 with existingId.
    const res = await fetch(`/api/masters/${type}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, force: true }),
    })
    const data = await res.json().catch(() => ({}))
    // 409 → exact match exists; reuse it instead of crashing the UI.
    if (res.status === 409 && data.existingId) {
      const existing = (masters[type as keyof Masters] as Option[]).find(o => o.id === data.existingId)
      if (existing) return existing
      // Existing not in our cached list — fetch fresh and add.
      const fresh = await fetch(`/api/masters/${type}`).then(r => r.json()).catch(() => [])
      setMasters(prev => ({ ...prev, [type]: fresh }))
      return fresh.find((o: Option) => o.id === data.existingId) || { id: data.existingId, name }
    }
    if (!res.ok || !data?.id || !data?.name) {
      throw new Error(data?.error || `Failed to add ${type.slice(0, -1)}`)
    }
    setMasters(prev => ({ ...prev, [type]: [...prev[type as keyof Masters], data].sort((a, b) => a.name.localeCompare(b.name)) }))
    return data
  }

  const set = (field: string, value: any) => setForm((prev) => ({ ...prev, [field]: value }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.partyId || !form.qualityId || !form.transportId) {
      setError('Please fill Party, Quality, and Transport.')
      return
    }
    if (!form.date || !form.challanNo || !form.than || !form.lotNo) {
      setError('Date, Challan No, Than, and Lot No are required.')
      return
    }
    setSaving(true); setError('')
    const res = await fetch('/api/grey', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    if (res.ok) {
      router.push('/grey')
    } else {
      const d = await res.json()
      setError(d.error ?? 'Failed to save')
      setSaving(false)
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl">
      <div className="flex items-center gap-4 mb-8">
        <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-800 text-sm">← Back</button>
        <h1 className="text-2xl font-bold text-gray-800">New Grey Inward Entry</h1>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-6 text-sm">{error}</div>}

      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

          <Field label="SN">
            <input type="number" className={inp} value={form.sn} onChange={e => set('sn', e.target.value)} placeholder="Loading…" />
          </Field>
          <Field label="Date *">
            <input type="date" className={inp} value={form.date} onChange={e => set('date', e.target.value)} required />
          </Field>
          <Field label="Challan No *">
            <input type="number" className={inp} value={form.challanNo} onChange={e => set('challanNo', e.target.value)} required />
          </Field>

          <Field label="A-Party Name *">
            <ComboSelect options={masters.parties} value={form.partyId} onChange={id => set('partyId', id)} onAddNew={n => addMaster('parties', n)} placeholder="Select party..." />
          </Field>
          <Field label="A-Quality *">
            <ComboSelect options={masters.qualities} value={form.qualityId} onChange={id => set('qualityId', id)} onAddNew={n => addMaster('qualities', n)} placeholder="Select quality..." />
          </Field>
          <Field label="Weight">
            <input type="text" className={inp} value={form.weight} onChange={e => set('weight', e.target.value)} placeholder="e.g. 106g" />
          </Field>

          <Field label="Than *">
            <input type="number" className={inp} value={form.than} onChange={e => set('than', e.target.value)} required />
          </Field>
          <Field label="Gray Mtr">
            <input type="number" step="0.01" className={inp} value={form.grayMtr} onChange={e => set('grayMtr', e.target.value)} />
          </Field>
          <Field label="A-Lot No *">
            <div className="space-y-1">
              <input type="text" className={inp} value={form.lotNo}
                onChange={e => {
                  const v = e.target.value
                  set('lotNo', v)
                  // Touched only when the typed value diverges from the
                  // current auto-template. Backspacing back to the template
                  // (or empty) re-enables auto-fill.
                  const auto = selectedPrefix && form.sn ? `${selectedPrefix}-${form.sn}` : ''
                  setLotNoTouched(v.length > 0 && v !== auto)
                }}
                required />
              {partyPrefixes.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap">
                  <span className="text-[9px] uppercase tracking-wide text-gray-400">Prefix</span>
                  {partyPrefixes.map(p => (
                    <button key={p} type="button" onClick={() => pickPrefix(p)}
                      className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border transition ${
                        p === selectedPrefix
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'
                      }`}>
                      {p}
                    </button>
                  ))}
                  {lotNoTouched && (
                    <button type="button" onClick={resetLotAuto}
                      className="text-[10px] text-indigo-600 dark:text-indigo-400 underline ml-1">
                      ↺ Auto
                    </button>
                  )}
                </div>
              )}
            </div>
          </Field>

          {masters.parties.find(p => p.id === form.partyId)?.tag === 'Pali PC Job' && (
            <Field label="Marka">
              <input type="text" className={inp} value={form.marka} onChange={e => set('marka', e.target.value)} placeholder="Enter marka..." />
            </Field>
          )}

          <Field label="Transport *">
            <ComboSelect options={masters.transports} value={form.transportId} onChange={id => set('transportId', id)} onAddNew={n => addMaster('transports', n)} placeholder="Select transport..." />
          </Field>
          <Field label="LR No">
            <input type="text" className={inp} value={form.transportLrNo} onChange={e => set('transportLrNo', e.target.value)} />
          </Field>

          <Field label="Bale">
            <input type="number" className={inp} value={form.bale} onChange={e => set('bale', e.target.value)} />
          </Field>
          <Field label="Bale No">
            <input type="text" className={inp} value={form.baleNo} onChange={e => set('baleNo', e.target.value)} placeholder="e.g. 4160 to 4169" />
          </Field>
          <Field label="Ech Bale Than">
            <input type="number" step="0.01" className={inp} value={form.echBaleThan} onChange={e => set('echBaleThan', e.target.value)} />
          </Field>

          <Field label="Grey Weaver">
            <ComboSelect options={masters.weavers} value={form.weaverId} onChange={id => set('weaverId', id)}
              onAddNew={n => addMaster('weavers', n)} autoCreateOnBlur
              placeholder="Type weaver name (auto-creates if new)" />
          </Field>
          <Field label="Viver Name-Bill" span={2}>
            <input type="text" className={inp} value={form.viverNameBill} onChange={e => set('viverNameBill', e.target.value)} placeholder="e.g. Manju Industries Bn 16 149522" />
          </Field>

        </div>

        <div className="mt-6 flex gap-3 justify-end">
          <button type="button" onClick={() => router.back()} className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
          <button type="submit" disabled={saving} className="px-6 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-60">
            {saving ? 'Saving...' : 'Save Entry'}
          </button>
        </div>
      </form>
    </div>
  )
}

const inp = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400'

function Field({ label, children, span = 1 }: { label: string; children: React.ReactNode; span?: number }) {
  return (
    <div className={span === 2 ? 'md:col-span-2' : ''}>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  )
}
