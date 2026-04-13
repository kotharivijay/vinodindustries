'use client'

import { useState, useMemo } from 'react'
import useSWR from 'swr'
import BackButton from '../../BackButton'

const fetcher = (url: string) => fetch(url).then(r => r.json())
const fmtINR = (n: number) => '₹' + n.toLocaleString('en-IN')

type SortField = 'name' | 'calculatedStock' | 'consumed' | 'purchased'
type Modal = null | 'add-item' | 'purchase' | 'opening' | 'physical' | 'adjustment'

export default function DyesAuxiliaryPage() {
  const { data, isLoading, mutate } = useSWR('/api/inventory?category=Dyes%20%26%20Auxiliary', fetcher, { revalidateOnFocus: false })
  const { data: chemicals = [] } = useSWR('/api/chemicals', fetcher, { revalidateOnFocus: false })

  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<{ field: SortField; dir: 'asc' | 'desc' }>({ field: 'name', dir: 'asc' })
  const [modal, setModal] = useState<Modal>(null)
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null)
  const [expandedItem, setExpandedItem] = useState<number | null>(null)

  // Form states
  const [formName, setFormName] = useState('')
  const [formUnit, setFormUnit] = useState('kg')
  const [formChemId, setFormChemId] = useState('')
  const [formMinStock, setFormMinStock] = useState('')
  const [formQty, setFormQty] = useState('')
  const [formRate, setFormRate] = useState('')
  const [formDate, setFormDate] = useState(new Date().toISOString().split('T')[0])
  const [formRef, setFormRef] = useState('')
  const [formNotes, setFormNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const items = useMemo(() => {
    if (!data?.items) return []
    const q = search.toLowerCase()
    let list = q ? data.items.filter((i: any) => i.name.toLowerCase().includes(q)) : data.items
    return [...list].sort((a: any, b: any) => {
      const va = sort.field === 'name' ? a.name.toLowerCase() : a[sort.field]
      const vb = sort.field === 'name' ? b.name.toLowerCase() : b[sort.field]
      return sort.dir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1)
    })
  }, [data, search, sort])

  function toggleSort(field: SortField) {
    setSort(prev => prev.field === field ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: field === 'name' ? 'asc' : 'desc' })
  }

  function resetForm() {
    setFormName(''); setFormUnit('kg'); setFormChemId(''); setFormMinStock('')
    setFormQty(''); setFormRate(''); setFormDate(new Date().toISOString().split('T')[0]); setFormRef(''); setFormNotes('')
    setModal(null); setSelectedItemId(null)
  }

  async function handleAddItem() {
    if (!formName.trim()) return
    setSaving(true)
    await fetch('/api/inventory', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add-item', categoryId: data?.categoryId, name: formName, unit: formUnit, chemicalId: formChemId || null, minStock: formMinStock || null }),
    })
    setSaving(false); resetForm(); mutate()
  }

  async function handleTransaction(type: string) {
    if (!selectedItemId || !formQty) return
    setSaving(true)
    await fetch('/api/inventory', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add-transaction', itemId: selectedItemId, type, quantity: formQty, rate: formRate || null, date: formDate, reference: formRef || null, notes: formNotes || null }),
    })
    setSaving(false); resetForm(); mutate()
  }

  async function handlePhysicalStock() {
    if (!selectedItemId || !formQty) return
    setSaving(true)
    await fetch('/api/inventory', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'physical-stock', itemId: selectedItemId, quantity: formQty, date: formDate, notes: formNotes || null }),
    })
    setSaving(false); resetForm(); mutate()
  }

  const totalStock = items.reduce((s: number, i: any) => s + Math.max(0, i.calculatedStock), 0)
  const totalPurchase = items.reduce((s: number, i: any) => s + i.totalPurchaseAmount, 0)
  const lowStockCount = items.filter((i: any) => i.isLowStock).length

  return (
    <div className="p-4 md:p-6 dark:text-gray-100">
      <div className="flex items-center gap-4 mb-5">
        <BackButton />
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Dyes & Auxiliary Inventory</h1>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-3 text-center">
          <p className="text-[10px] text-gray-500 uppercase">Items</p>
          <p className="text-xl font-bold text-gray-800 dark:text-gray-100">{items.length}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-3 text-center">
          <p className="text-[10px] text-gray-500 uppercase">Total Purchase</p>
          <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{fmtINR(totalPurchase)}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-3 text-center">
          <p className="text-[10px] text-gray-500 uppercase">Stock Items</p>
          <p className="text-xl font-bold text-purple-600 dark:text-purple-400">{Math.round(totalStock)}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-3 text-center">
          <p className="text-[10px] text-gray-500 uppercase">Low Stock</p>
          <p className={`text-xl font-bold ${lowStockCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>{lowStockCount}</p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <button onClick={() => setModal('add-item')} className="text-xs bg-purple-600 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-purple-700">+ Add Item</button>
        <button onClick={() => setModal('purchase')} className="text-xs bg-emerald-600 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-emerald-700">+ Purchase</button>
        <button onClick={() => setModal('opening')} className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-blue-700">+ Opening Stock</button>
        <button onClick={() => setModal('physical')} className="text-xs bg-amber-600 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-amber-700">+ Physical Stock</button>
      </div>

      {/* Search + Sort */}
      <input type="text" placeholder="🔍 Search item..." value={search} onChange={e => setSearch(e.target.value)}
        className="w-full mb-3 border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-400" />

      {isLoading ? <div className="p-12 text-center text-gray-400">Loading...</div> : (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                <th className="text-left px-3 py-2 cursor-pointer hover:text-purple-600" onClick={() => toggleSort('name')}>Item {sort.field === 'name' ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}</th>
                <th className="text-right px-3 py-2">Opening</th>
                <th className="text-right px-3 py-2 cursor-pointer hover:text-purple-600" onClick={() => toggleSort('purchased')}>Purchased {sort.field === 'purchased' ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}</th>
                <th className="text-right px-3 py-2 cursor-pointer hover:text-purple-600" onClick={() => toggleSort('consumed')}>Consumed {sort.field === 'consumed' ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}</th>
                <th className="text-right px-3 py-2 cursor-pointer hover:text-purple-600" onClick={() => toggleSort('calculatedStock')}>Stock {sort.field === 'calculatedStock' ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}</th>
                <th className="text-right px-3 py-2">Physical</th>
                <th className="text-right px-3 py-2">Variance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
              {items.map((item: any) => (
                <tr key={item.id} className={`cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/40 ${item.isLowStock ? 'bg-red-50/50 dark:bg-red-900/10' : ''}`}
                  onClick={() => setExpandedItem(expandedItem === item.id ? null : item.id)}>
                  <td className="px-3 py-2 font-medium text-gray-700 dark:text-gray-200">
                    {item.name}
                    <span className="text-[9px] text-gray-400 ml-1">{item.unit}</span>
                    {item.isLowStock && <span className="text-[9px] text-red-500 ml-1">⚠️ Low</span>}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-500">{item.openingStock || '-'}</td>
                  <td className="px-3 py-2 text-right text-emerald-600 dark:text-emerald-400">{item.purchased || '-'}</td>
                  <td className="px-3 py-2 text-right text-amber-600 dark:text-amber-400">{item.consumed || '-'}</td>
                  <td className="px-3 py-2 text-right font-bold text-purple-600 dark:text-purple-400">{item.calculatedStock}</td>
                  <td className="px-3 py-2 text-right text-gray-500">{item.physicalStock ?? '-'}</td>
                  <td className={`px-3 py-2 text-right font-medium ${item.variance == null ? 'text-gray-300' : item.variance > 0 ? 'text-red-500' : item.variance < 0 ? 'text-amber-500' : 'text-green-500'}`}>
                    {item.variance != null ? (item.variance > 0 ? '+' : '') + item.variance : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {items.length === 0 && <div className="p-8 text-center text-gray-400 text-sm">No items yet. Click + Add Item to start.</div>}
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => resetForm()}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">
                {modal === 'add-item' ? 'Add New Item' : modal === 'purchase' ? 'Record Purchase' : modal === 'opening' ? 'Set Opening Stock' : modal === 'physical' ? 'Record Physical Stock' : 'Adjustment'}
              </h2>
              <button onClick={resetForm} className="text-gray-400 text-xl">&times;</button>
            </div>

            {modal === 'add-item' ? (
              <>
                <div>
                  <label className="block text-[10px] text-gray-500 mb-0.5">Item Name</label>
                  <input value={formName} onChange={e => setFormName(e.target.value)} placeholder="e.g. Red Dye RR"
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-0.5">Unit</label>
                    <select value={formUnit} onChange={e => setFormUnit(e.target.value)}
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100">
                      <option value="kg">kg</option><option value="ltr">ltr</option><option value="gm">gm</option><option value="ml">ml</option><option value="pcs">pcs</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-0.5">Min Stock (alert)</label>
                    <input type="number" value={formMinStock} onChange={e => setFormMinStock(e.target.value)} placeholder="Optional"
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100" />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] text-gray-500 mb-0.5">Link to Chemical Master (optional)</label>
                  <select value={formChemId} onChange={e => setFormChemId(e.target.value)}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100">
                    <option value="">None</option>
                    {chemicals.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <button onClick={handleAddItem} disabled={saving} className="w-full bg-purple-600 text-white py-2.5 rounded-lg text-sm font-bold hover:bg-purple-700 disabled:opacity-50">
                  {saving ? 'Saving...' : 'Add Item'}
                </button>
              </>
            ) : (
              <>
                <div>
                  <label className="block text-[10px] text-gray-500 mb-0.5">Select Item</label>
                  <select value={selectedItemId || ''} onChange={e => setSelectedItemId(parseInt(e.target.value) || null)}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100">
                    <option value="">Choose item...</option>
                    {(data?.items || []).map((i: any) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-0.5">Quantity</label>
                    <input type="number" step="0.001" value={formQty} onChange={e => setFormQty(e.target.value)}
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-0.5">Date</label>
                    <input type="date" value={formDate} onChange={e => setFormDate(e.target.value)}
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100" />
                  </div>
                </div>
                {modal === 'purchase' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] text-gray-500 mb-0.5">Rate (per unit)</label>
                      <input type="number" step="0.01" value={formRate} onChange={e => setFormRate(e.target.value)}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100" />
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-500 mb-0.5">Invoice / Ref No</label>
                      <input value={formRef} onChange={e => setFormRef(e.target.value)}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100" />
                    </div>
                  </div>
                )}
                <div>
                  <label className="block text-[10px] text-gray-500 mb-0.5">Notes</label>
                  <input value={formNotes} onChange={e => setFormNotes(e.target.value)} placeholder="Optional"
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100" />
                </div>
                <button
                  onClick={() => modal === 'physical' ? handlePhysicalStock() : handleTransaction(modal === 'purchase' ? 'purchase' : modal === 'opening' ? 'opening' : 'adjustment')}
                  disabled={saving || !selectedItemId || !formQty}
                  className={`w-full py-2.5 rounded-lg text-sm font-bold disabled:opacity-50 text-white ${
                    modal === 'purchase' ? 'bg-emerald-600 hover:bg-emerald-700' :
                    modal === 'opening' ? 'bg-blue-600 hover:bg-blue-700' :
                    modal === 'physical' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-gray-600 hover:bg-gray-700'
                  }`}>
                  {saving ? 'Saving...' : modal === 'purchase' ? 'Record Purchase' : modal === 'opening' ? 'Set Opening Stock' : modal === 'physical' ? 'Record Physical Stock' : 'Save Adjustment'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
