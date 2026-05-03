'use client'

import { useState, useEffect, useMemo } from 'react'
import useSWR from 'swr'
import { useRouter, useSearchParams } from 'next/navigation'
import BackButton from '../../../BackButton'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface InvLine { itemId: string | null; description: string; qty: string; unit: string; rate: string; gstRate: string; challanLineId?: string | null }

export default function NewInvoicePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: parties = [] } = useSWR<any[]>('/api/inv/parties', fetcher)

  const [partyId, setPartyId] = useState('')
  const [preloadDone, setPreloadDone] = useState(false)
  const [supplierInvoiceNo, setInvNo] = useState('')
  const [supplierInvoiceDate, setInvDate] = useState(new Date().toISOString().slice(0, 10))
  const [freightAmount, setFreight] = useState('')
  const [otherCharges, setOther] = useState('')
  const [notes, setNotes] = useState('')

  const { data: pendingChallans = [] } = useSWR<any[]>(
    partyId ? `/api/inv/challans?partyId=${partyId}&status=PendingInvoice` : null,
    fetcher,
  )
  const [selectedChallans, setSelectedChallans] = useState<Set<number>>(new Set())
  const [lines, setLines] = useState<InvLine[]>([])
  const [saving, setSaving] = useState(false)

  // When challan selection changes, populate lines from those challan's lines
  useEffect(() => {
    if (!selectedChallans.size) return
    ;(async () => {
      const newLines: InvLine[] = []
      for (const cid of Array.from(selectedChallans)) {
        const res = await fetch(`/api/inv/challans/${cid}`)
        if (!res.ok) continue
        const c = await res.json()
        for (const cl of c.lines) {
          // Prefer the line's saved gstRate (set on the challan card),
          // fall back to alias master.
          const gst = cl.gstRate != null ? cl.gstRate : cl.item.alias?.gstRate
          newLines.push({
            itemId: String(cl.item.id),
            description: cl.item.displayName,
            qty: String(cl.qty),
            unit: cl.unit,
            rate: cl.rate ? String(cl.rate) : '',
            gstRate: gst != null ? String(gst) : '',
            challanLineId: String(cl.id),
          })
        }
      }
      setLines(newLines)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Array.from(selectedChallans).join(',')])

  // Preload from ?challans=1,2,3 — set party from the first challan, mark all as selected.
  useEffect(() => {
    if (preloadDone) return
    const csv = searchParams?.get('challans')
    if (!csv) { setPreloadDone(true); return }
    const ids = csv.split(',').map(s => parseInt(s, 10)).filter(n => Number.isFinite(n) && n > 0)
    if (ids.length === 0) { setPreloadDone(true); return }
    ;(async () => {
      try {
        const first = await fetch(`/api/inv/challans/${ids[0]}`).then(r => r.ok ? r.json() : null)
        if (first?.partyId) setPartyId(String(first.partyId))
        setSelectedChallans(new Set(ids))
      } finally {
        setPreloadDone(true)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  function toggleChallan(id: number) {
    setSelectedChallans(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function setLine(i: number, k: keyof InvLine, v: string) {
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, [k]: v } : l))
  }
  function rmLine(i: number) { setLines(prev => prev.filter((_, idx) => idx !== i)) }
  function addFreightLine() {
    setLines(prev => [...prev, { itemId: null, description: 'Freight', qty: '1', unit: 'lot', rate: '', gstRate: '0' }])
  }

  const totals = useMemo(() => {
    let net = 0, gst = 0
    for (const l of lines) {
      const q = Number(l.qty) || 0
      const r = Number(l.rate) || 0
      const lineNet = q * r
      const lineGst = lineNet * (Number(l.gstRate) || 0) / 100
      net += lineNet; gst += lineGst
    }
    return { net, gst, freight: Number(freightAmount) || 0, other: Number(otherCharges) || 0 }
  }, [lines, freightAmount, otherCharges])

  async function save() {
    if (!partyId || !supplierInvoiceNo || !supplierInvoiceDate || !lines.length) {
      alert('Party, Invoice No, Date and at least one line are required.'); return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/inv/invoices', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partyId: Number(partyId), supplierInvoiceNo, supplierInvoiceDate,
          freightAmount, otherCharges, notes,
          challanIds: Array.from(selectedChallans),
          lines,
        }),
      })
      const d = await res.json()
      if (!res.ok) { alert('Save failed: ' + (d.error || res.status)); return }
      router.push(`/inventory/invoices/${d.id}`)
    } finally { setSaving(false) }
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl">
      <div className="flex items-center gap-3 mb-5">
        <BackButton />
        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">New Purchase Invoice</h1>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-4">
        <div className="grid md:grid-cols-3 gap-3">
          <label className="block text-xs">
            <span className="text-gray-500 dark:text-gray-400">Party *</span>
            <select value={partyId} onChange={e => { setPartyId(e.target.value); setSelectedChallans(new Set()); setLines([]) }}
              className="mt-0.5 w-full px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm">
              <option value="">— select —</option>
              {parties.map((p: any) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
            </select>
          </label>
          <label className="block text-xs">
            <span className="text-gray-500 dark:text-gray-400">Supplier Invoice No *</span>
            <input value={supplierInvoiceNo} onChange={e => setInvNo(e.target.value)}
              className="mt-0.5 w-full px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
          </label>
          <label className="block text-xs">
            <span className="text-gray-500 dark:text-gray-400">Invoice Date *</span>
            <input type="date" value={supplierInvoiceDate} onChange={e => setInvDate(e.target.value)}
              className="mt-0.5 w-full px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
          </label>
        </div>

        {partyId && (
          <div>
            <h3 className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Pending challans for this party</h3>
            {!pendingChallans.length ? <p className="text-xs text-gray-400">None pending.</p> : (
              <div className="space-y-1">
                {pendingChallans.map((c: any) => (
                  <label key={c.id} className="flex items-center gap-2 text-xs cursor-pointer">
                    <input type="checkbox" checked={selectedChallans.has(c.id)} onChange={() => toggleChallan(c.id)} />
                    <span className="font-mono text-indigo-600 dark:text-indigo-400">KSI/IN/{c.seriesFy}/{String(c.internalSeriesNo).padStart(4, '0')}</span>
                    <span className="text-gray-500">{c.challanNo}</span>
                    <span className="text-gray-400">{new Date(c.challanDate).toLocaleDateString('en-IN')}</span>
                    <span className="text-gray-700 dark:text-gray-200 font-semibold">{c.lines?.length} lines · ₹{Number(c.totalAmount || 0).toLocaleString('en-IN')}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-medium text-gray-600 dark:text-gray-400">Lines</h3>
            <button onClick={addFreightLine} className="text-[11px] text-indigo-600 dark:text-indigo-400 font-semibold hover:underline">+ Freight</button>
          </div>
          <div className="space-y-1">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <input value={l.description} onChange={e => setLine(i, 'description', e.target.value)} placeholder="Description"
                  className="col-span-4 px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs" />
                <input type="number" step="0.001" value={l.qty} onChange={e => setLine(i, 'qty', e.target.value)} placeholder="Qty"
                  className="col-span-2 px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs" />
                <input type="number" step="0.0001" value={l.rate} onChange={e => setLine(i, 'rate', e.target.value)} placeholder="Rate"
                  className="col-span-2 px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs" />
                <input type="number" step="0.01" value={l.gstRate} onChange={e => setLine(i, 'gstRate', e.target.value)} placeholder="GST%"
                  className="col-span-2 px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs" />
                <span className="col-span-1 text-xs text-right">{l.qty && l.rate ? '₹' + (Number(l.qty) * Number(l.rate)).toFixed(2) : '—'}</span>
                <button onClick={() => rmLine(i)} className="col-span-1 text-red-500">×</button>
              </div>
            ))}
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes…" rows={2}
            className="w-full px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
          <div className="grid grid-cols-2 gap-2">
            <input type="number" step="0.01" value={freightAmount} onChange={e => setFreight(e.target.value)} placeholder="Freight"
              className="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
            <input type="number" step="0.01" value={otherCharges} onChange={e => setOther(e.target.value)} placeholder="Other charges"
              className="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
          </div>
        </div>

        <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-3 text-sm space-y-1">
          <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Taxable</span><span>₹{totals.net.toLocaleString('en-IN')}</span></div>
          <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">GST</span><span>₹{totals.gst.toLocaleString('en-IN')}</span></div>
          <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Freight + other</span><span>₹{(totals.freight + totals.other).toLocaleString('en-IN')}</span></div>
          <div className="flex justify-between font-bold border-t border-gray-200 dark:border-gray-700 pt-1"><span>Total</span><span>₹{(totals.net + totals.gst + totals.freight + totals.other).toLocaleString('en-IN')}</span></div>
        </div>

        <div className="flex gap-2 justify-end pt-2 border-t border-gray-200 dark:border-gray-700">
          <button onClick={save} disabled={saving}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-6 py-2 rounded-lg text-sm font-semibold">
            {saving ? 'Saving…' : 'Save Invoice'}
          </button>
        </div>
      </div>
    </div>
  )
}
