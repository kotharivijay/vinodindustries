'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'

interface LedgerInfo {
  id: number
  firmCode: string
  name: string
  parent: string | null
  address: string | null
  gstNo: string | null
  panNo: string | null
  mobileNos: string | null
  state: string | null
}

interface OutstandingEntry {
  firmCode: string
  firmName: string
  balance: number
}

interface Voucher {
  date: string
  voucherNo: string
  type: string
  amount: number
  narration: string
  firmCode: string
}

const FIRM_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  VI:  { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200' },
  VCF: { bg: 'bg-teal-100', text: 'text-teal-700', border: 'border-teal-200' },
  VF:  { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-200' },
}

const VOUCHER_TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  Sales:    { bg: 'bg-green-100', text: 'text-green-700' },
  Purchase: { bg: 'bg-red-100', text: 'text-red-700' },
  Receipt:  { bg: 'bg-blue-100', text: 'text-blue-700' },
  Payment:  { bg: 'bg-orange-100', text: 'text-orange-700' },
}

const TYPE_TABS = ['All', 'Sales', 'Purchase', 'Receipt', 'Payment'] as const

function formatINR(amount: number): string {
  return amount.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function formatDate(d: string): string {
  if (!d) return ''
  const date = new Date(d)
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
}

export default function PartyView({ name }: { name: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ledgerInfo, setLedgerInfo] = useState<LedgerInfo[]>([])
  const [outstanding, setOutstanding] = useState<OutstandingEntry[]>([])
  const [vouchers, setVouchers] = useState<Voucher[]>([])
  const [typeFilter, setTypeFilter] = useState<string>('All')

  useEffect(() => {
    loadData()
  }, [name])

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/tally/party/${encodeURIComponent(name)}`)
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()
      setLedgerInfo(data.ledgerInfo || [])
      setOutstanding(data.outstanding || [])
      setVouchers(data.vouchers || [])
    } catch {
      setError('Could not load party data. Check Tally connection.')
    }
    setLoading(false)
  }

  const filteredVouchers = useMemo(() => {
    if (typeFilter === 'All') return vouchers
    return vouchers.filter(v => v.type.toLowerCase().includes(typeFilter.toLowerCase()))
  }, [vouchers, typeFilter])

  const totalOutstanding = outstanding.reduce((sum, o) => sum + o.balance, 0)

  // Merge contact info from all firm ledger records
  const contact = useMemo(() => {
    const info = {
      address: '',
      gstNo: '',
      panNo: '',
      mobileNos: '',
      state: '',
      parent: '',
    }
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
    for (const o of outstanding) codes.add(o.firmCode)
    return Array.from(codes)
  }, [ledgerInfo, outstanding])

  if (loading) {
    return (
      <div className="p-4 md:p-8 max-w-4xl">
        <div className="py-12 text-center text-gray-400">Loading party data...</div>
      </div>
    )
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
              return (
                <span key={code} className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${fc.bg} ${fc.text} ${fc.border} border`}>
                  {code}
                </span>
              )
            })}
            {contact.parent && (
              <span className="text-xs text-gray-400 ml-1">{contact.parent}</span>
            )}
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 mb-4">
          {error}
        </div>
      )}

      {/* Contact Card */}
      {(contact.address || contact.gstNo || contact.panNo || contact.mobileNos || contact.state) && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 mb-4">
          <h2 className="text-xs text-gray-400 uppercase font-semibold tracking-wide mb-3">Contact Details</h2>
          <div className="space-y-2">
            {contact.address && (
              <div>
                <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">Address</p>
                <p className="text-sm text-gray-700">{contact.address}</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              {contact.gstNo && (
                <div>
                  <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">GST No</p>
                  <p className="text-sm text-gray-700 font-mono">{contact.gstNo}</p>
                </div>
              )}
              {contact.panNo && (
                <div>
                  <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">PAN No</p>
                  <p className="text-sm text-gray-700 font-mono">{contact.panNo}</p>
                </div>
              )}
              {contact.mobileNos && (
                <div>
                  <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">Mobile</p>
                  <p className="text-sm text-gray-700">{contact.mobileNos}</p>
                </div>
              )}
              {contact.state && (
                <div>
                  <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">State</p>
                  <p className="text-sm text-gray-700">{contact.state}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Outstanding Card */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 mb-4">
        <h2 className="text-xs text-gray-400 uppercase font-semibold tracking-wide mb-3">Outstanding Balance</h2>
        {outstanding.length === 0 ? (
          <p className="text-sm text-gray-400">No outstanding balance found</p>
        ) : (
          <>
            <div className="space-y-2">
              {outstanding.map(o => {
                const fc = FIRM_COLORS[o.firmCode] || { bg: 'bg-gray-100', text: 'text-gray-600', border: 'border-gray-200' }
                const isPositive = o.balance > 0
                return (
                  <div key={o.firmCode} className="flex items-center justify-between">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${fc.bg} ${fc.text} ${fc.border} border`}>
                      {o.firmCode}
                    </span>
                    <span className="text-xs text-gray-400 flex-1 ml-2">{o.firmName}</span>
                    <span className={`text-sm font-bold ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                      {formatINR(Math.abs(o.balance))}
                      <span className="text-[10px] font-normal ml-1">
                        {isPositive ? 'Dr' : 'Cr'}
                      </span>
                    </span>
                  </div>
                )
              })}
            </div>
            <div className="border-t border-gray-100 mt-3 pt-3 flex items-center justify-between">
              <span className="text-xs text-gray-500 font-medium">Net Balance</span>
              <span className={`text-base font-bold ${totalOutstanding > 0 ? 'text-green-600' : totalOutstanding < 0 ? 'text-red-600' : 'text-gray-600'}`}>
                {formatINR(Math.abs(totalOutstanding))}
                <span className="text-xs font-normal ml-1">
                  {totalOutstanding > 0 ? 'Receivable' : totalOutstanding < 0 ? 'Payable' : ''}
                </span>
              </span>
            </div>
          </>
        )}
      </div>

      {/* Transaction History */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
        <h2 className="text-xs text-gray-400 uppercase font-semibold tracking-wide mb-3">Transaction History</h2>

        {/* Type Tabs */}
        <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1">
          {TYPE_TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setTypeFilter(tab)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition ${
                typeFilter === tab
                  ? 'bg-gray-800 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <p className="text-xs text-gray-400 mb-3">
          Showing {filteredVouchers.length} transactions
        </p>

        {filteredVouchers.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">No transactions found</p>
        ) : (
          <div className="space-y-2">
            {filteredVouchers.map((v, i) => {
              const fc = FIRM_COLORS[v.firmCode] || { bg: 'bg-gray-100', text: 'text-gray-600', border: 'border-gray-200' }
              const vtc = VOUCHER_TYPE_COLORS[v.type] || { bg: 'bg-gray-100', text: 'text-gray-600' }
              return (
                <div key={`${v.firmCode}-${v.voucherNo}-${i}`} className="flex items-start gap-3 py-2 border-b border-gray-50 last:border-0">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${vtc.bg} ${vtc.text}`}>
                        {v.type}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${fc.bg} ${fc.text} ${fc.border} border`}>
                        {v.firmCode}
                      </span>
                      {v.voucherNo && <span className="text-xs text-gray-400">#{v.voucherNo}</span>}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-gray-500">{formatDate(v.date)}</span>
                    </div>
                    {v.narration && (
                      <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{v.narration}</p>
                    )}
                  </div>
                  <span className="text-sm font-bold text-gray-700 flex-shrink-0">
                    {formatINR(v.amount)}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
