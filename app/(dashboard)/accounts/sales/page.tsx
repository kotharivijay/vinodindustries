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

    let totalSaved = 0, totalFetched = 0
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
        log(`✓ ${c.label}  ${sec}s  ${d.saved}/${d.fetched} invoices`)
        totalSaved += d.saved || 0
        totalFetched += d.fetched || 0
      }
      log(`✅ Done · ${totalSaved}/${totalFetched} invoices across ${chunks.length} months`)
      setSyncMsg(`Synced ${totalSaved}/${totalFetched} invoices across ${chunks.length} months`)
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
        <h1 className="text-base sm:text-lg font-bold text-gray-800 dark:text-gray-100">Sales / Process Register</h1>
      </div>

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
