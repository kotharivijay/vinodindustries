'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

type StockStatus = 'idle' | 'loading' | 'ok' | 'no_stock' | 'not_found'

export default function DyeingEditForm({ id }: { id: string }) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [originalLot, setOriginalLot] = useState('')
  const [stockStatus, setStockStatus] = useState<StockStatus>('idle')
  const [stockInfo, setStockInfo] = useState<{ stock: number; greyThan: number; despatchThan: number } | null>(null)

  const [form, setForm] = useState({ date: '', slipNo: '', lotNo: '', than: '' })

  useEffect(() => {
    fetch(`/api/dyeing/${id}`).then(r => r.json()).then(e => {
      const lot = e.lotNo
      setForm({
        date: new Date(e.date).toISOString().split('T')[0],
        slipNo: String(e.slipNo),
        lotNo: lot,
        than: String(e.than),
      })
      setOriginalLot(lot)
      setLoading(false)
    })
  }, [id])

  const set = (field: string, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }))
    if (field === 'lotNo') { setStockStatus('idle'); setStockInfo(null) }
  }

  async function handleLotBlur() {
    const lot = form.lotNo.trim()
    if (!lot || lot.toLowerCase() === originalLot.toLowerCase()) return // unchanged — skip check
    setStockStatus('loading')
    const res = await fetch(`/api/grey/stock?lotNo=${encodeURIComponent(lot)}`)
    const data = await res.json()
    if (!data.exists) {
      setStockStatus('not_found'); setStockInfo(null)
    } else if (data.stock <= 0) {
      setStockStatus('no_stock'); setStockInfo(data)
    } else {
      setStockStatus('ok'); setStockInfo(data)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (stockStatus === 'not_found') { setError('Lot not found in Grey register.'); return }
    setSaving(true); setError('')
    const res = await fetch(`/api/dyeing/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    if (res.ok) {
      router.push('/dyeing')
    } else {
      const d = await res.json().catch(() => ({}))
      setError(d.error ?? 'Failed to save')
      setSaving(false)
    }
  }

  if (loading) return <div className="p-8 text-gray-400">Loading...</div>

  return (
    <div className="p-4 md:p-8 max-w-xl">
      <div className="flex items-center gap-4 mb-8">
        <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-800 text-sm">← Back</button>
        <h1 className="text-2xl font-bold text-gray-800">Edit Dyeing Slip Entry</h1>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-6 text-sm">{error}</div>}

      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Date *">
            <input type="date" className={inp} value={form.date} onChange={e => set('date', e.target.value)} required />
          </Field>
          <Field label="Slip No *">
            <input type="number" className={inp} value={form.slipNo} onChange={e => set('slipNo', e.target.value)} required />
          </Field>

          <Field label="Lot No *" span={2}>
            <input
              type="text" className={inp} value={form.lotNo}
              onChange={e => set('lotNo', e.target.value)}
              onBlur={handleLotBlur}
              required
            />
            {stockStatus === 'loading' && <p className="text-xs text-gray-400 mt-1">Checking grey stock...</p>}
            {stockStatus === 'not_found' && <p className="text-xs text-red-500 mt-1">⚠ Lot not found in Grey register</p>}
            {stockStatus === 'no_stock' && stockInfo && (
              <p className="text-xs text-amber-600 mt-1">
                ⚠ No stock — Grey: {stockInfo.greyThan}, Despatched: {stockInfo.despatchThan}, Balance: <strong>{stockInfo.stock}</strong>
              </p>
            )}
            {stockStatus === 'ok' && stockInfo && (
              <p className="text-xs text-green-600 mt-1">
                ✓ Stock available — Grey: {stockInfo.greyThan}, Despatched: {stockInfo.despatchThan}, Balance: <strong>{stockInfo.stock}</strong>
              </p>
            )}
          </Field>

          <Field label="Than *">
            <input type="number" className={inp} value={form.than} onChange={e => set('than', e.target.value)} required />
          </Field>
        </div>

        <div className="mt-6 flex gap-3 justify-end">
          <button type="button" onClick={() => router.back()} className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
          <button type="submit" disabled={saving || stockStatus === 'not_found'} className="px-6 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-60">
            {saving ? 'Saving...' : 'Update Entry'}
          </button>
        </div>
      </form>
    </div>
  )
}

const inp = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400'
function Field({ label, children, span = 1 }: { label: string; children: React.ReactNode; span?: number }) {
  return (
    <div className={span === 2 ? 'sm:col-span-2' : ''}>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  )
}
