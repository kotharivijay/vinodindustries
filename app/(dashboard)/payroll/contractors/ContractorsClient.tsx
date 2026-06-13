'use client'

import { Fragment, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type Contractor = {
  id: string
  name: string
  tallyLedgerName: string | null
  notes: string | null
  isActive: boolean
  _count: { staff: number }
}

type JobTemplate = {
  id: string
  processName: string
  quality: string | null
  rate: number
  sortOrder: number
}

export default function ContractorsClient({ initial }: { initial: Contractor[] }) {
  const router = useRouter()
  const [list, setList] = useState<Contractor[]>(initial)
  const [name, setName] = useState('')
  const [tallyLedger, setTallyLedger] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showInactive, setShowInactive] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<Partial<Contractor>>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)

  async function addContractor() {
    if (!name.trim()) { setError('Name is required'); return }
    setSaving(true); setError(null)
    const res = await fetch('/api/payroll/contractors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, tallyLedgerName: tallyLedger, notes }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error || 'Failed'); setSaving(false); return }
    setList((l) => [...l, { ...data, _count: { staff: 0 } }].sort((a, b) => a.name.localeCompare(b.name)))
    setName(''); setTallyLedger(''); setNotes('')
    setSaving(false)
    router.refresh()
  }

  async function saveEdit(id: string) {
    const res = await fetch(`/api/payroll/contractors/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editDraft),
    })
    if (!res.ok) {
      const d = await res.json()
      alert(d.error || 'Update failed')
      return
    }
    const updated = await res.json()
    setList((l) => l.map((c) => (c.id === id ? { ...c, ...updated } : c)))
    setEditingId(null); setEditDraft({})
  }

  async function toggleActive(id: string, isActive: boolean) {
    if (isActive) {
      if (!confirm('Deactivate this contractor? Staff already tagged to them keep the tag.')) return
      const res = await fetch(`/api/payroll/contractors/${id}`, { method: 'DELETE' })
      if (!res.ok) { alert('Failed'); return }
      setList((l) => l.map((c) => (c.id === id ? { ...c, isActive: false } : c)))
    } else {
      const res = await fetch(`/api/payroll/contractors/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: true }),
      })
      if (!res.ok) { alert('Failed'); return }
      setList((l) => l.map((c) => (c.id === id ? { ...c, isActive: true } : c)))
    }
  }

  const visible = showInactive ? list : list.filter((c) => c.isActive)

  return (
    <div className="max-w-5xl mx-auto animate-fade-in">
      <h1 className="text-xl md:text-2xl font-bold mb-4">Payroll · Contractors</h1>

      <div className="card p-4 mb-4">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Add contractor</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name *"
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800" />
          <input value={tallyLedger} onChange={(e) => setTallyLedger(e.target.value)} placeholder="Tally ledger (optional)"
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800" />
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)"
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800" />
          <button onClick={addContractor} disabled={saving}
            className="btn btn-primary disabled:opacity-50">{saving ? 'Saving…' : 'Add'}</button>
        </div>
        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      </div>

      <div className="flex justify-between items-center mb-2">
        <label className="text-xs flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show inactive
        </label>
        <span className="text-xs text-gray-500">{visible.length} contractor{visible.length === 1 ? '' : 's'}</span>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="px-4 py-3 text-left">Name</th>
              <th className="px-4 py-3 text-left">Tally Ledger</th>
              <th className="px-4 py-3 text-left">Notes</th>
              <th className="px-4 py-3 text-center">Staff</th>
              <th className="px-4 py-3 text-center">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No contractors yet</td></tr>
            )}
            {visible.map((c) => (
              <Fragment key={c.id}>
              {editingId === c.id ? (
              <tr className="bg-yellow-50 dark:bg-yellow-900/10">
                <td className="px-4 py-2"><input value={editDraft.name ?? c.name} onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                  className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm w-full bg-white dark:bg-gray-800" /></td>
                <td className="px-4 py-2"><input value={(editDraft.tallyLedgerName ?? c.tallyLedgerName) || ''} onChange={(e) => setEditDraft({ ...editDraft, tallyLedgerName: e.target.value })}
                  className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm w-full bg-white dark:bg-gray-800" /></td>
                <td className="px-4 py-2"><input value={(editDraft.notes ?? c.notes) || ''} onChange={(e) => setEditDraft({ ...editDraft, notes: e.target.value })}
                  className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm w-full bg-white dark:bg-gray-800" /></td>
                <td className="px-4 py-2 text-center text-gray-500">{c._count.staff}</td>
                <td className="px-4 py-2 text-center">{c.isActive ? <span className="badge badge-green">Active</span> : <span className="badge badge-gray">Inactive</span>}</td>
                <td className="px-4 py-2 text-right">
                  <button onClick={() => saveEdit(c.id)} className="text-xs font-semibold px-2 py-1 rounded bg-indigo-600 text-white mr-1">Save</button>
                  <button onClick={() => { setEditingId(null); setEditDraft({}) }} className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600">Cancel</button>
                </td>
              </tr>
            ) : (
              <tr className={c.isActive ? '' : 'opacity-50'}>
                <td className="px-4 py-2 font-medium">
                  <button onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                    className={`inline-block mr-2 text-xs transition-transform ${expandedId === c.id ? 'rotate-90' : ''}`}>&#9654;</button>
                  {c.name}
                </td>
                <td className="px-4 py-2 text-gray-600 dark:text-gray-400">{c.tallyLedgerName || '—'}</td>
                <td className="px-4 py-2 text-gray-600 dark:text-gray-400 text-xs">{c.notes || '—'}</td>
                <td className="px-4 py-2 text-center">{c._count.staff}</td>
                <td className="px-4 py-2 text-center">{c.isActive ? <span className="badge badge-green">Active</span> : <span className="badge badge-gray">Inactive</span>}</td>
                <td className="px-4 py-2 text-right">
                  <button onClick={() => { setEditingId(c.id); setEditDraft({}) }} className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 mr-1">Edit</button>
                  <button onClick={() => toggleActive(c.id, c.isActive)} className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600">
                    {c.isActive ? 'Deactivate' : 'Reactivate'}
                  </button>
                </td>
              </tr>
            )}
            {expandedId === c.id && (
              <tr className="bg-gray-50/50 dark:bg-gray-800/30">
                <td colSpan={6} className="px-4 py-3">
                  <JobTemplatesPanel contractorId={c.id} contractorName={c.name} />
                </td>
              </tr>
            )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Lazy-loaded job templates for one contractor. Renders an inline editor:
// list of (process | quality | rate) rows + an "Add template" form. These
// templates auto-appear as pre-filled rows in the wages page every month.
function JobTemplatesPanel({ contractorId, contractorName }: { contractorId: string; contractorName: string }) {
  const [templates, setTemplates] = useState<JobTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [processName, setProcessName] = useState('')
  const [quality, setQuality] = useState('')
  const [rate, setRate] = useState('')
  const [adding, setAdding] = useState(false)

  async function load() {
    setLoading(true)
    const res = await fetch(`/api/payroll/contractors/${contractorId}/templates`)
    if (res.ok) setTemplates(await res.json())
    setLoading(false)
  }

  useEffect(() => { load() }, [contractorId])  // eslint-disable-line

  async function addTemplate() {
    const r = Number(rate) || 0
    if (!processName.trim() || r <= 0) { alert('Process name and positive rate required'); return }
    setAdding(true)
    const res = await fetch(`/api/payroll/contractors/${contractorId}/templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ processName, quality, rate: r, sortOrder: templates.length }),
    })
    setAdding(false)
    if (!res.ok) { alert('Add failed'); return }
    setProcessName(''); setQuality(''); setRate('')
    await load()
  }

  async function deleteTemplate(id: string) {
    if (!confirm('Delete this template? Existing month jobs already created from it stay; future months won\'t auto-fill it.')) return
    const res = await fetch(`/api/payroll/job-templates/${id}`, { method: 'DELETE' })
    if (!res.ok) { alert('Delete failed'); return }
    await load()
  }

  async function patchTemplate(id: string, patch: Partial<JobTemplate>) {
    const res = await fetch(`/api/payroll/job-templates/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!res.ok) { alert('Update failed'); return }
    await load()
  }

  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
        Job Templates · {contractorName}
        <span className="ml-2 text-[10px] font-normal text-gray-400">auto-fill into the wages page every month, user only enters quantity</span>
      </h3>
      {loading ? <p className="text-xs text-gray-400">Loading…</p> : (
        <>
          {templates.length === 0 && (
            <p className="text-xs text-gray-400 italic mb-2">No templates yet. Add the regular jobs this contractor does so they appear pre-filled in every month's wages.</p>
          )}
          {templates.length > 0 && (
            <table className="w-full text-xs mb-2">
              <thead>
                <tr className="text-gray-500">
                  <th className="px-2 py-1 text-left">Process</th>
                  <th className="px-2 py-1 text-left">Quality</th>
                  <th className="px-2 py-1 text-right">Rate</th>
                  <th className="px-2 py-1"></th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id} className="border-t border-gray-200 dark:border-gray-700">
                    <td className="px-2 py-1">
                      <input defaultValue={t.processName}
                        onBlur={(e) => e.target.value !== t.processName && patchTemplate(t.id, { processName: e.target.value })}
                        className="px-1 py-0.5 border border-gray-300 dark:border-gray-600 rounded text-xs w-full bg-white dark:bg-gray-800" />
                    </td>
                    <td className="px-2 py-1">
                      <input defaultValue={t.quality || ''} placeholder="—"
                        onBlur={(e) => (e.target.value || null) !== t.quality && patchTemplate(t.id, { quality: e.target.value || null })}
                        className="px-1 py-0.5 border border-gray-300 dark:border-gray-600 rounded text-xs w-full bg-white dark:bg-gray-800" />
                    </td>
                    <td className="px-2 py-1 text-right">
                      <input type="number" step="0.01" defaultValue={t.rate}
                        onBlur={(e) => Number(e.target.value) !== t.rate && patchTemplate(t.id, { rate: Number(e.target.value) })}
                        className="px-1 py-0.5 border border-gray-300 dark:border-gray-600 rounded text-xs w-20 text-right bg-white dark:bg-gray-800" />
                    </td>
                    <td className="px-2 py-1 text-right">
                      <button onClick={() => deleteTemplate(t.id)} className="text-red-600 hover:text-red-800 text-sm">×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="flex flex-wrap items-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
            <input value={processName} onChange={(e) => setProcessName(e.target.value)} placeholder="Process (e.g. Checking)"
              className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-xs bg-white dark:bg-gray-800" />
            <input value={quality} onChange={(e) => setQuality(e.target.value)} placeholder="Quality (optional)"
              className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-xs bg-white dark:bg-gray-800" />
            <input type="number" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="Rate"
              className="w-24 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-xs text-right bg-white dark:bg-gray-800" />
            <button onClick={addTemplate} disabled={adding}
              className="text-xs font-semibold px-3 py-1 rounded bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white">
              {adding ? 'Adding…' : '+ Add Template'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
