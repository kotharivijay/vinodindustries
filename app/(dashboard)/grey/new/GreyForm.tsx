'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import ComboSelect from '@/components/ComboSelect'

interface Option { id: number; name: string; tag?: string | null }
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

  async function addMaster(type: string, name: string): Promise<Option> {
    const res = await fetch(`/api/masters/${type}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const item = await res.json()
    setMasters((prev) => ({ ...prev, [type]: [...prev[type as keyof Masters], item].sort((a, b) => a.name.localeCompare(b.name)) }))
    return item
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
            <input type="text" className={inp} value={form.lotNo} onChange={e => set('lotNo', e.target.value)} required />
          </Field>

          {masters.parties.find(p => p.id === form.partyId)?.tag === 'Pali PC Job' && (
            <Field label="Marka">
              <input type="text" className={inp} value={form.marka} onChange={e => set('marka', e.target.value)} placeholder="Enter marka..." />
            </Field>
          )}

          <Field label="Transport *">
            <ComboSelect options={masters.transports} value={form.transportId} onChange={id => set('transportId', id)} onAddNew={n => addMaster('transports', n)} placeholder="Select transport..." />
          </Field>
          <Field label="Transport LR No">
            <input type="text" className={inp} value={form.transportLrNo} onChange={e => set('transportLrNo', e.target.value)} />
          </Field>
          <Field label="LR No">
            <input type="text" className={inp} value={form.lrNo} onChange={e => set('lrNo', e.target.value)} />
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
            <ComboSelect options={masters.weavers} value={form.weaverId} onChange={id => set('weaverId', id)} onAddNew={n => addMaster('weavers', n)} placeholder="Select weaver..." />
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
