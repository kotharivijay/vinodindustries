'use client'

import { useState, useMemo, useEffect } from 'react'
import useSWR from 'swr'
import BackButton from '../../BackButton'

const fetcher = (url: string) => fetch(url).then(r => r.json())

type SortBy = 'date-desc' | 'date-asc' | 'party-asc' | 'party-desc' | 'amount-desc' | 'amount-asc'
const SORT_OPTIONS: [SortBy, string][] = [
  ['date-desc', 'Date ↓'], ['date-asc', 'Date ↑'],
  ['party-asc', 'Party A→Z'], ['party-desc', 'Party Z→A'],
  ['amount-desc', 'Amount ↓'], ['amount-asc', 'Amount ↑'],
]

interface Line {
  id: number; lineNo: number; stockItem: string
  rawQty: string | null; qty: number | null; unit: string | null
  altQty: number | null; altUnit: string | null
  rate: number | null; rateUnit: string | null
  amount: number; discountPct: number | null; baleNo: string | null
}
interface Ledger { id: number; ledgerName: string; amount: number; isDeemedPositive: boolean }
interface Invoice {
  id: number; fy: string; date: string; vchNumber: string; vchType: string
  partyName: string; partyGstin: string | null
  totalAmount: number; taxableAmount: number | null
  cgstAmount: number | null; sgstAmount: number | null; igstAmount: number | null; roundOff: number | null
  narration: string | null; reference: string | null; buyerPO: string | null
  transporter: string | null; agentName: string | null
  // True when the row was added manually as a prior-FY opening balance
  // (via the + Opening Balance modal). Marked with an OB badge in the UI.
  isOpeningBalance?: boolean
  lines: Line[]; ledgers: Ledger[]
}
interface FyTotal { fy: string; count: number; total: number }
interface CatRow { ledgerName: string; occurrences: number; totalSigned: number; category: string | null; note: string | null }

