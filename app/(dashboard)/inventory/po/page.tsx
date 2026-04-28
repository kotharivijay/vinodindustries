'use client'

import { useState, useMemo } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import BackButton from '../../BackButton'

const fetcher = (url: string) => fetch(url).then(r => r.json())

export default function POListPage() {
  const { data, mutate } = useSWR<any[]>('/api/inv/pos', fetcher)
  const { data: parties = [] } = useSWR<any[]>('/api/inv/parties', fetcher)
  const { data: items = [] } = useSWR<any[]>('/api/inv/items', fetcher)

  const [show, setShow] = useState(false)
  const [partyId, setPartyId] = useState('')
  const [poDate, setPoDate] = useState(new Date().toISOString().slice(0, 10))
  const [expectedDate, setExpectedDate] = useState('')
  const [terms, setTerms] = useState('')
  const [lines, setLines] = useState<any[]>([])
  const [saving, setSaving] = useState(false)

  function addLine() { setLines(prev => [...prev, { itemId: '', qty: '', rate: '', unit: '' }]) }
  function rmLine(i: number) { setLines(prev => prev.filter((_, idx) => idx !== i)) }
  function setLine(i: number, k: string, v: any) { setLines(prev => prev.map((l, idx) => idx === i ? { ...l, [k]: v } : l)) }

  async function save() {
    if (!partyId || !poDate || !lines.length) { alert('Party, date and at least one line required'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/inv/pos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partyId: Number(partyId), poDate, expectedDate: expectedDate || null, terms,
          lines: lines.map(l => {
            const item = items.find((it: any) => it.id === Number(l.itemId))
            return { ...l, unit: item?.unit || l.unit || 'kg' }
          }),
        }),
      })
      const d = await res.json()
      if (!res.ok) { alert('Save failed: ' + (d.error || res.status)); return }
      setShow(false); setPartyId(''); setLines([])
      mutate()
    } finally { setSaving(false) }
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl">
      <div className="flex items-center gap-3 mb-5">
        <BackButton />
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Purchase Orders</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{data?.length || 0} POs</p>
        </div>
        <button onClick={() => setShow(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-semibold">+ New PO</button>
      </div>

      {!data?.length ? <div className="p-12 text-center text-gray-400">No POs yet.</div>
        : (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300">
              <tr>
                <th className="px-3 py-2 text-left">PO No</th>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Party</th>
                <th className="px-3 py-2 text-right">Lines</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {data.map((p: any) => (
                <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                  <td className="px-3 py-1.5"><Link href={`/inventory/po/${p.id}`} className="text-indigo-600 dark:text-indigo-400 font-mono hover:underline">{p.poNo}</Link></td>
                  <td className="px-3 py-1.5 text-gray-500">{new Date(p.poDate).toLocaleDateString('en-IN')}</td>
                  <td className="px-3 py-1.5 text-gray-700 dark:text-gray-200">{p.party?.displayName}</td>
                  <td className="px-3 py-1.5 text-right text-gray-500">{p.lines?.length}</td>
                  <td className="px-3 py-1.5 text-right text-gray-700 dark:text-gray-200 font-semibold">₹{Number(p.totalAmount || 0).toLocaleString('en-IN')}</td>
                  <td className="px-3 py-1.5"><span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200">{p.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto" onClick={() => setShow(false)}>
          <div onClick={e => e.stopPropagation()} className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-5 w-full max-w-2xl space-y-3 my-8">
            <h3 className="text-base font-bold text-gray-800 dark:text-gray-100">New Purchase Order</h3>
            <div className="grid md:grid-cols-3 gap-3">
              <label className="block text-xs">
                <span className="text-gray-500 dark:text-gray-400">Party *</span>
                <select value={partyId} onChange={e => setPartyId(e.target.value)}
                  className="mt-0.5 w-full px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm">
                  <option value="">— select —</option>
                  {parties.map((p: any) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
                </select>
              </label>
              <label className="block text-xs">
                <span className="text-gray-500 dark:text-gray-400">PO Date *</span>
                <input type="date" value={poDate} onChange={e => setPoDate(e.target.value)}
                  className="mt-0.5 w-full px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
              </label>
              <label className="block text-xs">
                <span className="text-gray-500 dark:text-gray-400">Expected</span>
                <input type="date" value={expectedDate} onChange={e => setExpectedDate(e.target.value)}
                  className="mt-0.5 w-full px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
              </label>
            </div>
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <select value={l.itemId} onChange={e => setLine(i, 'itemId', e.target.value)}
                    className="col-span-6 px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm">
                    <option value="">— item —</option>
                    {items.map((it: any) => <option key={it.id} value={it.id}>{it.displayName} ({it.unit})</option>)}
                  </select>
                  <input type="number" step="0.001" placeholder="Qty" value={l.qty} onChange={e => setLine(i, 'qty', e.target.value)}
                    className="col-span-2 px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
                  <input type="number" step="0.0001" placeholder="Rate" value={l.rate} onChange={e => setLine(i, 'rate', e.target.value)}
                    className="col-span-2 px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
                  <span className="col-span-1 text-xs text-right">{l.qty && l.rate ? '₹' + (Number(l.qty) * Number(l.rate)).toFixed(2) : ''}</span>
                  <button onClick={() => rmLine(i)} className="col-span-1 text-red-500">×</button>
                </div>
              ))}
              <button onClick={addLine} className="text-xs text-indigo-600 dark:text-indigo-400 font-semibold hover:underline">+ Add line</button>
            </div>
            <textarea value={terms} onChange={e => setTerms(e.target.value)} placeholder="Terms…" rows={2}
              className="w-full px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
            <div className="flex gap-2 justify-end pt-2">
              <button onClick={() => setShow(false)} className="px-4 py-2 rounded-lg text-sm bg-gray-200 dark:bg-gray-700">Cancel</button>
              <button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg text-sm bg-indigo-600 text-white font-semibold disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
