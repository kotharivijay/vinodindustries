'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import * as XLSX from 'xlsx'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const FIRM_COLORS: Record<string, { bg: string; text: string }> = {
  VI:  { bg: 'bg-blue-900/30', text: 'text-blue-400' },
  VCF: { bg: 'bg-teal-900/30', text: 'text-teal-400' },
  VF:  { bg: 'bg-orange-900/30', text: 'text-orange-400' },
}

const VCH_COLORS: Record<string, { color: string; bg: string }> = {
  'Sales':       { color: 'text-green-400',   bg: 'bg-green-900/30 border-green-700' },
  'Credit Note': { color: 'text-teal-400',    bg: 'bg-teal-900/30 border-teal-700' },
  'Purchase':    { color: 'text-blue-400',    bg: 'bg-blue-900/30 border-blue-700' },
  'Debit Note':  { color: 'text-orange-400',  bg: 'bg-orange-900/30 border-orange-700' },
  'Receipt':     { color: 'text-emerald-400', bg: 'bg-emerald-900/30 border-emerald-700' },
  'Payment':     { color: 'text-rose-400',    bg: 'bg-rose-900/30 border-rose-700' },
}

const TYPE_TABS = ['All', 'Sales', 'Purchase', 'Receipt', 'Payment', 'Credit Note', 'Debit Note'] as const
const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar']

function formatINR(n: number) {
  return n.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 })
}
function fmtDate(d: string | null) {
  if (!d) return '\u2014'
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
}
function currentFY() {
  const now = new Date()
  const yr = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  return { from: `${yr}-04-01`, to: `${yr + 1}-03-31` }
}

