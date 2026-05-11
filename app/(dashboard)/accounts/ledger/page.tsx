'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import BackButton from '../../BackButton'

const fetcher = (url: string) => fetch(url).then(r => r.json())
const fmtMoney = (n: number) => Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}-${d.toLocaleString('en-IN', { month: 'short' })}-${String(d.getFullYear()).slice(2)}`
}
const fmtDateSlash = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

interface LedgerOption { id: number; name: string; parent: string | null; gstNo: string | null }
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
interface LedgerInfo {
  name: string; parent: string | null; address: string | null
  gstNo: string | null; panNo: string | null; mobileNos: string | null; state: string | null
}
interface PartyData {
  ledger: LedgerInfo | null
  outstandingBills: any[]
  vouchers: Voucher[]
}

type Preset = 'fy-current' | 'fy-prior' | 'this-month' | 'last-month' | 'custom'

function currentFY(): { from: string; to: string; label: string } {
  const now = new Date()
  const yr = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  return {
    from: `${yr}-04-01`,
    to: `${yr + 1}-03-31`,
    label: `FY ${String(yr).slice(2)}-${String(yr + 1).slice(2)}`,
  }
}
function priorFY(): { from: string; to: string; label: string } {
  const now = new Date()
  const yr = now.getMonth() >= 3 ? now.getFullYear() - 1 : now.getFullYear() - 2
  return {
    from: `${yr}-04-01`,
    to: `${yr + 1}-03-31`,
    label: `FY ${String(yr).slice(2)}-${String(yr + 1).slice(2)}`,
  }
}
function thisMonth(): { from: string; to: string; label: string } {
  const now = new Date()
  const y = now.getFullYear(), m = now.getMonth()
  const last = new Date(y, m + 1, 0).getDate()
  return {
    from: `${y}-${String(m + 1).padStart(2, '0')}-01`,
    to: `${y}-${String(m + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`,
    label: now.toLocaleString('en-IN', { month: 'short', year: '2-digit' }),
  }
}
function lastMonth(): { from: string; to: string; label: string } {
  const now = new Date()
  const y = now.getFullYear(), m = now.getMonth() - 1
  const d = new Date(y, m, 1)
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  return {
    from: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`,
    to: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`,
    label: d.toLocaleString('en-IN', { month: 'short', year: '2-digit' }),
  }
}

const fy = currentFY()

export default function LedgerPage() {
  const [partyName, setPartyName] = useState<string>('')
  const [partyQuery, setPartyQuery] = useState<string>('')
  const [partyDropdownOpen, setPartyDropdownOpen] = useState(false)
  const [preset, setPreset] = useState<Preset>('fy-current')
  const [dateFrom, setDateFrom] = useState<string>(fy.from)
  const [dateTo, setDateTo] = useState<string>(fy.to)
  const [sharing, setSharing] = useState(false)
  const shareRef = useRef<HTMLDivElement>(null)

  // Hydrate last selection
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('ledger.state')
      if (!saved) return
      const s = JSON.parse(saved)
      if (typeof s.partyName === 'string') setPartyName(s.partyName)
      if (typeof s.preset === 'string') setPreset(s.preset)
      if (typeof s.dateFrom === 'string') setDateFrom(s.dateFrom)
      if (typeof s.dateTo === 'string') setDateTo(s.dateTo)
    } catch {}
  }, [])
  useEffect(() => {
    try { sessionStorage.setItem('ledger.state', JSON.stringify({ partyName, preset, dateFrom, dateTo })) } catch {}
  }, [partyName, preset, dateFrom, dateTo])

  // Apply preset to dates
  function applyPreset(p: Preset) {
    setPreset(p)
    if (p === 'fy-current') { const r = currentFY(); setDateFrom(r.from); setDateTo(r.to) }
    else if (p === 'fy-prior') { const r = priorFY(); setDateFrom(r.from); setDateTo(r.to) }
    else if (p === 'this-month') { const r = thisMonth(); setDateFrom(r.from); setDateTo(r.to) }
    else if (p === 'last-month') { const r = lastMonth(); setDateFrom(r.from); setDateTo(r.to) }
    // 'custom' leaves dates as the user set them
  }

  // Party dropdown — searches the KSI ledger master
  const debouncedQuery = useDebounce(partyQuery, 250)
  const { data: partyData } = useSWR<{ ledgers: LedgerOption[] }>(
    partyDropdownOpen || debouncedQuery ? `/api/tally/ledgers?firm=KSI&search=${encodeURIComponent(debouncedQuery)}&limit=50` : null,
    fetcher,
    { revalidateOnFocus: false },
  )
  const partyOptions = partyData?.ledgers ?? []

  // Ledger data
  const swrKey = partyName ? `/api/tally/ksi-party?name=${encodeURIComponent(partyName)}&dateFrom=${dateFrom}&dateTo=${dateTo}` : null
  const { data, isLoading } = useSWR<PartyData>(swrKey, fetcher, { revalidateOnFocus: false, keepPreviousData: true })

  // Running balance — Dr = Sales/Debit Note, Cr = Receipt/Payment/Credit Note/Purchase
  const statement = useMemo(() => {
    let balance = 0
    return (data?.vouchers ?? []).map(v => {
      const isDebit = ['Sales', 'Debit Note', 'Process Job'].includes(v.vchType || '')
      const isCredit = ['Receipt', 'Payment', 'Credit Note', 'Purchase'].includes(v.vchType || '')
      const debit = isDebit ? v.amount : 0
      const credit = isCredit ? v.amount : 0
      balance += debit - credit
      return { ...v, debit, credit, balance }
    })
  }, [data?.vouchers])

  const totals = useMemo(() => {
    const dr = statement.reduce((s, r) => s + r.debit, 0)
    const cr = statement.reduce((s, r) => s + r.credit, 0)
    return { dr, cr, closing: statement.at(-1)?.balance ?? 0 }
  }, [statement])

  async function shareWhatsApp() {
    if (!shareRef.current || !data?.ledger) return
    setSharing(true)
    try {
      const html2canvas = (await import('html2canvas')).default
      const canvas = await html2canvas(shareRef.current, { backgroundColor: '#ffffff', scale: 2 })
      canvas.toBlob(async (blob) => {
        if (!blob) return
        const file = new File([blob], `Ledger-${data.ledger?.name}-${dateFrom}-to-${dateTo}.png`, { type: 'image/png' })
        if (typeof navigator !== 'undefined' && (navigator as any).canShare?.({ files: [file] })) {
          try { await (navigator as any).share({ files: [file], title: `Ledger ${data.ledger?.name}` }); return } catch {}
        }
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url; a.download = file.name; a.click()
        URL.revokeObjectURL(url)
      }, 'image/png')
    } finally { setSharing(false) }
  }

  function exportExcel() {
    if (!data?.ledger) return
    import('xlsx').then(XLSX => {
      const rows = statement.map(r => ({
        Date: fmtDateSlash(r.date),
        Type: r.vchType ?? '',
        'Voucher No': r.vchNumber ?? '',
        Particulars: r.itemName ?? r.narration ?? '',
        Debit: r.debit || '',
        Credit: r.credit || '',
        Balance: r.balance,
      }))
      const ws = XLSX.utils.json_to_sheet(rows)
      ws['!cols'] = [{ wch: 11 }, { wch: 12 }, { wch: 16 }, { wch: 32 }, { wch: 12 }, { wch: 12 }, { wch: 14 }]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Statement')
      XLSX.writeFile(wb, `Ledger-${data.ledger?.name}-${dateFrom}-to-${dateTo}.xlsx`)
    })
  }

  return (
    <div className="max-w-3xl mx-auto p-3">
      <div className="flex items-center gap-2 mb-3">
        <BackButton fallback="/accounts" />
        <h1 className="text-base font-bold text-gray-800 dark:text-gray-100">Ledger</h1>
      </div>

      {/* Party + Date controls */}
      <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl p-3 mb-3 space-y-2.5">
        <div className="relative">
          <label className="text-[10px] text-gray-500 dark:text-gray-400 block mb-0.5">Party</label>
          <input
            value={partyDropdownOpen ? partyQuery : (partyName || '')}
            placeholder="Search ledger by name / GSTIN…"
            onFocus={() => { setPartyDropdownOpen(true); setPartyQuery('') }}
            onChange={e => { setPartyQuery(e.target.value); setPartyDropdownOpen(true) }}
            onBlur={() => setTimeout(() => setPartyDropdownOpen(false), 150)}
            className="w-full px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
          />
          {partyDropdownOpen && partyOptions.length > 0 && (
            <div className="absolute z-30 mt-1 w-full max-h-72 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg">
              {partyOptions.map(l => (
                <button key={l.id}
                  onMouseDown={e => { e.preventDefault(); setPartyName(l.name); setPartyQuery(''); setPartyDropdownOpen(false) }}
                  className="block w-full text-left px-2.5 py-1.5 text-sm hover:bg-indigo-50 dark:hover:bg-indigo-900/30 border-b border-gray-100 dark:border-gray-700 last:border-b-0">
                  <div className="font-medium text-gray-800 dark:text-gray-100">{l.name}</div>
                  <div className="text-[10px] text-gray-500 flex gap-2">
                    {l.parent && <span>{l.parent}</span>}
                    {l.gstNo && <span className="font-mono">GST: {l.gstNo}</span>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="text-[10px] text-gray-500 dark:text-gray-400 mb-1">Range</div>
          <div className="flex flex-wrap gap-1.5">
            {([
              ['fy-current', currentFY().label],
              ['fy-prior', priorFY().label],
              ['this-month', thisMonth().label],
              ['last-month', lastMonth().label],
              ['custom', 'Custom'],
            ] as [Preset, string][]).map(([k, lbl]) => (
              <button key={k} onClick={() => applyPreset(k)}
                className={`text-[11px] px-2.5 py-1 rounded-full border transition ${
                  preset === k
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'
                }`}>
                {lbl}
              </button>
            ))}
          </div>
          {preset === 'custom' && (
            <div className="flex items-center gap-1.5 mt-2 text-[11px]">
              <span className="text-gray-500">From</span>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                className="px-1.5 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700" />
              <span className="text-gray-500">to</span>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                className="px-1.5 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700" />
            </div>
          )}
        </div>
      </div>

      {/* Empty / loading */}
      {!partyName && <div className="text-center text-sm text-gray-400 py-8">Pick a party to view the ledger.</div>}
      {partyName && isLoading && <div className="text-center text-sm text-gray-400 py-8">Loading ledger…</div>}

      {/* Statement table — also the share canvas */}
      {partyName && data && (
        <>
          <div ref={shareRef} className="bg-white border border-gray-200 rounded-xl p-3 mb-3" style={{ color: '#000' }}>
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="min-w-0">
                <div className="text-base font-bold">{data.ledger?.name ?? partyName}</div>
                <div className="text-[10px] text-gray-600 space-y-0.5 mt-0.5">
                  {data.ledger?.gstNo && <div>GSTIN: <span className="font-mono">{data.ledger.gstNo}</span></div>}
                  {data.ledger?.address && <div className="truncate">{data.ledger.address}</div>}
                  {data.ledger?.mobileNos && <div>📞 {data.ledger.mobileNos}</div>}
                </div>
              </div>
              <div className="text-right shrink-0 text-[10px] text-gray-600">
                <div>Ledger Statement</div>
                <div>{fmtDateSlash(dateFrom)} — {fmtDateSlash(dateTo)}</div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center text-[10px] my-2 border-y border-gray-200 py-1.5">
              <div>
                <div className="text-gray-500 uppercase">Σ Debit</div>
                <div className="font-bold tabular-nums">₹{fmtMoney(totals.dr)}</div>
              </div>
              <div>
                <div className="text-gray-500 uppercase">Σ Credit</div>
                <div className="font-bold tabular-nums">₹{fmtMoney(totals.cr)}</div>
              </div>
              <div>
                <div className="text-gray-500 uppercase">Closing</div>
                <div className={`font-bold tabular-nums ${totals.closing >= 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                  ₹{fmtMoney(totals.closing)} {totals.closing >= 0 ? 'Dr' : 'Cr'}
                </div>
              </div>
            </div>

            <table className="w-full text-[11px]" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #000' }}>
                  <th className="px-1.5 py-1 text-left text-[10px] uppercase tracking-wide">Date</th>
                  <th className="px-1.5 py-1 text-left text-[10px] uppercase tracking-wide">Type</th>
                  <th className="px-1.5 py-1 text-left text-[10px] uppercase tracking-wide">Vch No</th>
                  <th className="px-1.5 py-1 text-left text-[10px] uppercase tracking-wide">Particulars</th>
                  <th className="px-1.5 py-1 text-right text-[10px] uppercase tracking-wide">Debit</th>
                  <th className="px-1.5 py-1 text-right text-[10px] uppercase tracking-wide">Credit</th>
                  <th className="px-1.5 py-1 text-right text-[10px] uppercase tracking-wide">Balance</th>
                </tr>
              </thead>
              <tbody>
                {statement.length === 0 ? (
                  <tr><td colSpan={7} className="text-center text-gray-400 py-3">No vouchers in range.</td></tr>
                ) : statement.map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td className="px-1.5 py-1 whitespace-nowrap">{fmtDateSlash(r.date)}</td>
                    <td className="px-1.5 py-1 whitespace-nowrap">{r.vchType ?? '—'}</td>
                    <td className="px-1.5 py-1 font-mono whitespace-nowrap">{r.vchNumber ?? '—'}</td>
                    <td className="px-1.5 py-1 truncate" style={{ maxWidth: 180 }} title={r.itemName ?? r.narration ?? ''}>
                      {r.itemName ?? r.narration ?? '—'}
                    </td>
                    <td className="px-1.5 py-1 text-right tabular-nums">{r.debit ? `₹${fmtMoney(r.debit)}` : '—'}</td>
                    <td className="px-1.5 py-1 text-right tabular-nums">{r.credit ? `₹${fmtMoney(r.credit)}` : '—'}</td>
                    <td className="px-1.5 py-1 text-right tabular-nums font-semibold">
                      ₹{fmtMoney(r.balance)} <span className="text-[9px] text-gray-500">{r.balance >= 0 ? 'Dr' : 'Cr'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="text-[9px] text-gray-500 mt-2 text-center">
              {statement.length} entries · Dr = party owes us · Cr = party paid / credit-noted
            </div>
          </div>

          <div className="flex flex-wrap gap-2 justify-end">
            <button onClick={exportExcel}
              className="px-3 py-1.5 rounded-lg border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-xs font-semibold">
              📥 Excel
            </button>
            <button onClick={shareWhatsApp} disabled={sharing}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold">
              {sharing ? 'Rendering…' : '📤 Share PNG on WhatsApp'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function useDebounce<T>(value: T, delay = 250): T {
  const [d, setD] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setD(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return d
}