const fmtMoney = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (iso: string) => {
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}-${d.toLocaleString('en-IN', { month: 'short' })}-${String(d.getFullYear()).slice(2)}`
}

// Two derived figures per voucher:
//   Net Sales       = max(items, sales-ledger) + extras − discounts        (revenue recognised, ex-tax)
//   Net Payment Ask = max(items, sales-ledger) + tax + extras − discounts  (customer's payable)
// Tax = sum of CGST + SGST + IGST on the voucher. Round-off is shown
// separately because it's a balancing entry, not a charge.
function computeNet(inv: Invoice, catMap: Record<string, string>): {
  itemSum: number; salesLedger: number; gross: number; extras: number; discount: number; tax: number; net: number; paymentAsk: number
} {
  const itemSum = inv.lines.reduce((s, l) => s + l.amount, 0)
  let salesLedger = 0, extras = 0, discount = 0
  for (const led of inv.ledgers) {
    const cat = catMap[led.ledgerName.toLowerCase()]
    const abs = Math.abs(led.amount)
    if (cat === 'sales') salesLedger += abs
    else if (cat === 'extra-charge') extras += abs
    else if (cat === 'discount') discount += abs
  }
  const gross = Math.max(itemSum, salesLedger)
  const tax = (inv.cgstAmount || 0) + (inv.sgstAmount || 0) + (inv.igstAmount || 0)
  const net = gross + extras - discount
  const paymentAsk = net + tax
  return { itemSum, salesLedger, gross, extras, discount, tax, net, paymentAsk }
}

export default function SalesPage() {
  const [activeFy, setActiveFy] = useState<string>('26-27')
  const [tab, setTab] = useState<'vouchers' | 'categorise'>('vouchers')
  const [obModalOpen, setObModalOpen] = useState(false)
  // Voucher-type filter — adds tabs above the voucher list so users can
  // jump between Process Job / Sales / Credit Note (or see all).
  const [vchTypeFilter, setVchTypeFilter] = useState<string>('all')
  const KNOWN_VCH_TYPES = ['Process Job', 'Sales', 'Credit Note']
  const [sortBy, setSortBy] = useState<SortBy>('date-desc')
  const [filterMode, setFilterMode] = useState<'fy' | 'month' | 'range'>('fy')
  const [pickedMonth, setPickedMonth] = useState<string>('')
  const [rangeFrom, setRangeFrom] = useState<string>('')
  const [rangeTo, setRangeTo] = useState<string>('')
  const [partySearch, setPartySearch] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const [syncLog, setSyncLog] = useState<string[]>([])

  const { data, mutate, isLoading } = useSWR<{ invoices: Invoice[]; fyTotals: FyTotal[]; categoryMap: Record<string, string> }>(
    `/api/accounts/sales?fy=${activeFy}`, fetcher,
  )
  const fyTotals = data?.fyTotals ?? []
  const fyMap = useMemo(() => new Map(fyTotals.map(f => [f.fy, f])), [fyTotals])
  const catMap = data?.categoryMap ?? {}

  const monthOptions = useMemo(() => {
    const startYear = 2000 + parseInt(activeFy.split('-')[0])
    const months: { value: string; label: string }[] = []
    for (let i = 0; i < 12; i++) {
      const y = i < 9 ? startYear : startYear + 1
      const m = ((i + 3) % 12) + 1
      months.push({ value: `${y}-${String(m).padStart(2, '0')}`, label: `${new Date(y, m - 1).toLocaleString('en-IN', { month: 'short' })} ${String(y).slice(2)}` })
    }
    return months
  }, [activeFy])

  // Counts per vchType (across the full FY result, before other
  // filters) so the tab labels show stable totals.
  const vchTypeCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const inv of data?.invoices ?? []) {
      counts[inv.vchType] = (counts[inv.vchType] || 0) + 1
    }
    return counts
  }, [data?.invoices])

  const rows = useMemo(() => {
    let filtered = data?.invoices ?? []
    if (vchTypeFilter !== 'all') {
      filtered = filtered.filter(r => r.vchType === vchTypeFilter)
    }
    if (filterMode === 'month' && pickedMonth) {
      const [y, m] = pickedMonth.split('-').map(Number)
      const start = new Date(y, m - 1, 1).getTime()
      const end = new Date(y, m, 0, 23, 59, 59).getTime()
      filtered = filtered.filter(r => { const t = new Date(r.date).getTime(); return t >= start && t <= end })
    } else if (filterMode === 'range' && rangeFrom && rangeTo) {
      const start = new Date(rangeFrom + 'T00:00:00').getTime()
      const end = new Date(rangeTo + 'T23:59:59').getTime()
      filtered = filtered.filter(r => { const t = new Date(r.date).getTime(); return t >= start && t <= end })
    }
    if (partySearch.trim()) {
      const q = partySearch.trim().toLowerCase()
      filtered = filtered.filter(r => r.partyName.toLowerCase().includes(q))
    }
    const dateKey = (r: Invoice) => new Date(r.date).getTime()
    const sorted = [...filtered]
    switch (sortBy) {
      case 'date-desc':   sorted.sort((a, b) => dateKey(b) - dateKey(a) || b.id - a.id); break
      case 'date-asc':    sorted.sort((a, b) => dateKey(a) - dateKey(b) || a.id - b.id); break
      case 'party-asc':   sorted.sort((a, b) => a.partyName.localeCompare(b.partyName) || dateKey(b) - dateKey(a)); break
      case 'party-desc':  sorted.sort((a, b) => b.partyName.localeCompare(a.partyName) || dateKey(b) - dateKey(a)); break
      case 'amount-desc': sorted.sort((a, b) => b.totalAmount - a.totalAmount || dateKey(b) - dateKey(a)); break
      case 'amount-asc':  sorted.sort((a, b) => a.totalAmount - b.totalAmount || dateKey(b) - dateKey(a)); break
    }
    return sorted
  }, [data?.invoices, sortBy, filterMode, pickedMonth, rangeFrom, rangeTo, partySearch, vchTypeFilter])

  // Auto-detect well-known ledgers (CGST/SGST/IGST/round-off/party) so the
  // user doesn't have to tag every voucher's tax lines. Doesn't write to
  // the DB — explicit classification still wins.
  const effectiveCatMap = useMemo(() => {
    const out = { ...catMap }
    for (const inv of data?.invoices ?? []) {
      for (const led of inv.ledgers) {
        const lname = led.ledgerName.toLowerCase()
        if (out[lname]) continue
        if (/cgst|sgst|utgst|igst/.test(lname)) out[lname] = 'tax'
        else if (/round\s*off|roundoff|rounding/.test(lname)) out[lname] = 'roundoff'
        else if (lname === inv.partyName.toLowerCase()) out[lname] = 'party'
      }
    }
    return out
  }, [catMap, data?.invoices])

  const filteredTotals = useMemo(() => {
    let gross = 0, extras = 0, discount = 0, net = 0, tax = 0, paymentAsk = 0
    for (const inv of rows) {
      const c = computeNet(inv, effectiveCatMap)
      gross += c.gross; extras += c.extras; discount += c.discount
      net += c.net; tax += c.tax; paymentAsk += c.paymentAsk
    }
    return { gross, extras, discount, net, tax, paymentAsk, count: rows.length }
  }, [rows, effectiveCatMap])

  async function syncFy(fy: string) {
    setSyncing(true); setSyncMsg(''); setSyncLog([])
    const startYear = 2000 + parseInt(fy.split('-')[0])
    const endYear = startYear + 1
    const fyEndDate = new Date(endYear, 2, 31) // March 31 of end year
    const todayMs = Date.now()
    const endDate = fyEndDate.getTime() < todayMs ? fyEndDate : new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00')

    // Build per-month chunks so each /ksi-sales-sync call stays well
    // under Vercel's serverless timeout (3 Tally calls + ~80 upserts
    // per month is comfortable).
    const chunks: { from: string; to: string; label: string }[] = []
    let cur = new Date(startYear, 3, 1) // April 1 of start year
    while (cur.getTime() <= endDate.getTime()) {
      const monthEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0)
      const chunkEnd = monthEnd.getTime() > endDate.getTime() ? endDate : monthEnd
      const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const label = cur.toLocaleString('en-IN', { month: 'short' }) + ' ' + String(cur.getFullYear()).slice(2)
      chunks.push({ from: iso(cur), to: iso(chunkEnd), label })
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
    }
    const log = (line: string) => setSyncLog(prev => [...prev, line])
    log(`▶ FY ${fy} · ${chunks.length} months to sync`)

    let totalSaved = 0, totalFetched = 0, totalPruned = 0
    try {
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i]
        const startedAt = Date.now()
        setSyncMsg(`Syncing ${c.label} (${i + 1}/${chunks.length})…`)
        const res = await fetch('/api/tally/ksi-sales-sync', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: c.from, to: c.to }),
        })
        const d = await res.json()
        const sec = ((Date.now() - startedAt) / 1000).toFixed(1)
        if (!res.ok) {
          log(`✗ ${c.label}  ${sec}s  ${d.error || res.statusText}`)
          setSyncMsg(`Failed at ${c.label}: ${d.error || res.statusText}. Partial: ${totalSaved}/${totalFetched}.`)
          mutate()
          return
        }
        const pruneSuffix = d.prunedCount ? `  ·  pruned ${d.prunedCount}` : ''
        log(`✓ ${c.label}  ${sec}s  ${d.saved}/${d.fetched} invoices${pruneSuffix}`)
        totalSaved += d.saved || 0
        totalFetched += d.fetched || 0
        totalPruned += d.prunedCount || 0
      }
      const pruneSummary = totalPruned ? ` · pruned ${totalPruned} Tally-deleted` : ''
      log(`✅ Done · ${totalSaved}/${totalFetched} invoices across ${chunks.length} months${pruneSummary}`)
      setSyncMsg(`Synced ${totalSaved}/${totalFetched} invoices across ${chunks.length} months${pruneSummary}`)
      mutate()
    } catch (e: any) {
      log(`✗ Network error: ${e?.message || 'unknown'}`)
      setSyncMsg(`${e?.message || 'Network error'}. Partial: ${totalSaved}/${totalFetched}.`)
      mutate()
    } finally { setSyncing(false) }
  }

  return (
    <div className="max-w-3xl mx-auto p-3 pb-20">
      <div className="flex items-center gap-2 mb-3">
        <BackButton />
        <h1 className="text-base sm:text-lg font-bold text-gray-800 dark:text-gray-100 flex-1">Sales / Process Register</h1>
        <button onClick={() => setObModalOpen(true)}
          className="text-[11px] font-semibold bg-amber-50 dark:bg-amber-900/30 hover:bg-amber-100 dark:hover:bg-amber-900/50 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700 px-2.5 py-1.5 rounded-lg whitespace-nowrap">
          + Opening Balance
        </button>
      </div>

      {obModalOpen && (
        <OpeningBalanceModal
          onClose={() => setObModalOpen(false)}
          onSaved={() => { setObModalOpen(false); mutate() }}
        />
      )}

      {/* FY tabs */}
      <div className="flex gap-2 mb-3">
        {[{ fy: '25-26', label: 'FY 25-26' }, { fy: '26-27', label: 'FY 26-27' }].map(t => {
          const total = fyMap.get(t.fy)
          const isActive = activeFy === t.fy
          return (
            <button key={t.fy} onClick={() => setActiveFy(t.fy)}
              className={`flex-1 px-3 py-2 rounded-xl text-xs font-semibold border transition ${
                isActive ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300'
              }`}>
              <div>{t.label}</div>
              {total && <div className={`text-[10px] mt-0.5 ${isActive ? 'text-indigo-50' : 'text-gray-500'}`}>{total.count} · ₹{fmtMoney(total.total)}</div>}
            </button>
          )
        })}
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-2 mb-3 border-b border-gray-200 dark:border-gray-700">
        {([['vouchers', '📄 Vouchers'], ['categorise', '🏷 Categorise Ledgers']] as const).map(([k, lbl]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition ${
              tab === k ? 'border-indigo-600 text-indigo-700 dark:text-indigo-400' : 'border-transparent text-gray-500 dark:text-gray-400'
            }`}>
            {lbl}
          </button>
        ))}
      </div>

      {/* Voucher-type tabs — only meaningful when the Vouchers sub-tab
         is active. Shows count per type across the active FY. */}
      {tab === 'vouchers' && (
        <div className="flex gap-1.5 mb-3 flex-wrap text-[11px]">
          <button onClick={() => setVchTypeFilter('all')}
            className={`px-2.5 py-1 rounded-full border font-semibold transition ${
              vchTypeFilter === 'all'
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'
            }`}>
            All ({data?.invoices?.length ?? 0})
          </button>
          {KNOWN_VCH_TYPES.map(t => (
            <button key={t} onClick={() => setVchTypeFilter(t)}
              className={`px-2.5 py-1 rounded-full border font-semibold transition ${
                vchTypeFilter === t
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'
              }`}>
              {t} ({vchTypeCounts[t] ?? 0})
            </button>
          ))}
        </div>
      )}

      {tab === 'vouchers' ? (
        <VouchersView
          rows={rows}
          isLoading={isLoading}
          activeFy={activeFy}
          syncing={syncing}
          syncMsg={syncMsg}
          syncLog={syncLog}
          syncFy={syncFy}
          sortBy={sortBy} setSortBy={setSortBy}
          filterMode={filterMode} setFilterMode={setFilterMode}
          pickedMonth={pickedMonth} setPickedMonth={setPickedMonth}
          rangeFrom={rangeFrom} setRangeFrom={setRangeFrom}
          rangeTo={rangeTo} setRangeTo={setRangeTo}
          partySearch={partySearch} setPartySearch={setPartySearch}
          monthOptions={monthOptions}
          totals={filteredTotals}
          catMap={effectiveCatMap}
        />
      ) : (
        <CategoriseView onChanged={() => mutate()} />
      )}
    </div>
  )
}

