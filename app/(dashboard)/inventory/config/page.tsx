'use client'

import { useState, useEffect } from 'react'
import useSWR from 'swr'
import BackButton from '../../BackButton'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const CATEGORIES = ['Chemical', 'Dye', 'Auxiliary', 'Spare']

export default function TallyConfigPage() {
  const { data, mutate, isLoading } = useSWR<any>('/api/inv/tally-config', fetcher)
  const [form, setForm] = useState<any>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (data) setForm(data) }, [data])

  if (isLoading || !form) return <div className="p-12 text-center text-gray-400">Loading…</div>

  function setMap(field: string, key: string, value: string) {
    setForm((f: any) => ({ ...f, [field]: { ...(f[field] || {}), [key]: value } }))
  }
  function setLeg(leg: 'IGST' | 'CGST' | 'SGST', rate: string, value: string) {
    setForm((f: any) => ({
      ...f,
      gstLedgers: { ...f.gstLedgers, [leg]: { ...(f.gstLedgers?.[leg] || {}), [rate]: value } },
    }))
  }

  async function save() {
    setSaving(true)
    try {
      await fetch('/api/inv/tally-config', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purchaseLedgerMap: form.purchaseLedgerMap,
          godownMap: form.godownMap,
          gstLedgers: form.gstLedgers,
          roundOffLedger: form.roundOffLedger,
          freightLedger: form.freightLedger,
          discountLedger: form.discountLedger,
        }),
      })
      mutate()
      alert('Saved')
    } finally { setSaving(false) }
  }

  return (
    <div className="p-4 md:p-8 max-w-4xl">
      <div className="flex items-center gap-3 mb-5">
        <BackButton />
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Tally Config</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Ledger + godown maps for Purchase voucher push.</p>
        </div>
      </div>

      <div className="space-y-6">
        <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100 mb-3">Purchase Ledger Map (per category)</h2>
          <div className="grid md:grid-cols-2 gap-3">
            {CATEGORIES.map(c => (
              <label key={c} className="block text-xs">
                <span className="text-gray-500 dark:text-gray-400">{c}</span>
                <input value={form.purchaseLedgerMap?.[c] || ''} onChange={e => setMap('purchaseLedgerMap', c, e.target.value)}
                  className="mt-0.5 w-full px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
              </label>
            ))}
          </div>
        </section>

        <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100 mb-3">Godown Map (per category)</h2>
          <div className="grid md:grid-cols-2 gap-3">
            {CATEGORIES.map(c => (
              <label key={c} className="block text-xs">
                <span className="text-gray-500 dark:text-gray-400">{c}</span>
                <input value={form.godownMap?.[c] || ''} onChange={e => setMap('godownMap', c, e.target.value)}
                  className="mt-0.5 w-full px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
              </label>
            ))}
          </div>
        </section>

        <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100 mb-3">GST Input Ledgers</h2>
          {(['IGST', 'CGST', 'SGST'] as const).map(leg => (
            <div key={leg} className="mb-3">
              <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">{leg}</h3>
              <div className="grid md:grid-cols-4 gap-2">
                {Object.entries(form.gstLedgers?.[leg] || {}).map(([rate, val]) => (
                  <label key={rate} className="block text-[11px]">
                    <span className="text-gray-500 dark:text-gray-400">{rate}%</span>
                    <input value={String(val || '')} onChange={e => setLeg(leg, rate, e.target.value)}
                      className="mt-0.5 w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs" />
                  </label>
                ))}
              </div>
            </div>
          ))}
        </section>

        <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100 mb-3">Misc Ledgers</h2>
          <div className="grid md:grid-cols-3 gap-3">
            {[['roundOffLedger', 'Round-off'], ['freightLedger', 'Freight (Inward)'], ['discountLedger', 'Discount']].map(([k, label]) => (
              <label key={k} className="block text-xs">
                <span className="text-gray-500 dark:text-gray-400">{label}</span>
                <input value={form[k] || ''} onChange={e => setForm((f: any) => ({ ...f, [k]: e.target.value }))}
                  className="mt-0.5 w-full px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
              </label>
            ))}
          </div>
        </section>

        <div className="flex justify-end">
          <button onClick={save} disabled={saving}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg text-sm font-semibold disabled:opacity-50">
            {saving ? 'Saving…' : 'Save Config'}
          </button>
        </div>
      </div>
    </div>
  )
}
