'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

type Staff = {
  id: string
  code: string
  name: string
  fatherName: string | null
  aadhar: string | null
  dob: string | null // ISO date string from JSON serialisation
  department: string | null
  monthlyBaseSalary: number
  actualSalary: number | null
  paymentMode: 'SALARIED' | 'CONTRACTOR_LINKED' | string
  contractors: { id: string; name: string }[]
  tallyLedgerName: string | null
  status: 'ACTIVE' | 'INACTIVE' | 'DELETED' | string
  isActive: boolean
  inRegister: boolean
  inactivatedMonth: string | null
  notes: string | null
  registerGroup: string | null
}

type SalaryRevision = {
  id: string
  field: 'REGISTER' | 'ACTUAL' | string
  oldValue: number
  newValue: number
  deltaAmount: number
  deltaPercent: number
  effectiveMonth: string
  changedBy: string | null
  note: string | null
  changedAt: string
}

// Modal draft: same shape as Staff but every field optional plus the
// contractorIds[] selection from the multi-select chip picker.
type StaffDraft = Partial<Staff> & { contractorIds?: string[] }

function statusBadge(s: string, inactivatedMonth?: string | null) {
  const t = inactivatedMonth ? `Off register from ${inactivatedMonth}` : undefined
  if (s === 'ACTIVE') return <span className="badge badge-green">Active</span>
  if (s === 'INACTIVE') return <span className="badge badge-gray" title={t}>Inactive</span>
  if (s === 'DELETED') return <span className="badge text-red-700 bg-red-100 dark:bg-red-900/30" title={t}>Deleted</span>
  return <span className="badge badge-gray">{s}</span>
}

function isoDate(d: string | null | undefined): string {
  if (!d) return ''
  return d.slice(0, 10)
}

function ageOf(dob: string | null | undefined): number | null {
  if (!dob) return null
  const d = new Date(dob)
  if (isNaN(d.getTime())) return null
  return (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 365.25)
}

type Contractor = { id: string; name: string }

type ImportResult = {
  created: number; updated: number; errors: number; total: number
  results: { code: string; name: string; status: 'created' | 'updated' | 'error'; message?: string }[]
}

