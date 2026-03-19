'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import ComboSelect from '@/components/ComboSelect'

interface Option { id: number; name: string }
interface Masters { parties: Option[]; qualities: Option[]; transports: Option[] }

export default function DespatchForm() {
  const router = useRouter()
  const [masters, setMasters] = useState<Masters>({ parties: [], qualities: [], transports: [] })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [lotLookup, setLotLookup] = useState<'idle' | 'loading' | 'found' | 'not_found'>('idle')

  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0],
    challanNo: '', partyId: null as number | null, qualityId: null as number | null,
    grayInwDate: '', lotNo: '', jobDelivery: '', than: '',
    billNo: '', rate: '', lrNo: '', transportId: null as number | null, bale: '',
  })

  const pTotal = form.than && form.rate
    ? (parseFloat(form.than) * parseFloat(form.rate)).toFixed(2)
    : ''

  useEffect(() => {
    const load = (type: string) => fetch(`/api/masters/${type}`).then(r => r.json())
    Promise.all([load('parties'), load('qualities'), load('transports')]).then(
      ([parties, qualities, transports]) => setMasters({ parties, qualities, transports })
    )
  }, [])

  async function handleLotBlur() {
    if (!form.lotNo.trim()) return
    setLotLookup('loading')
    const res = await fetch(`/api/grey/lookup?lotNo=${encodeURIComponent(form.lotNo.trim())}`)
    const data = await res.json()
    if (data.date) {
      setForm(prev => ({ ...prev, grayInwDate: new Date(data.date).toISOString().split('T')[0] }))
      setLotLookup('found')
    } else {
      setLotLookup('not_found')
    }
  }

  async function addMaster(type: string, name: string): Promise<Option> {
    const res = await fetch(`/api/masters/${type}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const item = await res.json()
    setMasters(prev => ({ ...prev, [type]: [...prev[type as keyof Masters], item].sort((a, b) => a.name.localeCompare(b.name)) }))
    return item
  }

  const set = (field: string, value: any) => setForm(prev => ({ ...prev, [field]: value }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.partyId || !form.qualityId) { setError('Please fill Party and Quality.'); return }
    setSaving(true); setError('')
    const res = await fetch('/api/despatch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, pTotal }),
    })
    if (res.ok) {
      router.push('/despatch')
    } else {
      const d = await res.json().catch(() => ({}))
      setError(d.error ?? 'Failed to save')
      setSaving(false)
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl">
      <div className="flex items-center gap-4 mb-8">
        <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-800 text-sm">← Back</button>
        <h1 className="text-2xl font-bold text-gray-800">New Despatch Entry</h1>
      </div>
      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-6 text-sm">{error}</div>}
      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Date *"><input type="date" className={inp} value={form.date} onChange={e => set('date', e.target.value)} required /></Field>
          <Field label="Challan No *"><input type="number" className={inp} value={form.challanNo} onChange={e => set('challanNo', e.target.value)} required /></Field>
          <Field label="A-Job Party *"><ComboSelect options={masters.parties} value={form.partyId} onChange={id => set('partyId', id)} onAddNew={n => addMaster('parties', n)} placeholder="Select party..." /></Field>
          <Field label="A/Quality *"><ComboSelect options={masters.qualities} value={form.qualityId} onChange={id => set('qualityId', id)} onAddNew={n => addMaster('qualities', n)} placeholder="Select quality..." /></Field>
          <Field label="A-Lot No *">
            <input type="text" className={inp} value={form.lotNo}
              onChange={e => { set('lotNo', e.target.value); setLotLookup('idle') }}
              onBlur={handleLotBlur} required placeholder="e.g. PS-689" />
            {lotLookup === 'loading' && <p className="text-xs text-gray-400 mt-0.5">Looking up grey date...</p>}
            {lotLookup === 'found' && <p className="text-xs text-green-600 mt-0.5">✓ Grey date auto-filled</p>}
            {lotLookup === 'not_found' && <p className="text-xs text-amber-500 mt-0.5">Lot not in grey register</p>}
          </Field>
          <Field label="Gray Inw Date"><input type="date" className={inp} value={form.grayInwDate} onChange={e => set('grayInwDate', e.target.value)} /></Field>
          <Field label="Job Delivery"><input type="text" className={inp} value={form.jobDelivery} onChange={e => set('jobDelivery', e.target.value)} /></Field>
          <Field label="Than *"><input type="number" className={inp} value={form.than} onChange={e => set('than', e.target.value)} required /></Field>
          <Field label="Bill No"><input type="text" className={inp} value={form.billNo} onChange={e => set('billNo', e.target.value)} /></Field>
          <Field label="Rate"><input type="number" step="0.01" className={inp} value={form.rate} onChange={e => set('rate', e.target.value)} /></Field>
          <Field label="P.Total (auto)"><input type="text" className={`${inp} bg-gray-50 text-gray-600`} value={pTotal} readOnly placeholder="= Than × Rate" /></Field>
          <Field label="LR No"><input type="text" className={inp} value={form.lrNo} onChange={e => set('lrNo', e.target.value)} /></Field>
          <Field label="Transport"><ComboSelect options={masters.transports} value={form.transportId} onChange={id => set('transportId', id)} onAddNew={n => addMaster('transports', n)} placeholder="Select transport..." /></Field>
          <Field label="Bale"><input type="number" className={inp} value={form.bale} onChange={e => set('bale', e.target.value)} /></Field>
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
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>{children}</div>
}
