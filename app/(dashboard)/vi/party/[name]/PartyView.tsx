'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const FIRM_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  VI:  { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200' },
  VCF: { bg: 'bg-teal-100', text: 'text-teal-700', border: 'border-teal-200' },
  VF:  { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-200' },
}

const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar']

function formatINR(n: number) {
  return n.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 })
}
function fmtDate(d: string | null) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
}

export default function PartyView({ name }: { name: string }) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<'overview' | 'outstanding' | 'sales'>('overview')

  const { data, isLoading } = useSWR(`/api/tally/party/${encodeURIComponent(name)}`, fetcher, {
    dedupingInterval: 10000,
    revalidateOnFocus: false,
  })

  const ledgerInfo = data?.ledgerInfo || []
  const outstanding = data?.outstanding || { bills: [], totalReceivable: 0, totalPayable: 0, byFirm: [] }
  const sales = data?.sales || { recent: [], summary: { totalAmount: 0, totalVouchers: 0, items: [], monthly: [] } }

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

  // Monthly sales bar chart (simple CSS bars)
  const maxMonthly = useMemo(() => {
    return Math.max(...(sales.summary.monthly || []).map((m: any) => m.amount), 1)
  }, [sales.summary.monthly])

  if (isLoading) {
    return <div className="p-4 md:p-8 max-w-4xl"><div className="py-12 text-center text-gray-400">Loading party data from database...</div></div>
  }

  return (
    <div className="p-4 md:p-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => router.back()} className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-gray-800 truncate">{name}</h1>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {firmCodes.map(code => {
              const fc = FIRM_COLORS[code] || { bg: 'bg-gray-100', text: 'text-gray-600', border: 'border-gray-200' }
              return <span key={code} className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${fc.bg} ${fc.text} ${fc.border} border`}>{code}</span>
            })}
            {contact.parent && <span className="text-xs text-gray-400 ml-1">{contact.parent}</span>}
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-center">
          <p className="text-[10px] text-green-600 uppercase font-semibold">Receivable</p>
          <p className="text-sm font-bold text-green-700">{formatINR(outstanding.totalReceivable)}</p>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-center">
          <p className="text-[10px] text-red-600 uppercase font-semibold">Payable</p>
          <p className="text-sm font-bold text-red-700">{formatINR(outstanding.totalPayable)}</p>
        </div>
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 text-center">
          <p className="text-[10px] text-indigo-600 uppercase font-semibold">Total Sales</p>
          <p className="text-sm font-bold text-indigo-700">{formatINR(sales.summary.totalAmount)}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1">
        {(['overview', 'outstanding', 'sales'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition ${activeTab === tab ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {tab === 'overview' ? 'Overview' : tab === 'outstanding' ? `Outstanding (${outstanding.bills.length})` : `Sales (${sales.summary.totalVouchers})`}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          {/* Contact */}
          {(contact.address || contact.gstNo || contact.panNo || contact.mobileNos) && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <h2 className="text-xs text-gray-400 uppercase font-semibold tracking-wide mb-3">Contact</h2>
              {contact.address && <p className="text-sm text-gray-700 mb-2">{contact.address}</p>}
              <div className="grid grid-cols-2 gap-3">
                {contact.gstNo && <div><p className="text-[10px] text-gray-400 uppercase">GST</p><p className="text-sm text-gray-700 font-mono">{contact.gstNo}</p></div>}
                {contact.panNo && <div><p className="text-[10px] text-gray-400 uppercase">PAN</p><p className="text-sm text-gray-700 font-mono">{contact.panNo}</p></div>}
                {contact.mobileNos && <div><p className="text-[10px] text-gray-400 uppercase">Mobile</p><p className="text-sm text-gray-700">{contact.mobileNos}</p></div>}
                {contact.state && <div><p className="text-[10px] text-gray-400 uppercase">State</p><p className="text-sm text-gray-700">{contact.state}</p></div>}
              </div>
            </div>
          )}

          {/* Firm-wise Outstanding */}
          {outstanding.byFirm.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <h2 className="text-xs text-gray-400 uppercase font-semibold tracking-wide mb-3">Outstanding by Firm</h2>
              <div className="space-y-2">
                {outstanding.byFirm.map((f: any) => (
                  <div key={f.firmCode} className="flex items-center justify-between">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${(FIRM_COLORS[f.firmCode] || { bg: 'bg-gray-100', text: 'text-gray-600' }).bg} ${(FIRM_COLORS[f.firmCode] || { text: 'text-gray-600' }).text}`}>{f.firmCode}</span>
                    <div className="flex gap-4 text-sm">
                      {f.receivable > 0 && <span className="text-green-600 font-medium">{formatINR(f.receivable)} Dr</span>}
                      {f.payable > 0 && <span className="text-red-600 font-medium">{formatINR(f.payable)} Cr</span>}
                      <span className="text-gray-400 text-xs">{f.billCount} bills</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Monthly Sales Trend */}
          {sales.summary.monthly?.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <h2 className="text-xs text-gray-400 uppercase font-semibold tracking-wide mb-3">Monthly Sales</h2>
              <div className="space-y-1.5">
                {sales.summary.monthly.map((m: any) => (
                  <div key={m.month} className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-16 shrink-0">{m.month}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                      <div className="bg-indigo-500 h-full rounded-full" style={{ width: `${(m.amount / maxMonthly) * 100}%` }} />
                    </div>
                    <span className="text-xs text-gray-600 font-medium w-20 text-right">{formatINR(m.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Items sold */}
          {sales.summary.items?.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <h2 className="text-xs text-gray-400 uppercase font-semibold tracking-wide mb-2">Items Sold</h2>
              <div className="flex flex-wrap gap-1.5">
                {sales.summary.items.map((item: string) => (
                  <span key={item} className="px-2 py-1 bg-gray-100 rounded-lg text-xs text-gray-700">{item}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Outstanding Tab */}
      {activeTab === 'outstanding' && (
        <div className="space-y-2">
          {outstanding.bills.length === 0 ? (
            <p className="text-center text-gray-400 py-8">No outstanding bills. Sync from Tally to import.</p>
          ) : outstanding.bills.map((b: any) => (
            <div key={b.id} className={`rounded-xl p-3 border text-xs ${b.type === 'receivable' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${(FIRM_COLORS[b.firmCode] || { bg: 'bg-gray-100', text: 'text-gray-600' }).bg} ${(FIRM_COLORS[b.firmCode] || { text: 'text-gray-600' }).text}`}>{b.firmCode}</span>
                  <span className="font-semibold text-gray-700">{b.billRef}</span>
                </div>
                <span className={`font-bold ${b.type === 'receivable' ? 'text-green-700' : 'text-red-700'}`}>{formatINR(b.closingBalance)}</span>
              </div>
              <div className="flex flex-wrap gap-x-4 mt-1 text-gray-500">
                <span>Date: {fmtDate(b.billDate)}</span>
                <span>Due: {fmtDate(b.dueDate)}</span>
                {b.overdueDays > 0 && <span className={`font-medium ${b.overdueDays > 90 ? 'text-red-500' : 'text-amber-500'}`}>{b.overdueDays}d overdue</span>}
                {b.vchType && <span>{b.vchType}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Sales Tab */}
      {activeTab === 'sales' && (
        <div className="space-y-2">
          <p className="text-xs text-gray-400 mb-2">{sales.summary.totalVouchers} vouchers | {formatINR(sales.summary.totalAmount)} total</p>
          {sales.recent.length === 0 ? (
            <p className="text-center text-gray-400 py-8">No sales data. Sync from Tally to import.</p>
          ) : sales.recent.map((s: any, i: number) => (
            <div key={s.id || i} className="bg-white rounded-xl border border-gray-100 shadow-sm p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${(FIRM_COLORS[s.firmCode] || { bg: 'bg-gray-100', text: 'text-gray-600' }).bg} ${(FIRM_COLORS[s.firmCode] || { text: 'text-gray-600' }).text}`}>{s.firmCode}</span>
                  <span className="text-xs text-gray-500">{fmtDate(s.date)}</span>
                  {s.vchNumber && <span className="text-xs text-gray-400">#{s.vchNumber}</span>}
                </div>
                <span className="text-sm font-bold text-gray-700">{formatINR(s.amount || 0)}</span>
              </div>
              {s.itemName && (
                <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                  <span>{s.itemName}</span>
                  {s.quantity && <span>{s.quantity} {s.unit}</span>}
                  {s.rate && <span>@{s.rate}/{s.unit}</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