export default function PartyView({ name }: { name: string }) {
  const fy = currentFY()
  const [dateFrom, setDateFrom] = useState(fy.from)
  const [dateTo, setDateTo] = useState(fy.to)
  const [typeFilter, setTypeFilter] = useState('All')
  const [showBills, setShowBills] = useState(false)

  const { data, error, isLoading } = useSWR(`/api/tally/party/${encodeURIComponent(name)}`, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
    keepPreviousData: true,
  })

  const ledgerInfo = data?.ledgerInfo || []
  const outstanding = data?.outstanding || { bills: [], totalReceivable: 0, totalPayable: 0, byFirm: [] }
  const salesData = data?.sales || { recent: [], summary: { totalAmount: 0, totalVouchers: 0, items: [], monthly: [] } }

  // Merge contact info from ledger records
  const contact = useMemo(() => {
    const info = { address: '', gstNo: '', panNo: '', mobileNos: '', state: '', parent: '' }
    for (const l of ledgerInfo) {
      if (l.address && !info.address) info.address = l.address
      if (l.gstNo && !info.gstNo) info.gstNo = l.gstNo
      if (l.panNo && !info.panNo) info.panNo = l.panNo
      if (l.mobileNos && !info.mobileNos) info.mobileNos = l.mobileNos
      if (l.state && !info.state) info.state = l.state
      if (l.parent && !info.parent) info.parent = l.parent
    }
    return info
  }, [ledgerInfo])

  const firmCodes = useMemo(() => {
    const codes = new Set<string>()
    for (const l of ledgerInfo) codes.add(l.firmCode)
    for (const f of outstanding.byFirm) codes.add(f.firmCode)
    return Array.from(codes)
  }, [ledgerInfo, outstanding])

  // Filter vouchers by type and date range
  const filteredVouchers = useMemo(() => {
    let v = salesData.recent || []
    if (typeFilter !== 'All') v = v.filter((x: any) => x.vchType === typeFilter)
    if (dateFrom || dateTo) {
      v = v.filter((x: any) => {
        if (!x.date) return true
        const d = new Date(x.date)
        if (dateFrom && d < new Date(dateFrom)) return false
        if (dateTo && d > new Date(dateTo + 'T23:59:59.999Z')) return false
        return true
      })
    }
    return v
  }, [salesData.recent, typeFilter, dateFrom, dateTo])

  // Running balance for statement
  const statement = useMemo(() => {
    let balance = 0
    return filteredVouchers.map((v: any) => {
      const debit = ['Sales', 'Debit Note'].includes(v.vchType || '') ? (v.amount || 0) : 0
      const credit = ['Receipt', 'Payment', 'Credit Note', 'Purchase'].includes(v.vchType || '') ? (v.amount || 0) : 0
      balance += debit - credit
      return { ...v, debit, credit, balance }
    })
  }, [filteredVouchers])

  // Monthly sales bar chart
  const maxMonthly = useMemo(() => {
    return Math.max(...(salesData.summary.monthly || []).map((m: any) => m.amount), 1)
  }, [salesData.summary.monthly])

  // Excel export
  function exportStatement() {
    const rows = statement.map((r: any) => ({
      Date: fmtDate(r.date),
      Firm: r.firmCode || '',
      Type: r.vchType || '',
      'Voucher No': r.vchNumber || '',
      'Item / Narration': r.itemName || r.narration || '',
      Debit: r.debit || '',
      Credit: r.credit || '',
      Balance: r.balance,
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Statement')
    if (outstanding.bills?.length) {
      const billRows = outstanding.bills.map((b: any) => ({
        Firm: b.firmCode,
        Type: b.type,
        'Bill Ref': b.billRef,
        'Bill Date': fmtDate(b.billDate),
        'Due Date': fmtDate(b.dueDate),
        'Overdue Days': b.overdueDays,
        Balance: b.closingBalance,
        'Vch Type': b.vchType || '',
      }))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(billRows), 'Outstanding Bills')
    }
    XLSX.writeFile(wb, `${name}_Statement_${dateFrom}_${dateTo}.xlsx`)
  }

  if (isLoading && !data) {
    return (
      <div className="p-4 md:p-6 max-w-4xl">
        <div className="space-y-3 animate-pulse">
          <div className="h-10 bg-gray-800 rounded-xl w-1/2" />
          <div className="h-24 bg-gray-800 rounded-xl" />
          <div className="h-32 bg-gray-800 rounded-xl" />
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Link href="/vi/outstanding" className="text-gray-400 hover:text-gray-200 transition">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-white truncate">{name}</h1>
          <div className="flex flex-wrap gap-1.5 mt-0.5">
            {firmCodes.map(code => {
              const fc = FIRM_COLORS[code] || { bg: 'bg-gray-700', text: 'text-gray-300' }
              return <span key={code} className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${fc.bg} ${fc.text}`}>{code}</span>
            })}
            {contact.parent && <span className="text-xs text-gray-400">{contact.parent}</span>}
          </div>
        </div>
        <Link href={`/vi/party/${encodeURIComponent(name)}/performance`}
          className="flex items-center gap-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 px-3 py-1.5 rounded-lg text-xs font-semibold transition">
          📊 Performance
        </Link>
        <button onClick={exportStatement} disabled={!data || statement.length === 0}
          className="flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition">
          ⬇ Export Excel
        </button>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg px-4 py-3 text-sm text-red-300 mb-4">{error.message}</div>
      )}

      {/* Contact Card */}
      {(contact.address || contact.gstNo || contact.panNo || contact.mobileNos) && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 mb-4">
          <h2 className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide mb-3">Contact Details</h2>
          <div className="space-y-2">
            {contact.address && (
              <div>
                <p className="text-[10px] text-gray-500 uppercase font-semibold tracking-wide">Address</p>
                <p className="text-sm text-gray-200">{contact.address}</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              {contact.gstNo && (
                <div>
                  <p className="text-[10px] text-gray-500 uppercase font-semibold tracking-wide">GST No</p>
                  <p className="text-sm text-gray-200 font-mono">{contact.gstNo}</p>
                </div>
              )}
              {contact.panNo && (
                <div>
                  <p className="text-[10px] text-gray-500 uppercase font-semibold tracking-wide">PAN No</p>
                  <p className="text-sm text-gray-200 font-mono">{contact.panNo}</p>
                </div>
              )}
              {contact.mobileNos && (
                <div>
                  <p className="text-[10px] text-gray-500 uppercase font-semibold tracking-wide">Mobile</p>
                  <p className="text-sm text-gray-200">{contact.mobileNos}</p>
                </div>
              )}
              {contact.state && (
                <div>
                  <p className="text-[10px] text-gray-500 uppercase font-semibold tracking-wide">State</p>
                  <p className="text-sm text-gray-200">{contact.state}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="bg-green-900/20 border border-green-800 rounded-xl p-3 text-center">
          <p className="text-[10px] text-green-400 uppercase font-semibold">Receivable</p>
          <p className="text-sm font-bold text-green-400">{formatINR(outstanding.totalReceivable)}</p>
        </div>
        <div className="bg-rose-900/20 border border-rose-800 rounded-xl p-3 text-center">
          <p className="text-[10px] text-rose-400 uppercase font-semibold">Payable</p>
          <p className="text-sm font-bold text-rose-400">{formatINR(outstanding.totalPayable)}</p>
        </div>
        <div className="bg-indigo-900/20 border border-indigo-800 rounded-xl p-3 text-center">
          <p className="text-[10px] text-indigo-400 uppercase font-semibold">Total Sales</p>
          <p className="text-sm font-bold text-indigo-400">{formatINR(salesData.summary.totalAmount)}</p>
        </div>
      </div>

      {/* Outstanding Bills */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">Outstanding Balance</h2>
          <button onClick={() => setShowBills(v => !v)} className="text-xs text-indigo-400 hover:text-indigo-300">
            {showBills ? 'Hide bills' : `${outstanding.bills?.length || 0} bills \u25BE`}
          </button>
        </div>

        {/* Firm-wise breakdown */}
        {outstanding.byFirm.length > 0 && (
          <div className="space-y-1.5 mb-3">
            {outstanding.byFirm.map((f: any) => {
              const fc = FIRM_COLORS[f.firmCode] || { bg: 'bg-gray-700', text: 'text-gray-300' }
              return (
                <div key={f.firmCode} className="flex items-center justify-between text-xs">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${fc.bg} ${fc.text}`}>{f.firmCode}</span>
                  <div className="flex gap-4">
                    {f.receivable > 0 && <span className="text-green-400 font-medium">{formatINR(f.receivable)} Dr</span>}
                    {f.payable > 0 && <span className="text-rose-400 font-medium">{formatINR(f.payable)} Cr</span>}
                    <span className="text-gray-500">{f.billCount} bills</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {showBills && outstanding.bills && outstanding.bills.length > 0 && (
          <div className="space-y-1.5 border-t border-gray-700 pt-3">
            {outstanding.bills.map((b: any) => {
              const fc = FIRM_COLORS[b.firmCode] || { bg: 'bg-gray-700', text: 'text-gray-300' }
              return (
                <div key={b.id} className={`flex items-center justify-between text-xs rounded-lg px-3 py-2 border ${
                  b.type === 'receivable' ? 'bg-green-900/20 border-green-800' : 'bg-rose-900/20 border-rose-800'
                }`}>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`px-1 py-0.5 rounded text-[10px] font-bold ${fc.bg} ${fc.text}`}>{b.firmCode}</span>
                      <span className="font-semibold text-gray-200">{b.billRef}</span>
                    </div>
                    <p className="text-gray-500">{fmtDate(b.billDate)} · Due: {fmtDate(b.dueDate)}
                      {b.overdueDays > 0 && <span className={`ml-1 font-medium ${b.overdueDays > 90 ? 'text-red-400' : b.overdueDays > 30 ? 'text-amber-400' : 'text-gray-500'}`}> · {b.overdueDays}d overdue</span>}
                    </p>
                  </div>
                  <p className={`font-bold ${b.type === 'receivable' ? 'text-green-400' : 'text-rose-400'}`}>
                    {formatINR(b.closingBalance)}
                  </p>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Monthly Sales Chart */}
      {salesData.summary.monthly?.length > 0 && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 mb-4">
          <h2 className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide mb-3">Monthly Sales</h2>
          <div className="space-y-1.5">
            {salesData.summary.monthly.map((m: any) => (
              <div key={m.month} className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-16 shrink-0">{m.month}</span>
                <div className="flex-1 bg-gray-700 rounded-full h-4 overflow-hidden">
                  <div className="bg-indigo-500 h-full rounded-full transition-all" style={{ width: `${(m.amount / maxMonthly) * 100}%` }} />
                </div>
                <span className="text-xs text-gray-300 font-medium w-24 text-right">{formatINR(m.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top Items */}
      {salesData.summary.items?.length > 0 && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 mb-4">
          <h2 className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide mb-2">Items Sold</h2>
          <div className="flex flex-wrap gap-1.5">
            {salesData.summary.items.map((item: string) => (
              <span key={item} className="px-2 py-1 bg-gray-700 rounded-lg text-xs text-gray-300">{item}</span>
            ))}
          </div>
        </div>
      )}

      {/* Account Statement */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-white">Account Statement</h2>
          <p className="text-xs text-gray-500">{filteredVouchers.length} entries</p>
        </div>

        {/* Date Range */}
        <div className="flex flex-wrap gap-2 mb-3">
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="bg-gray-700 border border-gray-600 text-gray-100 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          <span className="self-center text-gray-500 text-xs">to</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="bg-gray-700 border border-gray-600 text-gray-100 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          <button onClick={() => { setDateFrom(fy.from); setDateTo(fy.to) }}
            className="text-xs text-indigo-400 border border-indigo-800 rounded-lg px-2.5 py-1 hover:bg-indigo-900/30">
            This FY
          </button>
        </div>

        {/* Type Tabs */}
        <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1">
          {TYPE_TABS.map(tab => (
            <button key={tab} onClick={() => setTypeFilter(tab)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition ${
                typeFilter === tab ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}>
              {tab}
            </button>
          ))}
        </div>

        {isLoading && <p className="text-xs text-gray-500 animate-pulse py-2">Loading...</p>}

        {statement.length === 0 && !isLoading ? (
          <p className="text-sm text-gray-500 text-center py-8">No transactions in this period.</p>
        ) : (
          <>
            {/* Statement Table -- desktop */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-700">
                    <th className="text-left py-2 pr-3 font-semibold">Date</th>
                    <th className="text-left py-2 pr-3 font-semibold">Firm</th>
                    <th className="text-left py-2 pr-3 font-semibold">Type</th>
                    <th className="text-left py-2 pr-3 font-semibold">Voucher</th>
                    <th className="text-left py-2 pr-3 font-semibold">Item / Narration</th>
                    <th className="text-right py-2 pr-3 font-semibold text-green-400">Debit</th>
                    <th className="text-right py-2 pr-3 font-semibold text-rose-400">Credit</th>
                    <th className="text-right py-2 font-semibold">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700/50">
                  {statement.map((r: any, i: number) => {
                    const cfg = VCH_COLORS[r.vchType || '']
                    const fc = FIRM_COLORS[r.firmCode] || { bg: 'bg-gray-700', text: 'text-gray-300' }
                    return (
                      <tr key={i} className="hover:bg-gray-700/30">
                        <td className="py-2 pr-3 text-gray-400 whitespace-nowrap">{fmtDate(r.date)}</td>
                        <td className="py-2 pr-3"><span className={`px-1 py-0.5 rounded text-[10px] font-bold ${fc.bg} ${fc.text}`}>{r.firmCode}</span></td>
                        <td className="py-2 pr-3">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${cfg?.bg || 'bg-gray-700 border-gray-600'} ${cfg?.color || 'text-gray-300'}`}>
                            {r.vchType}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-gray-400">#{r.vchNumber}</td>
                        <td className="py-2 pr-3 text-gray-300 max-w-[160px] truncate">{r.itemName || r.narration || '\u2014'}</td>
                        <td className="py-2 pr-3 text-right text-green-400 font-medium">{r.debit ? formatINR(r.debit) : ''}</td>
                        <td className="py-2 pr-3 text-right text-rose-400 font-medium">{r.credit ? formatINR(r.credit) : ''}</td>
                        <td className={`py-2 text-right font-semibold ${r.balance >= 0 ? 'text-green-400' : 'text-rose-400'}`}>
                          {formatINR(Math.abs(r.balance))} {r.balance >= 0 ? 'Dr' : 'Cr'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Statement -- mobile cards */}
            <div className="sm:hidden space-y-2">
              {statement.map((r: any, i: number) => {
                const cfg = VCH_COLORS[r.vchType || '']
                const fc = FIRM_COLORS[r.firmCode] || { bg: 'bg-gray-700', text: 'text-gray-300' }
                return (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-gray-700 last:border-0 gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={`px-1 py-0.5 rounded text-[10px] font-bold ${fc.bg} ${fc.text}`}>{r.firmCode}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${cfg?.bg || 'bg-gray-700 border-gray-600'} ${cfg?.color || 'text-gray-300'}`}>
                          {r.vchType}
                        </span>
                        <span className="text-[10px] text-gray-500">#{r.vchNumber}</span>
                      </div>
                      <p className="text-xs text-gray-300 truncate mt-0.5">{r.itemName || r.narration || fmtDate(r.date)}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-xs font-bold ${r.debit ? 'text-green-400' : 'text-rose-400'}`}>
                        {formatINR(r.amount || 0)}
                      </p>
                      <p className={`text-[10px] ${r.balance >= 0 ? 'text-green-400' : 'text-rose-400'}`}>
                        {formatINR(Math.abs(r.balance))} {r.balance >= 0 ? 'Dr' : 'Cr'}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Closing Balance */}
            {statement.length > 0 && (
              <div className="flex items-center justify-between border-t border-gray-600 mt-3 pt-3">
                <span className="text-xs font-semibold text-white">Closing Balance</span>
                <span className={`text-sm font-bold ${statement[statement.length - 1].balance >= 0 ? 'text-green-400' : 'text-rose-400'}`}>
                  {formatINR(Math.abs(statement[statement.length - 1].balance))}
                  <span className="text-xs font-normal ml-1">
                    {statement[statement.length - 1].balance >= 0 ? 'Dr' : 'Cr'}
                  </span>
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
