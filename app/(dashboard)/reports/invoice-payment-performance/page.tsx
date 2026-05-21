'use client'

import { useState, useMemo, useEffect, Fragment } from 'react'
import useSWR from 'swr'
import BackButton from '../../BackButton'

const fetcher = (url: string) => fetch(url).then(r => r.json())
const fmtMoney = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}-${d.toLocaleString('en-IN', { month: 'short' })}-${String(d.getFullYear()).slice(2)}`
}
const fmtDateSlash = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

interface ReceiptLine { date: string; vchNumber: string; vchType: string; amount: number }
interface JournalLine { date: string; ledger: string; amount: number }
interface Row {
  id: number; date: string; vchNumber: string; vchType: string
  partyName: string; agent: string
  taxableNet: number; voucherDiscount: number; voucherExtra: number
  gst: number; totalAmount: number
  receipts: ReceiptLine[]; journals: JournalLine[]
  consumed: number; pending: number; isCleared: boolean
  lastSettleDate: string | null; performanceDays: number | null
  bucket: 'g30' | 'y60' | 'o90' | 'r90p' | 'open'
}
interface Resp {
  fy: string; rows: Row[]; maxReceipts: number; maxJournals: number
  totals: {
    invoiceCount: number; clearedCount: number
    totalAmount: number; pendingAmount: number
    avgPerformanceDays: number | null
    bucketCounts: { g30: number; y60: number; o90: number; r90p: number; open: number }
  }
}

const BUCKET_META: Record<Row['bucket'], { label: string; emoji: string; cls: string }> = {
  g30: { label: '0–30 days', emoji: '🟢', cls: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' },
  y60: { label: '31–60 days', emoji: '🟡', cls: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300' },
  o90: { label: '61–90 days', emoji: '🟠', cls: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300' },
  r90p: { label: '91+ days', emoji: '🔴', cls: 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300' },
  open: { label: 'Open', emoji: '⚪', cls: 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300' },
}

export default function InvoicePaymentPerformancePage() {
  const { data: fyData } = useSWR<{ fys: { fy: string; count: number }[] }>(
    '/api/reports/invoice-payment-performance?action=fys', fetcher, { revalidateOnFocus: false },
  )
  const fys = fyData?.fys ?? []
  const [fy, setFy] = useState<string>('')
  useEffect(() => {
    if (!fy && fys.length > 0) setFy(fys[0].fy)
  }, [fy, fys])

  const [bucketFilter, setBucketFilter] = useState<Row['bucket'] | 'all'>('all')
  const [partyQuery, setPartyQuery] = useState('')
  const [downloading, setDownloading] = useState<'xlsx' | null>(null)

  const { data: report, isLoading } = useSWR<Resp>(
    fy ? `/api/reports/invoice-payment-performance?fy=${fy}` : null,
    fetcher, { revalidateOnFocus: false },
  )

  const filtered = useMemo(() => {
    const rows = report?.rows ?? []
    const q = partyQuery.trim().toLowerCase()
    return rows.filter(r => {
      const matchBucket = bucketFilter === 'all' || r.bucket === bucketFilter
      const matchParty = !q || r.partyName.toLowerCase().includes(q) || r.agent.toLowerCase().includes(q) || r.vchNumber.toLowerCase().includes(q)
      return matchBucket && matchParty
    })
  }, [report, bucketFilter, partyQuery])

  async function downloadExcel() {
    if (!report) return
    setDownloading('xlsx')
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.utils.book_new()

      // Sheet 1 — Wide invoice summary (one row per invoice, dynamic columns)
      const maxR = report.maxReceipts
      const maxJ = report.maxJournals
      const wideHeaders: string[] = [
        'Inv Date', 'Invoice', 'Type', 'Party', 'Agent (parent)',
        'Taxable (net)', 'GST', 'Total',
      ]
      for (let i = 1; i <= maxR; i++) {
        wideHeaders.push(`Recpt ${i} Date`, `Recpt ${i} Vch`, `Recpt ${i} Amt`)
      }
      for (let i = 1; i <= maxJ; i++) {
        wideHeaders.push(`Jrnl ${i} Date`, `Jrnl ${i} Ledger`, `Jrnl ${i} Amt`)
      }
      wideHeaders.push('Last Settle', 'Perf Days', 'Bucket', 'Pending')
      const wideRows = filtered.map(r => {
        const row: (string | number)[] = [
          fmtDateSlash(r.date), r.vchNumber, r.vchType, r.partyName, r.agent,
          r.taxableNet, r.gst, r.totalAmount,
        ]
        for (let i = 0; i < maxR; i++) {
          const x = r.receipts[i]
          row.push(x ? fmtDateSlash(x.date) : '', x ? x.vchNumber : '', x ? x.amount : '')
        }
        for (let i = 0; i < maxJ; i++) {
          const x = r.journals[i]
          row.push(x ? fmtDateSlash(x.date) : '', x ? x.ledger : '', x ? x.amount : '')
        }
        row.push(r.lastSettleDate ? fmtDateSlash(r.lastSettleDate) : '', r.performanceDays ?? '', BUCKET_META[r.bucket].label, r.pending)
        return row
      })
      const ws1 = XLSX.utils.aoa_to_sheet([wideHeaders, ...wideRows])
      XLSX.utils.book_append_sheet(wb, ws1, 'Wide Summary')

      // Sheet 2 — Long transaction stream (one row per receipt / journal)
      const longHeaders = ['Inv Date', 'Invoice', 'Party', 'Total', 'Kind', 'Txn Date', 'Vch / Ledger', 'Amount']
      const longRows: (string | number)[][] = []
      for (const r of filtered) {
        longRows.push([fmtDateSlash(r.date), r.vchNumber, r.partyName, r.totalAmount, 'Invoice', fmtDateSlash(r.date), '—', r.totalAmount])
        for (const x of r.receipts) longRows.push([fmtDateSlash(r.date), r.vchNumber, r.partyName, r.totalAmount, 'Receipt', fmtDateSlash(x.date), x.vchNumber, x.amount])
        for (const x of r.journals) longRows.push([fmtDateSlash(r.date), r.vchNumber, r.partyName, r.totalAmount, 'Journal', fmtDateSlash(x.date), x.ledger, x.amount])
      }
      const ws2 = XLSX.utils.aoa_to_sheet([longHeaders, ...longRows])
      XLSX.utils.book_append_sheet(wb, ws2, 'Transactions')

      XLSX.writeFile(wb, `invoice-payment-performance-${report.fy}.xlsx`)
    } finally { setDownloading(null) }
  }

  const maxR = report?.maxReceipts ?? 0
  const maxJ = report?.maxJournals ?? 0

  return (
    <div className="max-w-[1600px] mx-auto p-3 sm:p-4 pb-20">
      <div className="flex items-center gap-2 mb-3">
        <BackButton fallback="/dashboard" />
        <h1 className="text-base sm:text-lg font-bold text-gray-800 dark:text-gray-100">Invoice Payment Performance</h1>
      </div>

      {/* Controls */}
      <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl p-3 mb-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="text-[10px] text-gray-500 dark:text-gray-400 block mb-1">FY</label>
          <select value={fy} onChange={e => setFy(e.target.value)}
            className="w-full px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm">
            {fys.map(f => <option key={f.fy} value={f.fy}>FY {f.fy} ({f.count} invoices)</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-gray-500 dark:text-gray-400 block mb-1">Search</label>
          <input type="search" value={partyQuery} onChange={e => setPartyQuery(e.target.value)}
            placeholder="Party / agent / invoice no…"
            className="w-full px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
        </div>
        <div>
          <label className="text-[10px] text-gray-500 dark:text-gray-400 block mb-1">Bucket</label>
          <select value={bucketFilter} onChange={e => setBucketFilter(e.target.value as any)}
            className="w-full px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm">
            <option value="all">All</option>
            <option value="g30">🟢 0–30 days</option>
            <option value="y60">🟡 31–60 days</option>
            <option value="o90">🟠 61–90 days</option>
            <option value="r90p">🔴 91+ days</option>
            <option value="open">⚪ Open (still pending)</option>
          </select>
        </div>
      </div>

      {/* Summary */}
      {report?.totals && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
          <SummaryCard label="Invoices" value={report.totals.invoiceCount} color="text-indigo-700 dark:text-indigo-400" />
          <SummaryCard label="Cleared" value={`${report.totals.clearedCount} / ${report.totals.invoiceCount}`} color="text-emerald-700 dark:text-emerald-400" />
          <SummaryCard label="Avg perf days" value={report.totals.avgPerformanceDays ?? '—'} color="text-amber-700 dark:text-amber-400" />
          <SummaryCard label={`Pending (₹)`} value={fmtMoney(report.totals.pendingAmount)} color="text-rose-700 dark:text-rose-400" />
        </div>
      )}
      {report?.totals && (
        <div className="flex flex-wrap gap-2 mb-3 text-[11px]">
          {(['g30', 'y60', 'o90', 'r90p', 'open'] as const).map(b => (
            <BucketPill key={b} b={b} count={report.totals.bucketCounts[b]} active={bucketFilter === b} onClick={() => setBucketFilter(bucketFilter === b ? 'all' : b)} />
          ))}
        </div>
      )}

      {/* Export */}
      <div className="hidden sm:flex flex-wrap gap-2 mb-3">
        <button onClick={downloadExcel} disabled={!report || !!downloading}
          className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold">
          {downloading === 'xlsx' ? 'Building…' : '📊 Download Excel'}
        </button>
        <span className="text-[11px] text-gray-500 dark:text-gray-400 self-center">Two sheets: <em>Wide Summary</em> + <em>Transactions</em></span>
      </div>

      {!fy && <div className="text-center py-12 text-gray-400 text-sm">Pick an FY to load the report.</div>}
      {fy && isLoading && <div className="text-center py-12 text-gray-400 text-sm">Loading…</div>}

      {/* Desktop: Wide flat table (Option A) */}
      {report && (
        <div className="hidden sm:block bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl overflow-hidden">
          <div className="overflow-x-auto max-h-[70vh]">
            <table className="text-[11px] border-collapse">
              <thead className="bg-gray-50 dark:bg-gray-700/60 border-b border-gray-100 dark:border-gray-700 sticky top-0 z-10">
                <tr>
                  <Th>Inv Date</Th>
                  <Th>Invoice</Th>
                  <Th>Party</Th>
                  <Th>Agent</Th>
                  <Th align="right">Taxable</Th>
                  <Th align="right">GST</Th>
                  <Th align="right">Total</Th>
                  {Array.from({ length: maxR }, (_, i) => (
                    <Th key={`rh-${i}`} accent="emerald" colSpan={3} align="center">Recpt {i + 1}</Th>
                  ))}
                  {Array.from({ length: maxJ }, (_, i) => (
                    <Th key={`jh-${i}`} accent="amber" colSpan={3} align="center">Jrnl {i + 1}</Th>
                  ))}
                  <Th>Last Settle</Th>
                  <Th align="right">Days</Th>
                  <Th>Status</Th>
                </tr>
                <tr>
                  {/* spacer row for col groups */}
                  <Th /><Th /><Th /><Th /><Th /><Th /><Th />
                  {Array.from({ length: maxR }, (_, i) => (
                    <Fragment key={`rg-${i}`}>
                      <Th accent="emerald">Date</Th>
                      <Th accent="emerald">Vch</Th>
                      <Th accent="emerald" align="right">Amt</Th>
                    </Fragment>
                  ))}
                  {Array.from({ length: maxJ }, (_, i) => (
                    <Fragment key={`jg-${i}`}>
                      <Th accent="amber">Date</Th>
                      <Th accent="amber">Ledger</Th>
                      <Th accent="amber" align="right">Amt</Th>
                    </Fragment>
                  ))}
                  <Th /><Th /><Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {filtered.map(r => (
                  <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <Td>{fmtDate(r.date)}</Td>
                    <Td><span className="font-mono text-indigo-700 dark:text-indigo-400">{r.vchNumber}</span></Td>
                    <Td><span className="font-medium">{r.partyName}</span></Td>
                    <Td><span className="text-gray-500 dark:text-gray-400">{r.agent || '—'}</span></Td>
                    <Td align="right">₹{fmtMoney(r.taxableNet)}</Td>
                    <Td align="right">₹{fmtMoney(r.gst)}</Td>
                    <Td align="right"><span className="font-bold">₹{fmtMoney(r.totalAmount)}</span></Td>
                    {Array.from({ length: maxR }, (_, i) => {
                      const x = r.receipts[i]
                      return (
                        <Fragment key={`r-${i}`}>
                          <Td accent="emerald">{x ? fmtDate(x.date) : ''}</Td>
                          <Td accent="emerald">{x ? <span className="font-mono">{x.vchNumber}</span> : ''}</Td>
                          <Td accent="emerald" align="right">{x ? `₹${fmtMoney(x.amount)}` : ''}</Td>
                        </Fragment>
                      )
                    })}
                    {Array.from({ length: maxJ }, (_, i) => {
                      const x = r.journals[i]
                      return (
                        <Fragment key={`j-${i}`}>
                          <Td accent="amber">{x ? fmtDate(x.date) : ''}</Td>
                          <Td accent="amber">{x ? x.ledger : ''}</Td>
                          <Td accent="amber" align="right">{x ? `₹${fmtMoney(x.amount)}` : ''}</Td>
                        </Fragment>
                      )
                    })}
                    <Td>{r.lastSettleDate ? fmtDate(r.lastSettleDate) : '—'}</Td>
                    <Td align="right"><span className="font-bold">{r.performanceDays ?? '—'}</span></Td>
                    <Td>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${BUCKET_META[r.bucket].cls}`}>
                        {BUCKET_META[r.bucket].emoji} {r.bucket === 'open' ? `Open ₹${fmtMoney(r.pending)}` : BUCKET_META[r.bucket].label}
                      </span>
                    </Td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><Td colSpan={7 + maxR * 3 + maxJ * 3 + 3}>
                    <div className="text-center py-12 text-gray-400">No invoices match the current filter.</div>
                  </Td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Mobile: Card grid (Option C) */}
      {report && (
        <div className="sm:hidden space-y-2">
          {filtered.map(r => (
            <div key={r.id} className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl p-3">
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-xs text-indigo-700 dark:text-indigo-400">{r.vchNumber}</div>
                  <div className="text-[10px] text-gray-500 dark:text-gray-400">{fmtDate(r.date)}</div>
                  <div className="text-sm font-semibold text-gray-800 dark:text-gray-100 break-words">{r.partyName}</div>
                  {r.agent && <div className="text-[10px] text-gray-500 dark:text-gray-400 break-words">{r.agent}</div>}
                </div>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${BUCKET_META[r.bucket].cls}`}>
                  {BUCKET_META[r.bucket].emoji} {r.bucket === 'open' ? `Open` : `${r.performanceDays}d`}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1 text-center text-[11px] border-y border-gray-100 dark:border-gray-700 py-1.5 my-1.5">
                <div><div className="text-[9px] text-gray-400 uppercase">Taxable</div><div className="tabular-nums">₹{fmtMoney(r.taxableNet)}</div></div>
                <div><div className="text-[9px] text-gray-400 uppercase">GST</div><div className="tabular-nums">₹{fmtMoney(r.gst)}</div></div>
                <div><div className="text-[9px] text-gray-400 uppercase">Total</div><div className="tabular-nums font-bold">₹{fmtMoney(r.totalAmount)}</div></div>
              </div>
              {r.receipts.length > 0 && (
                <div className="space-y-0.5 mb-1">
                  {r.receipts.map((x, i) => (
                    <div key={i} className="grid grid-cols-[70px_1fr_auto] gap-1 text-[11px] text-emerald-700 dark:text-emerald-400">
                      <span>{fmtDate(x.date)}</span><span className="font-mono">{x.vchType === 'Credit Note' ? 'CN ' : 'Rcpt '}{x.vchNumber}</span><span className="tabular-nums">₹{fmtMoney(x.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
              {r.journals.length > 0 && (
                <div className="space-y-0.5">
                  {r.journals.map((x, i) => (
                    <div key={i} className="grid grid-cols-[70px_1fr_auto] gap-1 text-[11px] text-amber-700 dark:text-amber-400">
                      <span>{fmtDate(x.date)}</span><span>{x.ledger}</span><span className="tabular-nums">₹{fmtMoney(x.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex justify-between items-center mt-1.5 pt-1.5 border-t border-gray-100 dark:border-gray-700 text-[10px]">
                {r.isCleared
                  ? <span className="text-emerald-700 dark:text-emerald-400 font-semibold">Cleared {r.lastSettleDate ? `on ${fmtDate(r.lastSettleDate)}` : ''}</span>
                  : <span className="text-rose-700 dark:text-rose-400 font-semibold">Pending ₹{fmtMoney(r.pending)}</span>}
                <span className="text-gray-400">{r.consumed > 0 ? `Settled ₹${fmtMoney(r.consumed)}` : ''}</span>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="text-center py-12 text-gray-400 text-sm border border-dashed rounded-xl">No invoices match the current filter.</div>
          )}
        </div>
      )}

      {/* Mobile sticky action bar */}
      {report && (
        <div className="sm:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 dark:bg-gray-900/95 backdrop-blur border-t border-gray-200 dark:border-gray-700 px-2 py-2 flex gap-1.5">
          <button onClick={downloadExcel} disabled={!report || !!downloading}
            className="flex-1 text-[11px] px-2 py-2.5 rounded-lg bg-emerald-600 active:bg-emerald-700 disabled:opacity-50 text-white font-semibold">
            {downloading === 'xlsx' ? '…' : '📊 Excel'}
          </button>
        </div>
      )}
    </div>
  )
}

function SummaryCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl p-2 text-center">
      <div className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wide">{label}</div>
      <div className={`text-base font-bold tabular-nums ${color}`}>{value}</div>
    </div>
  )
}

function BucketPill({ b, count, active, onClick }: { b: Row['bucket']; count: number; active: boolean; onClick: () => void }) {
  const m = BUCKET_META[b]
  return (
    <button onClick={onClick}
      className={`px-2.5 py-1 rounded-full border transition ${active
        ? 'bg-indigo-600 text-white border-indigo-600 font-semibold'
        : `${m.cls} border-transparent hover:opacity-80`}`}>
      {m.emoji} {m.label} <strong>{count}</strong>
    </button>
  )
}

function Th({ children, align = 'left', colSpan, accent }: {
  children?: React.ReactNode; align?: 'left' | 'right' | 'center'; colSpan?: number
  accent?: 'emerald' | 'amber'
}) {
  const accentCls = accent === 'emerald'
    ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
    : accent === 'amber'
      ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
      : 'text-gray-500 dark:text-gray-300'
  return (
    <th colSpan={colSpan}
      className={`px-2 py-1.5 text-${align} text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap border border-gray-200 dark:border-gray-700 ${accentCls}`}>
      {children}
    </th>
  )
}

function Td({ children, align = 'left', colSpan, accent }: {
  children?: React.ReactNode; align?: 'left' | 'right' | 'center'; colSpan?: number
  accent?: 'emerald' | 'amber'
}) {
  const accentCls = accent === 'emerald'
    ? 'bg-emerald-50/30 dark:bg-emerald-900/10'
    : accent === 'amber'
      ? 'bg-amber-50/30 dark:bg-amber-900/10'
      : ''
  return (
    <td colSpan={colSpan}
      className={`px-2 py-1 text-${align} text-gray-700 dark:text-gray-200 whitespace-nowrap border border-gray-100 dark:border-gray-700 ${accentCls}`}>
      {children}
    </td>
  )
}