export default function StaffClient({ initialStaff, contractors }: { initialStaff: Staff[]; contractors: Contractor[] }) {
  const router = useRouter()
  const [staff, setStaff] = useState<Staff[]>(initialStaff)
  const [search, setSearch] = useState('')
  const [mode, setMode] = useState<'' | 'SALARIED' | 'CONTRACTOR_LINKED'>('')
  const [contractorFilter, setContractorFilter] = useState<string>('')
  const [showImport, setShowImport] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  // Modal state — used for both Add (when modalMode='create') and Edit.
  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null)
  const [modalDraft, setModalDraft] = useState<StaffDraft>({})
  const [modalSaving, setModalSaving] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<'' | 'ACTIVE' | 'INACTIVE' | 'DELETED'>('ACTIVE')
  const [groupFilter, setGroupFilter] = useState<string>('')

  const filtered = useMemo(() => {
    return staff.filter((s) => {
      if (statusFilter && s.status !== statusFilter) return false
      if (mode && s.paymentMode !== mode) return false
      if (contractorFilter === 'none' && s.contractors.length > 0) return false
      if (contractorFilter && contractorFilter !== 'none' && !s.contractors.some((c) => c.id === contractorFilter)) return false
      if (groupFilter === 'unassigned') {
        if (s.registerGroup) return false
      } else if (groupFilter && s.registerGroup !== groupFilter) {
        return false
      }
      if (search) {
        const q = search.toLowerCase()
        if (!s.name.toLowerCase().includes(q) && !s.code.toLowerCase().includes(q) && !(s.department || '').toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [staff, search, mode, contractorFilter, statusFilter, groupFilter])

  const counts = useMemo(() => ({
    total: staff.filter((s) => s.isActive).length,
    salaried: staff.filter((s) => s.isActive && s.paymentMode === 'SALARIED').length,
    contractor: staff.filter((s) => s.isActive && s.paymentMode === 'CONTRACTOR_LINKED').length,
    unassigned: staff.filter((s) => s.isActive && s.contractors.length === 0).length,
  }), [staff])

  async function runImport() {
    if (!pasteText.trim()) { alert('Paste some rows first'); return }
    setImporting(true); setImportResult(null)
    const res = await fetch('/api/payroll/staff/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: pasteText }),
    })
    const data = await res.json()
    setImporting(false)
    if (!res.ok) { alert(data.error || 'Import failed'); return }
    setImportResult(data)
    // Refresh list from server
    const list = await fetch('/api/payroll/staff?includeInactive=1').then((r) => r.json())
    setStaff(list)
    router.refresh()
  }

  async function changeStatus(id: string, newStatus: 'ACTIVE' | 'INACTIVE' | 'DELETED') {
    if (newStatus === 'DELETED' && !confirm('Mark this staff as DELETED? They will disappear from the active register but historical wages stay intact.')) return
    const res = await fetch(`/api/payroll/staff/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    if (!res.ok) { alert('Failed'); return }
    const updated = await res.json()
    setStaff((l) => l.map((s) => s.id === id ? { ...s, ...updated } : s))
  }

  function openAddModal() {
    setModalMode('create')
    setModalDraft({ paymentMode: 'SALARIED', status: 'ACTIVE', contractorIds: [] })
    setModalError(null)
  }
  function openEditModal(s: Staff) {
    setModalMode('edit')
    setModalDraft({ ...s, contractorIds: s.contractors.map((c) => c.id) })
    setModalError(null)
  }
  function closeModal() {
    setModalMode(null); setModalDraft({}); setModalError(null)
  }

  async function saveModal() {
    setModalSaving(true); setModalError(null)
    try {
      const isCreate = modalMode === 'create'
      const url = isCreate ? '/api/payroll/staff' : `/api/payroll/staff/${modalDraft.id}`
      const method = isCreate ? 'POST' : 'PATCH'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(modalDraft),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Save failed')
      if (isCreate) setStaff((l) => [...l, data].sort((a, b) => a.name.localeCompare(b.name)))
      else setStaff((l) => l.map((s) => s.id === data.id ? { ...s, ...data } : s))
      closeModal()
      router.refresh()
    } catch (e) {
      setModalError((e as Error).message)
    } finally {
      setModalSaving(false)
    }
  }

  return (
    <div className="max-w-7xl mx-auto animate-fade-in">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl md:text-2xl font-bold">Payroll · Staff Register</h1>
        <div className="flex items-center gap-2">
          <button onClick={openAddModal}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer">
            + Add Staff
          </button>
          <button onClick={() => setShowImport((v) => !v)}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer">
            {showImport ? '✕ Close Import' : '📋 Paste Import'}
          </button>
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="stat-card"><p className="text-xs text-gray-500 mb-0.5">Active staff</p><p className="text-xl font-bold">{counts.total}</p></div>
        <div className="stat-card"><p className="text-xs text-gray-500 mb-0.5">Salaried</p><p className="text-xl font-bold text-blue-600">{counts.salaried}</p></div>
        <div className="stat-card"><p className="text-xs text-gray-500 mb-0.5">Contractor-linked</p><p className="text-xl font-bold text-emerald-600">{counts.contractor}</p></div>
        <div className="stat-card"><p className="text-xs text-gray-500 mb-0.5">No contractor</p><p className="text-xl font-bold text-gray-600">{counts.unassigned}</p></div>
      </div>

      {showImport && (
        <div className="card p-4 mb-4 border-2 border-indigo-200 dark:border-indigo-800">
          <h2 className="text-sm font-semibold mb-2">Paste from Excel</h2>
          <p className="text-xs text-gray-500 mb-2">
            Columns: <code>sn | code | name | department | salary</code> (J1 column is ignored).
            Existing codes are updated; contractor tags are preserved.
          </p>
          <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={8}
            placeholder={'1\t1002\tDanaram S/O Rama Ram\tetp\t33000\t1100\n2\t1023\tRamaram S/O Kesha Ram\tAccountent\t20500\t683'}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-xs font-mono bg-white dark:bg-gray-800" />
          <div className="flex justify-end gap-2 mt-2">
            <button onClick={() => { setPasteText(''); setImportResult(null) }} className="text-xs px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600">Clear</button>
            <button onClick={runImport} disabled={importing} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white">
              {importing ? 'Importing…' : 'Import'}
            </button>
          </div>
          {importResult && (
            <div className="mt-3 text-xs">
              <div className="flex gap-4 mb-2">
                <span className="text-emerald-700 font-semibold">{importResult.created} created</span>
                <span className="text-blue-700 font-semibold">{importResult.updated} updated</span>
                {importResult.errors > 0 && <span className="text-red-700 font-semibold">{importResult.errors} errors</span>}
                <span className="text-gray-500">of {importResult.total} rows</span>
              </div>
              {importResult.errors > 0 && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-red-700">Show errors</summary>
                  <ul className="mt-1 pl-4 list-disc">
                    {importResult.results.filter((r) => r.status === 'error').slice(0, 50).map((r, i) => (
                      <li key={i}><span className="font-mono">{r.code || '—'}</span> {r.name && <>· {r.name}</>} — {r.message}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-end mb-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Search</label>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name / code / dept"
            className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800">
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="DELETED">Deleted</option>
            <option value="">All</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Payment mode</label>
          <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}
            className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800">
            <option value="">All</option>
            <option value="SALARIED">Salaried</option>
            <option value="CONTRACTOR_LINKED">Contractor-linked</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Contractor</label>
          <select value={contractorFilter} onChange={(e) => setContractorFilter(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800">
            <option value="">All</option>
            <option value="none">— Unassigned —</option>
            {contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Register Group</label>
          <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800">
            <option value="">All</option>
            <option value="KSI-1">KSI-1</option>
            <option value="KSI-2">KSI-2</option>
            <option value="unassigned">— Unassigned —</option>
          </select>
        </div>
        <span className="text-xs text-gray-500 ml-auto">{filtered.length} of {staff.length}</span>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="px-3 py-2 text-left">Code</th>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Department</th>
                <th className="px-3 py-2 text-right">Salary</th>
                <th className="px-3 py-2 text-center">Mode</th>
                <th className="px-3 py-2 text-left">Contractor</th>
                <th className="px-3 py-2 text-left">Tally Ledger</th>
                <th className="px-3 py-2 text-center">Group</th>
                <th className="px-3 py-2 text-center">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400">No staff match</td></tr>
              )}
              {filtered.map((s) => (
                <tr key={s.id} className={s.status === 'ACTIVE' ? '' : 'opacity-60'}>
                  <td className="px-3 py-2 font-mono text-xs text-gray-600 dark:text-gray-400">{s.code}</td>
                  <td className="px-3 py-2 font-medium">
                    {s.name}
                    {s.inRegister && <span className="ml-1.5 text-[9px] px-1 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 font-semibold align-middle" title="Name is on the official Salary Register">Reg</span>}
                    {s.fatherName && <div className="text-[10px] text-gray-500">S/O {s.fatherName}</div>}
                  </td>
                  <td className="px-3 py-2 text-gray-600 dark:text-gray-400 text-xs">{s.department || '—'}</td>
                  <td className="px-3 py-2 text-right font-semibold">
                    <div>{s.monthlyBaseSalary > 0 ? `₹${s.monthlyBaseSalary.toLocaleString('en-IN')}` : '—'}</div>
                    {s.actualSalary != null && (
                      <div className="text-[10px] text-gray-500 font-normal">Act: ₹{s.actualSalary.toLocaleString('en-IN')}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {s.paymentMode === 'CONTRACTOR_LINKED'
                      ? <span className="badge badge-green">Contractor</span>
                      : <span className="badge badge-blue">Salaried</span>}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {s.contractors.length === 0
                      ? <span className="text-gray-400">—</span>
                      : <div className="flex flex-wrap gap-1">
                          {s.contractors.map((c) => <span key={c.id} className="badge badge-gray text-[10px]">{c.name}</span>)}
                        </div>}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-400">{s.tallyLedgerName || '—'}</td>
                  <td className="px-3 py-2 text-center text-xs">
                    {s.registerGroup ? <span className="badge badge-gray">{s.registerGroup}</span> : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-2 text-center">{statusBadge(s.status, s.inactivatedMonth)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button onClick={() => openEditModal(s)} className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 mr-1">Edit</button>
                    {s.status === 'ACTIVE' && (
                      <button onClick={() => changeStatus(s.id, 'INACTIVE')} className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 mr-1">Set Inactive</button>
                    )}
                    {s.status !== 'ACTIVE' && (
                      <button onClick={() => changeStatus(s.id, 'ACTIVE')} className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 mr-1">Reactivate</button>
                    )}
                    {s.status !== 'DELETED' && (
                      <button onClick={() => changeStatus(s.id, 'DELETED')} className="text-xs px-2 py-1 rounded border border-red-300 text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20">Delete</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modalMode && (
        <StaffFormModal
          mode={modalMode}
          draft={modalDraft}
          setDraft={setModalDraft}
          contractors={contractors}
          onSave={saveModal}
          onClose={closeModal}
          saving={modalSaving}
          error={modalError}
        />
      )}
    </div>
  )
}

function StaffFormModal({ mode, draft, setDraft, contractors, onSave, onClose, saving, error }: {
  mode: 'create' | 'edit'
  draft: StaffDraft
  setDraft: (d: StaffDraft) => void
  contractors: Contractor[]
  onSave: () => void
  onClose: () => void
  saving: boolean
  error: string | null
}) {
  const age = ageOf(draft.dob)
  const ageWarn = age != null && age < 18
  const aadharRaw = (draft.aadhar || '').replace(/\D/g, '')
  const aadharWarn = aadharRaw.length > 0 && aadharRaw.length !== 12

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-3" onClick={() => !saving && onClose()}>
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h2 className="text-base font-semibold">{mode === 'create' ? 'Add Staff' : `Edit · ${draft.name || ''}`}</h2>
          <button onClick={onClose} disabled={saving} className="text-gray-500 hover:text-gray-900 text-xl leading-none">×</button>
        </div>
        <div className="flex-1 overflow-auto p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Code *">
            <input value={draft.code || ''} onChange={(e) => setDraft({ ...draft, code: e.target.value })}
              placeholder="e.g. 1106" className="input" />
          </Field>
          <Field label="Name *">
            <input value={draft.name || ''} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="input" />
          </Field>
          <Field label="Father's Name">
            <input value={draft.fatherName || ''} onChange={(e) => setDraft({ ...draft, fatherName: e.target.value })} className="input" />
          </Field>
          <Field label="Aadhar (12 digits)">
            <input value={draft.aadhar || ''} onChange={(e) => setDraft({ ...draft, aadhar: e.target.value })}
              placeholder="1234 5678 9012" className={`input ${aadharWarn ? 'border-red-500' : ''}`} />
            {aadharWarn && <p className="text-[10px] text-red-600 mt-0.5">Aadhar must be exactly 12 digits</p>}
          </Field>
          <Field label="Date of Birth">
            <input type="date" value={isoDate(draft.dob)} onChange={(e) => setDraft({ ...draft, dob: e.target.value || null })}
              className={`input ${ageWarn ? 'border-red-500' : ''}`} max={isoDate(new Date(Date.now() - 18 * 365.25 * 86400000).toISOString())} />
            {age != null && (
              <p className={`text-[10px] mt-0.5 ${ageWarn ? 'text-red-600' : 'text-gray-500'}`}>
                {ageWarn ? `⚠ Age ${age.toFixed(1)} years — must be ≥ 18` : `Age ${age.toFixed(1)} years`}
              </p>
            )}
          </Field>
          <Field label="Department">
            <input value={draft.department || ''} onChange={(e) => setDraft({ ...draft, department: e.target.value })}
              placeholder="kadap, OPERATOR, FOLDING…" className="input" />
          </Field>
          <Field label="Monthly Salary (₹)">
            <input type="number" min={0} value={draft.monthlyBaseSalary ?? 0}
              onChange={(e) => setDraft({ ...draft, monthlyBaseSalary: Number(e.target.value) })} className="input text-right" />
          </Field>
          <Field label="Actual Salary (₹) - Optional">
            <input type="number" min={0} value={draft.actualSalary ?? ''}
              onChange={(e) => setDraft({ ...draft, actualSalary: e.target.value ? Number(e.target.value) : null })}
              placeholder="e.g. 16000 (Uses 30-day divisor for wages)" className="input text-right" />
          </Field>
          <Field label="Payment Mode">
            <select value={(draft.paymentMode || 'SALARIED') as string}
              onChange={(e) => setDraft({ ...draft, paymentMode: e.target.value })} className="input">
              <option value="SALARIED">Salaried</option>
              <option value="CONTRACTOR_LINKED">Contractor-linked</option>
            </select>
          </Field>
          <Field label="Contractors">
            <ContractorChipPicker contractors={contractors}
              selected={draft.contractorIds || []}
              onChange={(ids) => setDraft({ ...draft, contractorIds: ids })} />
          </Field>
          <Field label="Tally Ledger Name">
            <input value={draft.tallyLedgerName || ''} onChange={(e) => setDraft({ ...draft, tallyLedgerName: e.target.value })}
              placeholder="Exact spelling in Tally" className="input font-mono text-xs" />
          </Field>
          <Field label="Status">
            <select value={(draft.status || 'ACTIVE') as string}
              onChange={(e) => setDraft({ ...draft, status: e.target.value })} className="input">
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
              <option value="DELETED">Deleted</option>
            </select>
          </Field>
          <Field label="Register Group">
            <select value={draft.registerGroup || ''}
              onChange={(e) => setDraft({ ...draft, registerGroup: e.target.value || null })} className="input">
              <option value="">None</option>
              <option value="KSI-1">KSI-1</option>
              <option value="KSI-2">KSI-2</option>
            </select>
          </Field>
          <Field label="Notes" full>
            <textarea value={draft.notes || ''} onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              rows={2} className="input" />
          </Field>
          {mode === 'edit' && draft.id && (
            <div className="md:col-span-2">
              <SalaryHistory key={draft.id} staffId={draft.id} />
            </div>
          )}
        </div>
        {error && <div className="px-4 py-2 text-sm bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300">{error}</div>}
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <button onClick={onClose} disabled={saving}
            className="text-sm px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600">Cancel</button>
          <button onClick={onSave} disabled={saving || !draft.code?.trim() || !draft.name?.trim() || ageWarn || aadharWarn}
            className="text-sm font-semibold px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white">
            {saving ? 'Saving…' : mode === 'create' ? 'Add Staff' : 'Save Changes'}
          </button>
        </div>
      </div>
      <style jsx>{`
        .input {
          width: 100%;
          padding: 0.4rem 0.6rem;
          border: 1px solid rgb(209 213 219);
          border-radius: 0.375rem;
          font-size: 0.875rem;
          background: white;
        }
        :global(.dark) .input {
          background: rgb(31 41 55);
          border-color: rgb(75 85 99);
          color: white;
        }
      `}</style>
    </div>
  )
}

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <div className={full ? 'md:col-span-2' : ''}>
      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{label}</label>
      {children}
    </div>
  )
}

// Salary History — lazy-loads the staff's revision log when the edit modal
// opens. Shows when / which salary / old→new / % for each change.
function SalaryHistory({ staffId }: { staffId: string }) {
  const [revs, setRevs] = useState<SalaryRevision[] | null>(null)
  const [loading, setLoading] = useState(true)

  // Component is keyed by staffId at the call site, so it mounts fresh per
  // staff — `loading` starts true and we just fetch once here.
  useEffect(() => {
    let alive = true
    fetch(`/api/payroll/staff/${staffId}/revisions`)
      .then((r) => r.json())
      .then((d) => { if (alive) setRevs(Array.isArray(d) ? d : []) })
      .catch(() => { if (alive) setRevs([]) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [staffId])

  return (
    <div className="mt-1 border-t border-gray-200 dark:border-gray-700 pt-3">
      <h3 className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2">Salary History</h3>
      {loading && <p className="text-xs text-gray-400">Loading…</p>}
      {!loading && revs && revs.length === 0 && <p className="text-xs text-gray-400">No salary changes recorded yet.</p>}
      {!loading && revs && revs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500">
                <th className="px-2 py-1 text-left">Date</th>
                <th className="px-2 py-1 text-left">Field</th>
                <th className="px-2 py-1 text-right">Old → New</th>
                <th className="px-2 py-1 text-right">Change</th>
                <th className="px-2 py-1 text-left">Month</th>
              </tr>
            </thead>
            <tbody>
              {revs.map((r) => {
                const up = r.deltaAmount >= 0
                return (
                  <tr key={r.id} className="border-t border-gray-100 dark:border-gray-800">
                    <td className="px-2 py-1 text-gray-600 dark:text-gray-400">{new Date(r.changedAt).toLocaleDateString('en-IN')}</td>
                    <td className="px-2 py-1">
                      <span className={`badge text-[10px] ${r.field === 'REGISTER' ? 'badge-blue' : 'badge-gray'}`}>
                        {r.field === 'REGISTER' ? 'Register' : 'Actual'}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-right font-mono">₹{r.oldValue.toLocaleString('en-IN')} → ₹{r.newValue.toLocaleString('en-IN')}</td>
                    <td className={`px-2 py-1 text-right font-semibold ${up ? 'text-emerald-600' : 'text-red-600'}`}>
                      {up ? '+' : ''}{r.deltaAmount.toLocaleString('en-IN')}
                      {r.oldValue > 0 && <span className="text-[10px] font-normal"> ({up ? '+' : ''}{r.deltaPercent.toFixed(1)}%)</span>}
                    </td>
                    <td className="px-2 py-1 text-gray-500">{r.effectiveMonth}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// Multi-select contractor picker: shows selected as removable chips with
// an "Add contractor" dropdown listing only the unselected ones. Keeps the
// list of ids in sync via onChange.
function ContractorChipPicker({ contractors, selected, onChange }: {
  contractors: Contractor[]
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  const selectedSet = new Set(selected)
  const available = contractors.filter((c) => !selectedSet.has(c.id))
  return (
    <div className="flex flex-wrap items-center gap-1">
      {selected.map((id) => {
        const c = contractors.find((x) => x.id === id)
        if (!c) return null
        return (
          <span key={id} className="badge badge-blue text-[10px] flex items-center gap-1">
            {c.name}
            <button onClick={() => onChange(selected.filter((x) => x !== id))}
              className="font-bold hover:text-red-700" title="Remove">×</button>
          </span>
        )
      })}
      {available.length > 0 && (
        <select value="" onChange={(e) => { if (e.target.value) onChange([...selected, e.target.value]) }}
          className="px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 rounded text-[10px] bg-white dark:bg-gray-800">
          <option value="">+ add contractor</option>
          {available.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}
    </div>
  )
}
