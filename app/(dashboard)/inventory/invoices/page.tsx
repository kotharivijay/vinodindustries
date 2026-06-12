'use client'

import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import BackButton from '../../BackButton'

const fetcher = (url: string) => fetch(url).then(r => r.json())

type Tab = 'invoices' | 'drafts'

// Sort + filter state persists across navigations so the operator can
// drill into an invoice and come back to the same view. sessionStorage
// (not localStorage) — tab-scoped, doesn't bleed across browser windows.
const STATE_KEY = 'purchase-invoices.state'
type SortBy = 'supplierInvoiceNo' | 'supplierInvoiceDate' | 'partyName' | 'lines' | 'totalAmount' | 'status' | 'gstTreatment'
type SortDir = 'asc' | 'desc'
interface FilterState {
  search: string
  party: string
  gst: string         // '' | 'NONE' | 'CGST_SGST' | 'IGST'
  status: string      // '' | 'Draft' | 'Verified' | 'PushPending' | 'PushedToTally' | 'Voided'
  sortBy: SortBy
  sortDir: SortDir
}
const DEFAULT_STATE: FilterState = {
  search: '', party: '', gst: '', status: '',
  sortBy: 'supplierInvoiceDate', sortDir: 'desc',
}

function loadState(): FilterState {
  if (typeof window === 'undefined') return DEFAULT_STATE
  try {
    const raw = sessionStorage.getItem(STATE_KEY)
    if (!raw) return DEFAULT_STATE
    return { ...DEFAULT_STATE, ...JSON.parse(raw) }
  } catch { return DEFAULT_STATE }
}

const STATUS_TONES: Record<string, string> = {
  PushedToTally: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  Voided: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  PushPending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  Verified: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  Draft: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
}
const GST_VALUES = ['CGST_SGST', 'IGST', 'NONE']
const STATUS_VALUES = ['Draft', 'Verified', 'PushPending', 'PushedToTally', 'Voided']

