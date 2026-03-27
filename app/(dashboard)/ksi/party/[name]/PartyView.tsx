'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import * as XLSX from 'xlsx'

interface LedgerInfo {
  name: string
  parent: string | null
  address: string | null
  gstNo: string | null
  panNo: string | null
  mobileNos: string | null
  state: string | null
}

interface OutstandingBill {
  id: number
  type: string
  billRef: string
  billDate: string | null
  dueDate: string | null
  overdueDays: number
  closingBalance: number
  vchType: string | null
  vchNumber: string | null
}

interface Voucher {
  date: string | null
  vchNumber: string | null
  partyName: string | null
  itemName: string | null
  quantity: number | null
  unit: string | null
  rate: number | null
  amount: number
  vchType: string | null
  narration: string | null
}

interface PartyData {
  ledger: LedgerInfo | null
  outstandingBills: OutstandingBill[]
  vouchers: Voucher[]
  totalReceivable: number
  totalPayable: number
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

function formatINR(n: number) {
  return n.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 })
}
function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
}
function currentFY() {
  const now = new Date()
  const yr = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  return { from: `${yr}-04-01`, to: `${yr + 1}-03-31` }
}

const fetcher = (url: string) => fetch(url).then(r => r.json())

export default function PartyView({ name }: { name: string }) {
  const fy = currentFY()
  const [dateFrom, setDateFrom] = useState(fy.from)
  const [dateTo, setDateTo] = useState(fy.to)
  const [typeFilter, setTypeFilter] = useState('All')
  const [showBills, setShowBills] = useState(false)

  const swrKey = `/api/tally/ksi-party?name=${encodeURIComponent(name)}&dateFrom=${dateFrom}&dateTo=${dateTo}`
  const { data, error, isLoading } = useSWR<PartyData>(swrKey, fetcher, {
    revalidateOnFocus: false,
    keepPreviousData: true,
  })

  const filteredVouchers = useMemo(() => {
    if (!data?.vouchers) return []
    if (typeFilter === 'All') return data.vouchers
    return data.vouchers.filter(v => v.vchType === typeFilter)
  }, [data?.vouchers, typeFilter])

  // Running balance for statement
  const statement = useMemo(() => {
    let balance = 0
    return filteredVouchers.map(v => {
      const debit = ['Sales', 'Debit Note'].includes(v.vchType || '') ? v.amount : 0
      const credit = ['Receipt', 'Payment', 'Credit Note', 'Purchase'].includes(v.vchType || '') ? v.amount : 0
      balance += debit - credit
      return { ...v, debit, credit, balance }
    })
  }, [filteredVouchers])

  // Excel export — statement
  function exportStatement() {
    const rows = statement.map(r => ({
      Date: fmtDate(r.date),
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
    // Outstanding bills sheet
    if (data?.outstandingBills?.length) {
      const billRows = data.outstandingBills.map(b => ({
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
        <Link href="/ksi/outstanding" className="text-gray-400 hover:text-gray-200 transition">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-white truncate">{name}</h1>
          {data?.ledger?.parent && <p className="text-xs text-gray-400">{data.ledger.parent}</p>}
        </div>
        <button onClick={exportStatement} disabled={!data || statement.length === 0}
          className="flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition">
          ⬇ Export Excel
        </button>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg px-4 py-3 text-sm text-red-300 mb-4">{error.message}</div>
      )}

      {/* Contact Card */}
      {data?.ledger && (data.ledger.address || data.ledger.gstNo || data.ledger.panNo || data.ledger.mobileNos) && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 mb-4">
          <h2 className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide mb-3">Contact Details</h2>
          <div className="space-y-2">
            {data.ledger.address && (
              <div>
                <p className="text-[10px] text-gray-500 uppercase font-semibold tracking-wide">Address</p>
                <p className="text-sm text-gray-200">{data.ledger.address}</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              {data.ledger.gstNo && (
                <div>
                  <p className="text-[10px] text-gray-500 uppercase font-semibold tracking-wide">GST No</p>
                  <p className="text-sm text-gray-200 font-mono">{data.ledger.gstNo}</p>
                </div>
              )}
              {data.ledger.panNo && (
                <div>
                  <p className="text-[10px] text-gray-500 uppercase font-semibold tracking-wide">PAN No</p>
                  <p className="text-sm text-gray-200 font-mono">{data.ledger.panNo}</p>
                </div>
              )}
              {data.ledger.mobileNos && (
                <div>
                  <p className="text-[10px] text-gray-500 uppercase font-semibold tracking-wide">Mobile</p>
                  <p className="text-sm text-gray-200">{data.ledger.mobileNos}</p>
                </div>
              )}
              {data.ledger.state && (
                <div>
                  <p className="text-[10px] text-gray-500 uppercase font-semibold tracking-wide">State</p>
                  <p className="text-sm text-gray-200">{data.ledger.state}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Outstanding Summary */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">Outstanding Balance</h2>
          <button onClick={() => setShowBills(v => !v)} className="text-xs text-indigo-400 hover:text-indigo-300">
            {showBills ? 'Hide bills' : `${data?.outstandingBills?.length || 0} bills ▾`}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-2">
          <div className="bg-green-900/20 border border-green-800 rounded-lg p-3">
            <p className="text-[10px] text-green-400 font-semibold uppercase">Receivable</p>
            <p className="text-lg font-bold text-green-400">{formatINR(data?.totalReceivable || 0)}</p>
          </div>
          <div className="bg-rose-900/20 border border-rose-800 rounded-lg p-3">
            <p className="text-[10px] text-rose-400 font-semibold uppercase">Payable</p>
            <p className="text-lg font-bold text-rose-400">{formatINR(data?.totalPayable || 0)}</p>
          </div>
        </div>

        {showBills && data?.outstandingBills && data.outstandingBills.length > 0 && (
          <div className="space-y-1.5 mt-3 border-t border-gray-700 pt-3">
            {data.outstandingBills.map(b => (
              <div key={b.id} className={`flex items-center justify-between text-xs rounded-lg px-3 py-2 border ${
                b.type === 'receivable' ? 'bg-green-900/20 border-green-800' : 'bg-rose-900/20 border-rose-800'
              }`}>
                <div>
                  <p className="font-semibold text-gray-200">{b.billRef}</p>
                  <p className="text-gray-500">{fmtDate(b.billDate)} · Due: {fmtDate(b.dueDate)}
                    {b.overdueDays > 0 && <span className={`ml-1 font-medium ${b.overdueDays > 90 ? 'text-red-400' : 'text-amber-400'}`}> · {b.overdueDays}d overdue</span>}
                  </p>
                </div>
                <p className={`font-bold ${b.type === 'receivable' ? 'text-green-400' : 'text-rose-400'}`}>
                  {formatINR(b.closingBalance)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Account Statement (E) */}
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
            {/* Statement Table — desktop */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-700">
                    <th className="text-left py-2 pr-3 font-semibold">Date</th>
                    <th className="text-left py-2 pr-3 font-semibold">Type</th>
                    <th className="text-left py-2 pr-3 font-semibold">Voucher</th>
                    <th className="text-left py-2 pr-3 font-semibold">Item / Narration</th>
                    <th className="text-right py-2 pr-3 font-semibold text-green-400">Debit</th>
                    <th className="text-right py-2 pr-3 font-semibold text-rose-400">Credit</th>
                    <th className="text-right py-2 font-semibold">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700/50">
                  {statement.map((r, i) => {
                    const cfg = VCH_COLORS[r.vchType || '']
                    return (
                      <tr key={i} className="hover:bg-gray-700/30">
                        <td className="py-2 pr-3 text-gray-400 whitespace-nowrap">{fmtDate(r.date)}</td>
                        <td className="py-2 pr-3">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${cfg?.bg || 'bg-gray-700 border-gray-600'} ${cfg?.color || 'text-gray-300'}`}>
                            {r.vchType}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-gray-400">#{r.vchNumber}</td>
                        <td className="py-2 pr-3 text-gray-300 max-w-[160px] truncate">{r.itemName || r.narration || '—'}</td>
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

            {/* Statement — mobile cards */}
            <div className="sm:hidden space-y-2">
              {statement.map((r, i) => {
                const cfg = VCH_COLORS[r.vchType || '']
                return (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-gray-700 last:border-0 gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${cfg?.bg || 'bg-gray-700 border-gray-600'} ${cfg?.color || 'text-gray-300'}`}>
                          {r.vchType}
                        </span>
                        <span className="text-[10px] text-gray-500">#{r.vchNumber}</span>
                      </div>
                      <p className="text-xs text-gray-300 truncate mt-0.5">{r.itemName || r.narration || fmtDate(r.date)}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-xs font-bold ${r.debit ? 'text-green-400' : 'text-rose-400'}`}>
                        {formatINR(r.amount)}
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