function VouchersView(props: any) {
  const { rows, isLoading, activeFy, syncing, syncMsg, syncLog, syncFy, sortBy, setSortBy,
    filterMode, setFilterMode, pickedMonth, setPickedMonth, rangeFrom, setRangeFrom,
    rangeTo, setRangeTo, partySearch, setPartySearch, monthOptions, totals, catMap } = props
  return (
    <>
      {/* Date filter */}
      <div className="flex items-center gap-1.5 mb-2 flex-wrap text-[11px]">
        <span className="text-gray-500 mr-0.5">Show:</span>
        {([['fy', 'Whole FY'], ['month', 'Month'], ['range', 'Range']] as const).map(([k, lbl]) => (
          <button key={k} onClick={() => setFilterMode(k)}
            className={`px-2.5 py-1 rounded-full border transition ${filterMode === k ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'}`}>
            {lbl}
          </button>
        ))}
        {filterMode === 'month' && (
          <select value={pickedMonth} onChange={(e: any) => setPickedMonth(e.target.value)}
            className="px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-[11px]">
            <option value="">Select…</option>
            {monthOptions.map((m: any) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        )}
        {filterMode === 'range' && (
          <>
            <input type="date" value={rangeFrom} onChange={(e: any) => setRangeFrom(e.target.value)} className="px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-[11px]" />
            <span className="text-gray-400">→</span>
            <input type="date" value={rangeTo} onChange={(e: any) => setRangeTo(e.target.value)} className="px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-[11px]" />
          </>
        )}
      </div>

      {/* Sync + party search */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <button onClick={() => syncFy(activeFy)} disabled={syncing}
          className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold">
          {syncing ? 'Syncing…' : `Sync FY ${activeFy} from Tally`}
        </button>
        <input value={partySearch} onChange={(e: any) => setPartySearch(e.target.value)} placeholder="Filter by party…"
          className="flex-1 min-w-[140px] px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs" />
      </div>
      {syncMsg && <div className="text-[11px] text-gray-500 mb-2">{syncMsg}</div>}
      {syncLog && syncLog.length > 0 && (
        <div className="mb-3 max-h-44 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-2 font-mono text-[10px] leading-tight space-y-0.5">
          {syncLog.map((line: string, i: number) => {
            const color = line.startsWith('✗') ? 'text-rose-600 dark:text-rose-400'
              : line.startsWith('✓') ? 'text-emerald-700 dark:text-emerald-400'
              : line.startsWith('✅') ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
              : line.startsWith('▶') ? 'text-indigo-600 dark:text-indigo-400 font-semibold'
              : 'text-gray-600 dark:text-gray-400'
            return <div key={i} className={color}>{line}</div>
          })}
        </div>
      )}

      {/* Sort pills */}
      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        <span className="text-[10px] text-gray-500 mr-1">Sort:</span>
        {SORT_OPTIONS.map(([k, lbl]) => (
          <button key={k} onClick={() => setSortBy(k)}
            className={`text-[11px] px-2.5 py-1 rounded-full border transition ${sortBy === k ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'}`}>
            {lbl}
          </button>
        ))}
      </div>

      {/* Headline totals */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 mb-3 text-center text-[10px]">
        <Stat label="Vouchers" value={String(totals.count)} />
        <Stat label="Gross" value={`₹${fmtMoney(totals.gross)}`} />
        <Stat label="Extras" value={`₹${fmtMoney(totals.extras)}`} tone="amber" />
        <Stat label="Discounts" value={`₹${fmtMoney(totals.discount)}`} tone="rose" />
        <Stat label="Net Sales" value={`₹${fmtMoney(totals.net)}`} tone="emerald" />
        <Stat label="Payment Ask" value={`₹${fmtMoney(totals.paymentAsk)}`} tone="indigo" />
      </div>

      {/* Voucher cards */}
      {isLoading && <div className="text-center py-8 text-gray-400 text-sm">Loading…</div>}
      {!isLoading && rows.length === 0 && (
        <div className="text-center py-8 text-gray-500 text-sm">No vouchers in FY {activeFy}. Tap Sync.</div>
      )}
      <div className="space-y-2">
        {rows.map((inv: Invoice) => <VoucherCard key={inv.id} inv={inv} catMap={catMap} />)}
      </div>
    </>
  )
}

function VoucherCard({ inv, catMap }: { inv: Invoice; catMap: Record<string, string> }) {
  const c = computeNet(inv, catMap)
  const groups: Record<string, { ledger: string; amount: number }[]> = {
    sales: [], 'extra-charge': [], discount: [], tax: [], roundoff: [], party: [], ignore: [], unmapped: [],
  }
  for (const led of inv.ledgers) {
    const cat = catMap[led.ledgerName.toLowerCase()]
    if (cat && groups[cat]) groups[cat].push({ ledger: led.ledgerName, amount: Math.abs(led.amount) })
    else groups['unmapped'].push({ ledger: led.ledgerName, amount: Math.abs(led.amount) })
  }

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300">
              {inv.vchType} {inv.vchNumber}
            </span>
            {inv.isOpeningBalance && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700" title="Manual opening-balance entry — Tally sync won't overwrite it">
                OB
              </span>
            )}
            <span className="text-[10px] text-gray-500">{fmtDate(inv.date)}</span>
          </div>
          <div className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">{inv.partyName}</div>
          {inv.partyGstin && <div className="text-[10px] text-gray-500 dark:text-gray-400 font-mono">{inv.partyGstin}</div>}
        </div>
        <div className="text-right shrink-0 leading-tight">
          <div className="text-base font-bold text-indigo-700 dark:text-indigo-400 tabular-nums" title="Net Payment Ask = Items + Tax + Extras − Discount">
            ₹{fmtMoney(c.paymentAsk)}
          </div>
          <div className="text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold" title="Net Sales = Items + Extras − Discount (ex-tax)">
            net sales ₹{fmtMoney(c.net)}
          </div>
          {Math.abs(c.paymentAsk - inv.totalAmount) > 1 && (
            <div className="text-[10px] text-amber-600 dark:text-amber-400" title="Difference between computed Payment Ask and Tally voucher total — usually round-off or unmapped extras/discounts">
              tally ₹{fmtMoney(inv.totalAmount)} (Δ {(c.paymentAsk - inv.totalAmount).toFixed(2)})
            </div>
          )}
        </div>
      </div>

      {/* Item lines */}
      {inv.lines.length > 0 && (
        <div className="border-t border-gray-100 dark:border-gray-700 pt-1.5 mt-1.5 space-y-0.5">
          {inv.lines.map(l => (
            <div key={l.id} className="text-[11px] text-gray-700 dark:text-gray-300">
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium truncate">{l.stockItem}</span>
                <span className="shrink-0 text-gray-700 dark:text-gray-200 tabular-nums">₹{fmtMoney(l.amount)}</span>
              </div>
              <div className="text-[10px] text-gray-500 dark:text-gray-400">
                {l.qty != null && (
                  <>
                    {l.qty} {l.unit ?? ''}
                    {l.altQty != null && ` = ${l.altQty} ${l.altUnit ?? ''}`}
                  </>
                )}
                {l.rate != null && <span> · @ ₹{l.rate}{l.rateUnit ? `/${l.rateUnit}` : ''}</span>}
                {l.discountPct != null && l.discountPct > 0 && <span> · disc {l.discountPct}%</span>}
                {l.baleNo && <span> · bale {l.baleNo}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Voucher-level breakdown */}
      <div className="border-t border-gray-100 dark:border-gray-700 pt-1.5 mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-gray-500 dark:text-gray-400">
        {c.itemSum > 0 && <div>Items: <span className="text-gray-700 dark:text-gray-300 tabular-nums">₹{fmtMoney(c.itemSum)}</span></div>}
        {c.salesLedger > 0 && (
          <div>Sales (ledger): <span className="text-gray-700 dark:text-gray-300 tabular-nums">₹{fmtMoney(c.salesLedger)}</span></div>
        )}
        {(inv.cgstAmount || inv.sgstAmount || inv.igstAmount) && (
          <div>Tax: <span className="text-gray-700 dark:text-gray-300 tabular-nums">₹{fmtMoney((inv.cgstAmount || 0) + (inv.sgstAmount || 0) + (inv.igstAmount || 0))}</span></div>
        )}
        {c.extras > 0 && <div className="text-amber-700 dark:text-amber-400">+ Extras: <span className="tabular-nums">₹{fmtMoney(c.extras)}</span></div>}
        {c.discount > 0 && <div className="text-rose-700 dark:text-rose-400">− Discount: <span className="tabular-nums">₹{fmtMoney(c.discount)}</span></div>}
        {(inv.roundOff || 0) !== 0 && <div>Round: <span className="tabular-nums">₹{fmtMoney(inv.roundOff || 0)}</span></div>}
        {(inv.buyerPO || inv.transporter || inv.agentName) && (
          <div className="col-span-2 mt-0.5">
            {inv.buyerPO && <span>PO {inv.buyerPO} </span>}
            {inv.transporter && <span>· Transporter: {inv.transporter} </span>}
            {inv.agentName && <span>· Agent: {inv.agentName}</span>}
          </div>
        )}
      </div>

      {/* Unmapped ledgers — flag so user knows to categorise */}
      {groups.unmapped.length > 0 && (
        <div className="mt-1.5 pt-1.5 border-t border-amber-200 dark:border-amber-700/40 text-[10px]">
          <span className="text-amber-700 dark:text-amber-400 font-semibold">⚠ Unmapped ledgers (Categorise tab):</span>{' '}
          {groups.unmapped.map(g => `${g.ledger} ₹${fmtMoney(g.amount)}`).join(', ')}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'emerald' | 'amber' | 'rose' | 'indigo' }) {
  const colors = tone === 'emerald' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-300'
    : tone === 'amber' ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300'
    : tone === 'rose' ? 'bg-rose-50 dark:bg-rose-900/20 text-rose-800 dark:text-rose-300'
    : tone === 'indigo' ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-800 dark:text-indigo-300'
    : 'bg-gray-50 dark:bg-gray-700/40 text-gray-700 dark:text-gray-200'
  return (
    <div className={`rounded-lg px-2 py-1.5 ${colors}`}>
      <div className="text-[9px] uppercase tracking-wide opacity-80">{label}</div>
      <div className="text-xs font-bold tabular-nums mt-0.5">{value}</div>
    </div>
  )
}

function CategoriseView({ onChanged }: { onChanged: () => void }) {
  const { data, mutate } = useSWR<{ rows: CatRow[] }>('/api/accounts/sales/categories', fetcher)
  const [busy, setBusy] = useState<string | null>(null)

  async function setCategory(ledgerName: string, category: string) {
    setBusy(ledgerName)
    try {
      const res = await fetch('/api/accounts/sales/categories', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ledgerName, category }),
      })
      if (!res.ok) { const d = await res.json(); alert(d.error || 'Failed'); return }
      await mutate()
      onChanged()
    } catch (e: any) { alert(e?.message || 'Network error') }
    finally { setBusy(null) }
  }

  if (!data) return <div className="text-center py-8 text-gray-400 text-sm">Loading ledgers…</div>
  const rows = data.rows

  return (
    <div>
      <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-3">
        Tag each ledger. Net Sales = max(Items, Sales-ledger) + Extra Charges − Discounts.
        Tax / Round-off / Party / Ignore stay out of the calculation.
      </p>
      <div className="space-y-1.5">
        {rows.map(r => (
          <div key={r.ledgerName} className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-lg p-2.5 flex items-center gap-2 flex-wrap">
            <div className="flex-1 min-w-[140px]">
              <div className="text-xs font-semibold text-gray-800 dark:text-gray-100 truncate">{r.ledgerName}</div>
              <div className="text-[10px] text-gray-500">
                {r.occurrences}× · sum ₹{fmtMoney(Math.abs(r.totalSigned))}
              </div>
            </div>
            <div className="flex gap-1 flex-wrap">
              {(['sales', 'extra-charge', 'discount', 'tax', 'roundoff', 'party', 'ignore'] as const).map(c => (
                <button key={c} onClick={() => setCategory(r.ledgerName, c)} disabled={busy === r.ledgerName}
                  className={`text-[10px] px-2 py-1 rounded-full border transition ${
                    r.category === c
                      ? c === 'sales' ? 'bg-emerald-500 text-white border-emerald-500'
                        : c === 'extra-charge' ? 'bg-amber-500 text-white border-amber-500'
                        : c === 'discount' ? 'bg-rose-500 text-white border-rose-500'
                        : c === 'tax' ? 'bg-indigo-500 text-white border-indigo-500'
                        : c === 'roundoff' ? 'bg-sky-500 text-white border-sky-500'
                        : c === 'party' ? 'bg-gray-500 text-white border-gray-500'
                        : 'bg-gray-300 text-gray-700 border-gray-300'
                      : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'
                  }`}>
                  {c}
                </button>
              ))}
            </div>
          </div>
        ))}
        {rows.length === 0 && <div className="text-center py-6 text-gray-400 text-xs">No ledger entries yet — sync first.</div>}
      </div>
    </div>
  )
}

/* ─── Opening Balance modal ────────────────────────────────────────── */
/* Bulk-adds prior-FY invoices for one party. Paste a 3-column block
 * (date | invoice no | amount) — header row optional. Sum-validates
 * against the opening total; Save is only enabled when they match.
 * Tolerates tab / 2+ space / comma separators and common date formats.
 */

interface ParsedRow {
  raw: string
  date: string | null          // ISO yyyy-mm-dd if parsed, else null
  vchNumber: string | null
  amount: number | null
  warning?: string
}

function parseDate(s: string): string | null {
  const t = s.trim()
  if (!t) return null
  // ISO yyyy-mm-dd
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  // dd-MMM-yy / dd-MMM-yyyy
  m = t.match(/^(\d{1,2})[-/\s]([A-Za-z]{3,9})[-/\s](\d{2,4})$/)
  if (m) {
    const mon = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(m[2].slice(0,3).toLowerCase())
    if (mon < 0) return null
    const yyyy = m[3].length === 2 ? '20' + m[3] : m[3]
    return `${yyyy}-${String(mon + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`
  }
  // dd-mm-yy / dd/mm/yyyy / dd.mm.yyyy
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/)
  if (m) {
    const yyyy = m[3].length === 2 ? '20' + m[3] : m[3]
    return `${yyyy}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  }
  return null
}

function parseAmount(s: string): number | null {
  // Strip currency / spaces / commas; allow leading '-' and trailing 'Dr/Cr'.
  const t = s.trim().replace(/[₹,\s]/g, '').replace(/(dr|cr)$/i, '')
  if (!t) return null
  const n = parseFloat(t)
  return Number.isFinite(n) ? n : null
}

function parseBlock(text: string): ParsedRow[] {
  const out: ParsedRow[] = []
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  for (const raw of lines) {
    // Split on tabs, 2+ spaces, or commas.
    const cells = raw.split(/\t+|\s{2,}|,(?=[^\d])/g).map(c => c.trim()).filter(Boolean)
    if (cells.length < 3) {
      // Maybe single-space-separated; fall back to splitting on whitespace
      // but keep at most 3 chunks (date, invNo, amount).
      const tokens = raw.split(/\s+/)
      if (tokens.length < 3) { out.push({ raw, date: null, vchNumber: null, amount: null, warning: 'fewer than 3 columns' }); continue }
      cells.length = 0
      cells.push(tokens[0], tokens.slice(1, -1).join(' '), tokens[tokens.length - 1])
    }
    // Detect header row (all 3 cells non-numeric & include "date"/"invoice"/"amount" keywords).
    const lc = cells.map(c => c.toLowerCase()).join(' ')
    if (/\bdate\b/.test(lc) && /(invoice|inv|bill|vch|voucher)/.test(lc) && /(amount|amt|total)/.test(lc)) continue
    const date = parseDate(cells[0])
    const amount = parseAmount(cells[cells.length - 1])
    const vchNumber = cells.slice(1, -1).join(' ').trim() || null
    out.push({
      raw,
      date,
      vchNumber,
      amount,
      warning: !date ? 'bad date' : !vchNumber ? 'no invoice no' : !Number.isFinite(amount as number) ? 'bad amount' : undefined,
    })
  }
  return out
}

function OpeningBalanceModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { data: partyData } = useSWR<{ parties: string[] }>('/api/accounts/sales/parties', fetcher)
  const parties = partyData?.parties ?? []
  const [partyQ, setPartyQ] = useState('')
  const [partyName, setPartyName] = useState('')
  const [partyOpen, setPartyOpen] = useState(false)
  const [fy, setFy] = useState<string>('24-25')
  const [openingStr, setOpeningStr] = useState('')
  const [pasted, setPasted] = useState('')
  // Purchase + Debit Note are here so the operator can manually record
  // rare same-FY adjustments (e.g. a customer sent an invoice the
  // bookkeeper booked as a Purchase voucher in Tally). Tally sync
  // never pulls Purchase vouchers, so without a manual path these
  // would never reach the webapp's Outstanding / receipt picker.
  const [vchType, setVchType] = useState<'Process Job' | 'Sales' | 'Credit Note' | 'Debit Note' | 'Purchase' | 'Journal'>('Process Job')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Pre-fill from any existing OB rows for the current (party, fy, vchType).
  // Lets the operator edit-in-place instead of re-creating. `dirty` blocks
  // auto-fill once the user has started typing so we don't clobber edits.
  const obKey = partyName && fy && vchType
    ? `/api/accounts/sales/opening-balance?party=${encodeURIComponent(partyName)}&fy=${encodeURIComponent(fy)}&vchType=${encodeURIComponent(vchType)}`
    : null
  const { data: existing } = useSWR<{ entries: Array<{ id: number; date: string; vchNumber: string; amount: number }> }>(obKey, fetcher)
  const existingCount = existing?.entries?.length ?? 0
  const [dirty, setDirty] = useState(false)
  // Whenever the lookup key changes (party/fy/vchType swap) we treat the
  // textarea as fresh again — server data wins until user edits.
  useEffect(() => { setDirty(false) }, [partyName, fy, vchType])
  useEffect(() => {
    if (!existing || dirty) return
    const entries = existing.entries
    if (entries.length === 0) {
      setPasted(''); setOpeningStr(''); return
    }
    const lines = entries.map(e => `${e.date}\t${e.vchNumber}\t${e.amount}`).join('\n')
    setPasted(lines)
    const sum = entries.reduce((s, e) => s + e.amount, 0)
    setOpeningStr(sum.toFixed(2))
  }, [existing, dirty])

  const parsed = useMemo(() => parseBlock(pasted), [pasted])
  const validRows = parsed.filter(r => r.date && r.vchNumber && Number.isFinite(r.amount as number) && !r.warning)
  const parsedSum = validRows.reduce((s, r) => s + (r.amount || 0), 0)
  const opening = Number(openingStr.replace(/[,\s₹]/g, '')) || 0
  const delta = Math.abs(parsedSum - opening)
  const sumOk = opening > 0 && validRows.length > 0 && delta <= 0.01
  const allRowsOk = parsed.length > 0 && parsed.every(r => !r.warning)
  const canSave = !!partyName && !!fy && sumOk && allRowsOk && !saving

  const filteredParties = useMemo(() => {
    const q = partyQ.toLowerCase().trim()
    if (!q) return parties.slice(0, 80)
    return parties.filter(p => p.toLowerCase().includes(q)).slice(0, 80)
  }, [parties, partyQ])

  async function save() {
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/accounts/sales/opening-balance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partyName, fy, vchType,
          openingAmount: opening,
          invoices: validRows.map(r => ({ date: r.date, vchNumber: r.vchNumber, amount: r.amount })),
          // Replace whenever there were already-saved rows for this
          // (party, fy, vchType). Lets the modal serve both fresh-add
          // and in-place-edit flows from the same Save button.
          replace: existingCount > 0,
        }),
      })
      const d = await res.json()
      if (!res.ok) { setError(d?.error || `Save failed (${res.status})`); return }
      onSaved()
    } catch (e: any) {
      setError(e?.message || 'Network error')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-3 overflow-y-auto" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl my-6">
        <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-gray-800 dark:text-gray-100">+ Opening Balance</h3>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">Add prior-FY invoices for a party. Tally sync won&apos;t overwrite these.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg">✕</button>
        </div>

        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs">
              <span className="text-gray-500 dark:text-gray-400">FY</span>
              <select value={fy} onChange={e => setFy(e.target.value)}
                className="mt-0.5 w-full px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm">
                {['20-21','21-22','22-23','23-24','24-25','25-26','26-27'].map(f => <option key={f} value={f}>FY {f}</option>)}
              </select>
            </label>
            <label className="block text-xs">
              <span className="text-gray-500 dark:text-gray-400">Voucher type</span>
              <select value={vchType} onChange={e => setVchType(e.target.value as any)}
                className="mt-0.5 w-full px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm">
                <option>Process Job</option>
                <option>Sales</option>
                <option>Credit Note</option>
                <option>Debit Note</option>
                <option>Purchase</option>
                <option>Journal</option>
              </select>
            </label>
          </div>

          <div className="block text-xs relative">
            <span className="text-gray-500 dark:text-gray-400">Party *</span>
            <input value={partyQ || partyName} onFocus={() => setPartyOpen(true)}
              onChange={e => { setPartyQ(e.target.value); setPartyName(''); setPartyOpen(true) }}
              placeholder="Search party (existing ledgers)..."
              className="mt-0.5 w-full px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
            {partyOpen && (
              <div className="absolute z-10 top-full mt-1 left-0 right-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl max-h-56 overflow-y-auto">
                {filteredParties.length === 0 ? (
                  partyQ.trim() ? (
                    <button onClick={() => { setPartyName(partyQ.trim()); setPartyQ(''); setPartyOpen(false) }}
                      className="w-full text-left px-3 py-2 text-sm text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20">
                      + Use &quot;{partyQ.trim()}&quot; as new party
                    </button>
                  ) : <div className="px-3 py-2 text-xs text-gray-400">No parties yet</div>
                ) : (
                  filteredParties.map(p => (
                    <button key={p} onClick={() => { setPartyName(p); setPartyQ(''); setPartyOpen(false) }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 dark:hover:bg-indigo-900/20 break-words">
                      {p}
                    </button>
                  ))
                )}
              </div>
            )}
            {partyName && !partyOpen && (
              <p className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-400">Selected: <span className="font-semibold">{partyName}</span></p>
            )}
          </div>

          <label className="block text-xs">
            <span className="text-gray-500 dark:text-gray-400">Opening Amount *</span>
            <input type="text" inputMode="decimal" value={openingStr}
              onChange={e => { setOpeningStr(e.target.value); setDirty(true) }}
              placeholder="e.g. 1,75,000.00"
              className="mt-0.5 w-full px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm tabular-nums" />
          </label>

          {existingCount > 0 && (
            <div className="text-xs px-3 py-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300">
              <span className="font-semibold">{existingCount} existing row{existingCount === 1 ? '' : 's'}</span> loaded for {partyName} · FY {fy} · {vchType}. Edit below — Save will <span className="font-bold">replace all</span> existing entries for this party/FY/voucher-type.
            </div>
          )}

          <label className="block text-xs">
            <span className="text-gray-500 dark:text-gray-400">
              Paste invoice rows — <span className="text-gray-400">date · invoice · amount</span> (tab / 2-space / comma separated, header row optional)
            </span>
            <textarea value={pasted} onChange={e => { setPasted(e.target.value); setDirty(true) }} rows={8}
              placeholder={'02-Jun-24\tKSI/24-25/176\t80992\n11-Aug-24\tKSI/24-25/262\t798\n...'}
              className="mt-0.5 w-full px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs font-mono" />
          </label>

          {parsed.length > 0 && (
            <div className="bg-gray-50 dark:bg-gray-900/40 rounded-lg border border-gray-200 dark:border-gray-700 p-2">
              <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1.5">Parsed ({parsed.length} rows)</div>
              <div className="max-h-44 overflow-y-auto">
                <table className="w-full text-[11px]">
                  <thead className="text-[9px] uppercase text-gray-400">
                    <tr><th className="text-left">Date</th><th className="text-left">Invoice</th><th className="text-right">Amount</th><th className="text-left pl-2">Status</th></tr>
                  </thead>
                  <tbody className="font-mono">
                    {parsed.map((r, i) => (
                      <tr key={i} className={`border-t border-gray-100 dark:border-gray-700 ${r.warning ? 'text-rose-600 dark:text-rose-400' : 'text-gray-700 dark:text-gray-200'}`}>
                        <td className="py-0.5">{r.date ?? <span className="text-rose-500">{r.raw.split(/\s+/)[0]}?</span>}</td>
                        <td className="py-0.5 truncate max-w-[180px]">{r.vchNumber ?? '—'}</td>
                        <td className="py-0.5 text-right tabular-nums">{r.amount != null ? r.amount.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'}</td>
                        <td className="py-0.5 pl-2 text-[10px]">{r.warning ?? '✓'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {(opening > 0 || parsedSum > 0) && (
            <div className={`text-xs px-3 py-2 rounded-lg border ${
              sumOk ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-300'
                    : 'border-amber-300 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300'
            }`}>
              Pasted sum <span className="font-bold tabular-nums">₹{parsedSum.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
              {' '}vs opening <span className="font-bold tabular-nums">₹{opening.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
              {' '}— {sumOk ? '✓ matches' : `Δ ₹${delta.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`}
            </div>
          )}

          {error && <div className="text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 px-3 py-2 rounded-lg">{error}</div>}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <button onClick={onClose} disabled={saving}
            className="px-4 py-2 rounded-lg text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200">
            Cancel
          </button>
          <button onClick={save} disabled={!canSave}
            className="px-5 py-2 rounded-lg text-sm bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white font-semibold">
            {saving ? 'Saving…' : `Save ${validRows.length} row${validRows.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
