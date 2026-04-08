'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import ComboSelect from '@/components/ComboSelect'

interface Option { id: number; name: string }
interface Masters { parties: Option[]; qualities: Option[]; transports: Option[] }

interface LotRow {
  lotNo: string
  qualityId: number | null
  qualityName: string
  than: string
  meter: string
  rate: string
  amount: string
  description: string
  lookupStatus: 'idle' | 'loading' | 'found' | 'not_found' | 'no_stock'
  stock: number | null
}

const emptyRow = (): LotRow => ({
  lotNo: '', qualityId: null, qualityName: '', than: '', meter: '', rate: '', amount: '', description: '', lookupStatus: 'idle', stock: null,
})

export default function DespatchForm() {
  const router = useRouter()
  const [masters, setMasters] = useState<Masters>({ parties: [], qualities: [], transports: [] })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0],
    challanNo: '',
    partyId: null as number | null,
    partyName: '',
    transportId: null as number | null,
    lrNo: '',
    bale: '',
    billNo: '',
  })

  const [lotRows, setLotRows] = useState<LotRow[]>([emptyRow()])

  useEffect(() => {
    const load = (type: string) => fetch(`/api/masters/${type}`).then(r => r.json())
    Promise.all([load('parties'), load('qualities'), load('transports')]).then(
      ([parties, qualities, transports]) => setMasters({ parties, qualities, transports })
    )
  }, [])

  const calcAmount = (row: LotRow): string => {
    const r = parseFloat(row.rate)
    if (!r) return ''
    const t = parseInt(row.than)
    const m = parseFloat(row.meter)
    if (m) return (m * r).toFixed(2)
    if (t) return (t * r).toFixed(2)
    return ''
  }

  const updateRow = useCallback((idx: number, field: keyof LotRow, value: string) => {
    setLotRows(prev => {
      const rows = [...prev]
      const row = { ...rows[idx], [field]: value }
      if (field === 'than' || field === 'rate' || field === 'meter') {
        row.amount = calcAmount(row)
      }
      rows[idx] = row
      return rows
    })
  }, [])

  const removeRow = (idx: number) => {
    setLotRows(prev => prev.length <= 1 ? [emptyRow()] : prev.filter((_, i) => i !== idx))
  }

  const addRow = () => setLotRows(prev => [...prev, emptyRow()])

  const handleLotBlur = async (idx: number) => {
    const lotNo = lotRows[idx].lotNo.trim()
    if (!lotNo) return
    updateRow(idx, 'lookupStatus' as any, 'loading')
    try {
      const res = await fetch(`/api/grey/lookup?lotNo=${encodeURIComponent(lotNo)}`)
      const data = await res.json()
      setLotRows(prev => {
        const rows = [...prev]
        if (data.date) {
          const stock = data.stock ?? 0
          if (stock <= 0) {
            rows[idx] = { ...rows[idx], qualityId: data.qualityId, qualityName: data.qualityName || '', lookupStatus: 'no_stock', stock: 0 }
          } else {
            rows[idx] = { ...rows[idx], qualityId: data.qualityId, qualityName: data.qualityName || '', lookupStatus: 'found', stock }
          }
        } else {
          rows[idx] = { ...rows[idx], lookupStatus: 'not_found', stock: null }
        }
        return rows
      })
      // Auto-fill party from first lot
      if (data.partyId && !form.partyId) {
        setForm(prev => ({ ...prev, partyId: data.partyId, partyName: data.partyName || '' }))
      }
    } catch {
      setLotRows(prev => {
        const rows = [...prev]
        rows[idx] = { ...rows[idx], lookupStatus: 'not_found' }
        return rows
      })
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

  // Totals
  const totalThan = lotRows.reduce((s, r) => s + (parseInt(r.than) || 0), 0)
  const totalAmount = lotRows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const validLots = lotRows.filter(r => r.lotNo.trim() && r.than)
    if (!form.partyId) { setError('Please select a party.'); return }
    if (validLots.length === 0) { setError('Add at least one lot row with lot no and than.'); return }
    setSaving(true); setError('')
    const res = await fetch('/api/despatch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: form.date,
        challanNo: form.challanNo,
        partyId: form.partyId,
        transportId: form.transportId,
        lrNo: form.lrNo,
        bale: form.bale,
        billNo: form.billNo,
        lots: validLots.map(r => ({
          lotNo: r.lotNo.trim(),
          qualityId: r.qualityId,
          than: parseInt(r.than),
          meter: r.meter ? parseFloat(r.meter) : null,
          rate: r.rate ? parseFloat(r.rate) : null,
          amount: r.amount ? parseFloat(r.amount) : null,
          description: r.description || null,
        })),
      }),
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
        <button onClick={() => router.back()} className="text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 text-sm">← Back</button>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">New Despatch Entry</h1>
      </div>
      {error && <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 rounded-lg px-4 py-3 mb-6 text-sm">{error}</div>}
      <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6">
        {/* Header fields */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Field label="Date *"><input type="date" className={inp} value={form.date} onChange={e => set('date', e.target.value)} required /></Field>
          <Field label="Challan No *"><input type="number" className={inp} value={form.challanNo} onChange={e => set('challanNo', e.target.value)} required /></Field>
          <Field label="Party">
            <ComboSelect options={masters.parties} value={form.partyId} onChange={id => set('partyId', id)} onAddNew={n => addMaster('parties', n)} placeholder={form.partyName || 'Auto from lot lookup...'} />
          </Field>
          <Field label="Transport"><ComboSelect options={masters.transports} value={form.transportId} onChange={id => set('transportId', id)} onAddNew={n => addMaster('transports', n)} placeholder="Select transport..." /></Field>
          <Field label="LR No"><input type="text" className={inp} value={form.lrNo} onChange={e => set('lrNo', e.target.value)} /></Field>
          <Field label="Bale"><input type="number" className={inp} value={form.bale} onChange={e => set('bale', e.target.value)} /></Field>
          <Field label="Bill No"><input type="text" className={inp} value={form.billNo} onChange={e => set('billNo', e.target.value)} /></Field>
        </div>

        {/* Lot rows */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Lot Rows</h2>
          <button type="button" onClick={addRow} className="text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-medium">+ Add Lot Row</button>
        </div>

        <div className="overflow-x-auto -mx-6 px-6">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-600">
                <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase py-2 px-2 w-32">Lot No</th>
                <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase py-2 px-2 w-28">Quality</th>
                <th className="text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase py-2 px-2 w-24">Than</th>
                <th className="text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase py-2 px-2 w-24">Mtr</th>
                <th className="text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase py-2 px-2 w-24">Rate</th>
                <th className="text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase py-2 px-2 w-24">Amount</th>
                <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase py-2 px-2">Description</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {lotRows.map((row, idx) => (
                <tr key={idx} className="border-b border-gray-100 dark:border-gray-700">
                  <td className="py-2 px-2">
                    <input
                      type="text"
                      className={inp}
                      value={row.lotNo}
                      onChange={e => updateRow(idx, 'lotNo', e.target.value)}
                      onBlur={() => handleLotBlur(idx)}
                      placeholder="e.g. PS-689"
                    />
                    {row.lookupStatus === 'loading' && <p className="text-[10px] text-gray-400 mt-0.5">Looking up...</p>}
                    {row.lookupStatus === 'found' && <p className="text-[10px] text-green-600 dark:text-green-400 mt-0.5">✓ Stock: {row.stock} than</p>}
                    {row.lookupStatus === 'no_stock' && <p className="text-[10px] text-red-500 mt-0.5">❌ Not available (0 stock)</p>}
                    {row.lookupStatus === 'not_found' && <p className="text-[10px] text-amber-500 mt-0.5">⚠️ Lot not found</p>}
                  </td>
                  <td className="py-2 px-2">
                    <span className="text-xs text-gray-600 dark:text-gray-400">{row.qualityName || '—'}</span>
                  </td>
                  <td className="py-2 px-2">
                    <input type="number" className={`${inp} text-right`} value={row.than} onChange={e => updateRow(idx, 'than', e.target.value)} placeholder="0" />
                  </td>
                  <td className="py-2 px-2">
                    <input type="number" step="0.01" className={`${inp} text-right`} value={row.meter} onChange={e => updateRow(idx, 'meter', e.target.value)} placeholder="—" />
                  </td>
                  <td className="py-2 px-2">
                    <input type="number" step="0.01" className={`${inp} text-right`} value={row.rate} onChange={e => updateRow(idx, 'rate', e.target.value)} placeholder="—" />
                  </td>
                  <td className="py-2 px-2">
                    <input type="text" className={`${inp} text-right bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-400`} value={row.amount} readOnly placeholder="auto" />
                  </td>
                  <td className="py-2 px-2">
                    <input type="text" className={inp} value={row.description} onChange={e => updateRow(idx, 'description', e.target.value)} placeholder="e.g. Black Color" />
                  </td>
                  <td className="py-2 px-2 text-center">
                    <button type="button" onClick={() => removeRow(idx)} className="text-red-400 hover:text-red-600 dark:text-red-500 dark:hover:text-red-400 text-lg leading-none" title="Remove row">&times;</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="mt-3 flex flex-wrap gap-4 text-sm text-gray-600 dark:text-gray-400 border-t border-gray-100 dark:border-gray-700 pt-3">
          <span>Total: <strong className="text-gray-800 dark:text-gray-200">{lotRows.filter(r => r.lotNo.trim()).length} rows</strong></span>
          <span className="text-gray-300 dark:text-gray-600">|</span>
          <span><strong className="text-gray-800 dark:text-gray-200">{totalThan}</strong> than</span>
          {totalAmount > 0 && (
            <>
              <span className="text-gray-300 dark:text-gray-600">|</span>
              <span>Rs. <strong className="text-gray-800 dark:text-gray-200">{totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></span>
            </>
          )}
        </div>

        <div className="mt-6 flex gap-3 justify-end">
          <button type="button" onClick={() => router.back()} className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700">Cancel</button>
          <button type="submit" disabled={saving} className="px-6 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-60">
            {saving ? 'Saving...' : 'Save Entry'}
          </button>
        </div>
      </form>
    </div>
  )
}

const inp = 'w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-400'
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{label}</label>{children}</div>
}