export default function InvoiceListPage() {
  const [tab, setTab] = useState<Tab>('invoices')
  const { data: invoices } = useSWR<any[]>(tab === 'invoices' ? '/api/inv/invoices' : null, fetcher)
  const { data: drafts } = useSWR<any[]>(tab === 'drafts' ? '/api/inv/invoice-drafts' : null, fetcher)
  const { data: draftsForCount } = useSWR<any[]>('/api/inv/invoice-drafts', fetcher)
  const draftCount = draftsForCount?.length ?? 0

  // Hydrated from sessionStorage on mount, persisted on every change.
  const [state, setState] = useState<FilterState>(DEFAULT_STATE)
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => { setState(loadState()); setHydrated(true) }, [])
  useEffect(() => {
    if (!hydrated) return
    try { sessionStorage.setItem(STATE_KEY, JSON.stringify(state)) } catch {}
  }, [state, hydrated])

  function update<K extends keyof FilterState>(k: K, v: FilterState[K]) {
    setState(prev => ({ ...prev, [k]: v }))
  }
  function clickHeader(col: SortBy) {
    setState(prev => prev.sortBy === col
      ? { ...prev, sortDir: prev.sortDir === 'asc' ? 'desc' : 'asc' }
      : { ...prev, sortBy: col, sortDir: 'asc' })
  }
  function resetFilters() {
    setState(prev => ({ ...DEFAULT_STATE, sortBy: prev.sortBy, sortDir: prev.sortDir }))
  }

  // Distinct party list for the dropdown — derived, not fetched separately.
  const partyOptions = useMemo(() => {
    const set = new Set<string>()
    for (const inv of invoices || []) if (inv.party?.displayName) set.add(inv.party.displayName)
    return Array.from(set).sort()
  }, [invoices])

  // Apply filters + sort. Empty filter strings are no-ops.
  const visibleInvoices = useMemo(() => {
    if (!invoices) return []
    const search = state.search.trim().toLowerCase()
    let rows = invoices.filter((inv: any) => {
      if (search && !String(inv.supplierInvoiceNo || '').toLowerCase().includes(search)) return false
      if (state.party && inv.party?.displayName !== state.party) return false
      if (state.gst && inv.gstTreatment !== state.gst) return false
      if (state.status && inv.status !== state.status) return false
      return true
    })
    const dir = state.sortDir === 'asc' ? 1 : -1
    const getKey = (inv: any) => {
      switch (state.sortBy) {
        case 'supplierInvoiceNo': return String(inv.supplierInvoiceNo || '').toLowerCase()
        case 'supplierInvoiceDate': return new Date(inv.supplierInvoiceDate || 0).getTime()
        case 'partyName': return String(inv.party?.displayName || '').toLowerCase()
        case 'lines': return Number(inv._count?.lines || 0)
        case 'totalAmount': return Number(inv.totalAmount || 0)
        case 'gstTreatment': return String(inv.gstTreatment || '')
        case 'status': return String(inv.status || '')
      }
    }
    rows = [...rows].sort((a, b) => {
      const ak = getKey(a), bk = getKey(b)
      if (ak < bk) return -1 * dir
      if (ak > bk) return 1 * dir
      return 0
    })
    return rows
  }, [invoices, state])

  const hasActiveFilter = state.search || state.party || state.gst || state.status
  const totalCount = invoices?.length ?? 0

  return (
    <div className="p-4 md:p-8 max-w-5xl">
      <div className="flex items-center gap-3 mb-3">
        <BackButton />
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Purchase Invoices</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {tab === 'invoices'
              ? (hasActiveFilter ? `${visibleInvoices.length} of ${totalCount}` : `${totalCount} invoices`)
              : `${drafts?.length || 0} open drafts`}
          </p>
        </div>
        {tab === 'invoices' ? (
          <>
            <Link href="/inventory/invoices/drafts/new"
              className="bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700 px-3 py-2 rounded-lg text-xs font-semibold">
              + New Draft
            </Link>
            <Link href="/inventory/invoices/new"
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-semibold">
              + New Invoice
            </Link>
          </>
        ) : (
          <Link href="/inventory/invoices/drafts/new"
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-semibold">
            + New Draft
          </Link>
        )}
      </div>

      <div className="flex gap-1 mb-4 border-b border-gray-200 dark:border-gray-700">
        {([
          ['invoices', 'Invoices'],
          ['drafts', `Drafts${draftCount > 0 ? ` (${draftCount})` : ''}`],
        ] as [Tab, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition ${
              tab === k
                ? 'border-indigo-600 text-indigo-700 dark:text-indigo-300'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'invoices' && (
        <>
          {/* Filter bar — search box + party dropdown + GST/Status chips + Reset.
              State persists in sessionStorage so the same view is restored
              after drilling into a detail page. */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 mb-3 space-y-2">
            <div className="flex flex-wrap gap-2 items-center">
              <input
                type="search"
                value={state.search}
                onChange={e => update('search', e.target.value)}
                placeholder="Search invoice no…"
                className="flex-1 min-w-[180px] px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs"
              />
              <select
                value={state.party}
                onChange={e => update('party', e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs min-w-[160px]"
              >
                <option value="">All parties</option>
                {partyOptions.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              {hasActiveFilter && (
                <button onClick={resetFilters}
                  className="text-[11px] text-rose-600 dark:text-rose-400 hover:underline px-2">
                  Reset
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <span className="text-[10px] text-gray-500 dark:text-gray-400 self-center mr-1">GST:</span>
              <FilterChip active={state.gst === ''} onClick={() => update('gst', '')}>All</FilterChip>
              {GST_VALUES.map(g => (
                <FilterChip key={g} active={state.gst === g} onClick={() => update('gst', g)}>{g}</FilterChip>
              ))}
              <span className="text-[10px] text-gray-500 dark:text-gray-400 self-center ml-3 mr-1">Status:</span>
              <FilterChip active={state.status === ''} onClick={() => update('status', '')}>All</FilterChip>
              {STATUS_VALUES.map(s => (
                <FilterChip key={s} active={state.status === s} onClick={() => update('status', s)}>{s}</FilterChip>
              ))}
            </div>
          </div>

          {!visibleInvoices.length ? (
            <div className="p-12 text-center text-gray-400">
              {hasActiveFilter ? 'No invoices match the filter.' : 'No invoices yet.'}
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300">
                  <tr>
                    <SortHeader col="supplierInvoiceNo" state={state} onClick={clickHeader}>Invoice No</SortHeader>
                    <SortHeader col="supplierInvoiceDate" state={state} onClick={clickHeader}>Date</SortHeader>
                    <SortHeader col="partyName" state={state} onClick={clickHeader}>Party</SortHeader>
                    <SortHeader col="gstTreatment" state={state} onClick={clickHeader}>GST</SortHeader>
                    <SortHeader col="lines" state={state} onClick={clickHeader} align="right">Lines</SortHeader>
                    <SortHeader col="totalAmount" state={state} onClick={clickHeader} align="right">Total</SortHeader>
                    <SortHeader col="status" state={state} onClick={clickHeader}>Status</SortHeader>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {visibleInvoices.map((inv: any) => (
                    <tr key={inv.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                      <td className="px-3 py-1.5"><Link href={`/inventory/invoices/${inv.id}`} className="text-indigo-600 dark:text-indigo-400 font-mono hover:underline">{inv.supplierInvoiceNo}</Link></td>
                      <td className="px-3 py-1.5 text-gray-500">{new Date(inv.supplierInvoiceDate).toLocaleDateString('en-IN')}</td>
                      <td className="px-3 py-1.5 text-gray-700 dark:text-gray-200">{inv.party?.displayName}</td>
                      <td className="px-3 py-1.5"><span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300">{inv.gstTreatment}</span></td>
                      <td className="px-3 py-1.5 text-right text-gray-500">{inv._count?.lines}</td>
                      <td className="px-3 py-1.5 text-right text-gray-700 dark:text-gray-200 font-semibold">₹{Number(inv.totalAmount || 0).toLocaleString('en-IN')}</td>
                      <td className="px-3 py-1.5"><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${STATUS_TONES[inv.status] || STATUS_TONES.Draft}`}>{inv.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'drafts' && (
        !drafts?.length ? <div className="p-12 text-center text-gray-400">No open drafts. Create one to preview an invoice before finalising.</div>
          : (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300">
                <tr>
                  <th className="px-3 py-2 text-left">Draft #</th>
                  <th className="px-3 py-2 text-left">Updated</th>
                  <th className="px-3 py-2 text-left">Party</th>
                  <th className="px-3 py-2 text-left">GST</th>
                  <th className="px-3 py-2 text-right">Challans</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-left">Flags</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {drafts.map((d: any) => (
                  <tr key={d.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                    <td className="px-3 py-1.5"><Link href={`/inventory/invoices/drafts/${d.id}`} className="text-indigo-600 dark:text-indigo-400 font-mono hover:underline">#{d.id}</Link></td>
                    <td className="px-3 py-1.5 text-gray-500">{new Date(d.updatedAt).toLocaleString('en-IN')}</td>
                    <td className="px-3 py-1.5 text-gray-700 dark:text-gray-200">{d.party?.displayName}</td>
                    <td className="px-3 py-1.5">{d.gstTreatment && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300">{d.gstTreatment}</span>}</td>
                    <td className="px-3 py-1.5 text-right text-gray-500">{(d.challanIds || []).length}</td>
                    <td className="px-3 py-1.5 text-right text-gray-700 dark:text-gray-200 font-semibold">₹{Number(d.totalAmount || 0).toLocaleString('en-IN')}</td>
                    <td className="px-3 py-1.5">
                      {d.hasPendingReviewItems && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">Review</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  )
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border transition ${
        active
          ? 'bg-indigo-600 border-indigo-600 text-white'
          : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
      }`}>
      {children}
    </button>
  )
}

// Sortable column header. Clicking toggles asc/desc on this column;
// switching columns resets to asc.
function SortHeader({
  col, state, onClick, align = 'left', children,
}: {
  col: SortBy
  state: FilterState
  onClick: (col: SortBy) => void
  align?: 'left' | 'right'
  children: React.ReactNode
}) {
  const isActive = state.sortBy === col
  const arrow = isActive ? (state.sortDir === 'asc' ? '↑' : '↓') : ''
  return (
    <th className={`px-3 py-2 ${align === 'right' ? 'text-right' : 'text-left'} select-none`}>
      <button onClick={() => onClick(col)}
        className={`inline-flex items-center gap-1 hover:text-indigo-600 dark:hover:text-indigo-400 ${
          isActive ? 'text-indigo-700 dark:text-indigo-300' : ''
        }`}>
        {children}
        {arrow && <span className="text-[9px]">{arrow}</span>}
      </button>
    </th>
  )
}
