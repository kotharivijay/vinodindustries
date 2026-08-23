'use client'

import { useState, useMemo } from 'react'
import useSWR from 'swr'
import BackButton from '../../BackButton'
import { makeChallanReportPdf, challanReportFileName, type ChallanReportPayload } from './pdf'

const fetcher = (url: string) => fetch(url).then(r => r.json())
const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
const fmtFull = (d: string) => new Date(d).toLocaleDateString('en-IN')

type Tab = 'party' | 'register'
type Period = 'today' | 'yesterday' | 'week' | 'month' | 'custom'

// Raw API shape — one entry per challan line (a lot repeats per dye slip).
type ApiLot = { lot: string; marka: string; quality: string; dyeSlip: string; than: number }
type ApiChallan = { no: number; party: string; date: string; status: string; lots: ApiLot[] }

// Local YYYY-MM-DD. .toISOString() converts to UTC first, which shifts IST
// midnight back 5h30m and leaks the previous day into the range — same trap
// (and same fix) as the dyeing production report.
const fmt = (d: Date) => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// offset unit follows the period: days for today/yesterday, weeks for week,
// MONTHS for month (so Prev/Next steps a real calendar month, not 30 days).
function getDateRange(period: Period, offset: number): { from: string; to: string; label: string } {
  const now = new Date()
  if (period === 'month') now.setMonth(now.getMonth() + offset)
  else if (period === 'week') now.setDate(now.getDate() + offset * 7)
  else now.setDate(now.getDate() + offset)

  switch (period) {
    case 'today':
    case 'yesterday': {
      const d = new Date(now)
      if (period === 'yesterday') d.setDate(d.getDate() - 1)
      const s = fmt(d)
      return { from: s, to: s, label: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) }
    }
    case 'week': {
      const start = new Date(now)
      start.setDate(start.getDate() - start.getDay())
      const end = new Date(start)
      end.setDate(end.getDate() + 6)
      return { from: fmt(start), to: fmt(end), label: `${fmtDate(fmt(start))} — ${fmtDate(fmt(end))}` }
    }
    case 'month': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1)
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      return { from: fmt(start), to: fmt(end), label: now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) }
    }
    default:
      return { from: fmt(now), to: fmt(now), label: 'Custom' }
  }
}

export default function DeliveryChallanReportPage() {
  const [period, setPeriod] = useState<Period>('today')
  const [offset, setOffset] = useState(0)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [tab, setTab] = useState<Tab>('party')
  const [openParties, setOpenParties] = useState<Set<string>>(new Set())
  const [openChallans, setOpenChallans] = useState<Set<number>>(new Set())
  const [exporting, setExporting] = useState(false)

  const range = useMemo(() => {
    if (period === 'custom' && customFrom && customTo) return { from: customFrom, to: customTo, label: `${fmtDate(customFrom)} — ${fmtDate(customTo)}` }
    return getDateRange(period, offset)
  }, [period, offset, customFrom, customTo])

  const { data, isLoading } = useSWR<{ challans: ApiChallan[] }>(
    range.from && range.to ? `/api/delivery-challan/report?from=${range.from}&to=${range.to}` : null,
    fetcher, { revalidateOnFocus: false },
  )

  // ── Merge + group. The SAME lot can appear many times on one challan under
  // different dye slips — collapse to one row per lot, sum the than, and list
  // the slips. Total than is computed from the RAW lines so the merge can
  // never silently change the headline number.
  const report = useMemo(() => {
    const challans = data?.challans ?? []
    const merged = challans.map(c => {
      const byLot = new Map<string, { lot: string; marka: string; quality: string; slips: Set<string>; than: number }>()
      for (const l of c.lots) {
        const key = l.lot.toLowerCase().trim()
        if (!byLot.has(key)) byLot.set(key, { lot: l.lot, marka: l.marka, quality: l.quality, slips: new Set(), than: 0 })
        const e = byLot.get(key)!
        e.than += l.than
        if (l.dyeSlip) e.slips.add(l.dyeSlip)
        if (!e.marka && l.marka) e.marka = l.marka
        if (!e.quality && l.quality) e.quality = l.quality
      }
      const lots = [...byLot.values()]
        .sort((a, b) => a.lot.localeCompare(b.lot))
        .map(r => ({
          lot: r.lot, marka: r.marka, quality: r.quality, than: r.than,
          dyeSlips: [...r.slips].sort((a, b) => Number(a) - Number(b)).join(', '),
        }))
      return { no: c.no, party: c.party, date: c.date, status: c.status, lots, than: c.lots.reduce((s, l) => s + l.than, 0) }
    })

    const byParty = new Map<string, typeof merged>()
    for (const c of merged) {
      if (!byParty.has(c.party)) byParty.set(c.party, [])
      byParty.get(c.party)!.push(c)
    }
    const parties = [...byParty.entries()]
      .map(([name, cs]) => ({
        name,
        challans: [...cs].sort((a, b) => b.no - a.no),
        than: cs.reduce((s, c) => s + c.than, 0),
        challanCount: cs.length,
      }))
      .sort((a, b) => b.than - a.than)          // parties by total than, desc

    return {
      challans: [...merged].sort((a, b) => b.no - a.no),   // register: newest challan no first
      parties,
      summary: {
        totalThan: merged.reduce((s, c) => s + c.than, 0),
        challans: merged.length,
        lots: merged.reduce((s, c) => s + c.lots.length, 0),
      },
    }
  }, [data])

  const toggleParty = (n: string) => setOpenParties(p => { const s = new Set(p); s.has(n) ? s.delete(n) : s.add(n); return s })
  const toggleChallan = (n: number) => setOpenChallans(p => { const s = new Set(p); s.has(n) ? s.delete(n) : s.add(n); return s })

  function navigate(dir: number) {
    if (period !== 'custom') setOffset(prev => prev + dir)
  }

  async function handleExportExcel() {
    if (!report.summary.challans) return
    setExporting(true)
    try {
      const XLSX = await import('xlsx')
      const rows: any[][] = []
      rows.push([`KSI — Delivery Challan Report — ${range.label}`])
      rows.push([`Total Than: ${report.summary.totalThan}`, `Challans: ${report.summary.challans}`, `Lots: ${report.summary.lots}`])
      rows.push([])
      const headers = ['Lot No', 'Marka', 'Quality', 'Dye Slips', 'Than']
      for (const p of report.parties) {
        rows.push([`PARTY: ${p.name}`, '', '', `${p.challanCount} challan(s)`, p.than])
        for (const c of p.challans) {
          rows.push([`Challan ${c.no}`, fmtFull(c.date), '', `${c.lots.length} lots`, c.than])
          rows.push(headers)
          for (const l of c.lots) rows.push([l.lot, l.marka || '-', l.quality || '-', l.dyeSlips || '-', l.than])
          rows.push([])
        }
      }
      rows.push([])
      rows.push(['GRAND TOTAL', '', '', '', report.summary.totalThan])
      const ws = XLSX.utils.aoa_to_sheet(rows)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Challan Report')
      XLSX.writeFile(wb, challanReportFileName(range.label, 'xlsx'))
    } catch (err) {
      console.error('Excel export failed:', err)
      alert('Excel export failed — see console')
    } finally {
      setExporting(false)
    }
  }

  async function handleExportPdf() {
    if (!report.summary.challans) return
    setExporting(true)
    try {
      const doc = makeChallanReportPdf(report as unknown as ChallanReportPayload, range.label)
      doc.save(challanReportFileName(range.label, 'pdf'))
    } catch (err) {
      console.error('PDF export failed:', err)
      alert('PDF export failed — see console')
    } finally {
      setExporting(false)
    }
  }

  // Shared lot table — used by both tabs so the two views can't drift apart.
  const LotTable = ({ lots }: { lots: { lot: string; marka: string; quality: string; dyeSlips: string; than: number }[] }) => (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-700">
            <th className="py-1.5 pr-2 font-semibold">Lot No</th>
            <th className="py-1.5 pr-2 font-semibold">Marka</th>
            <th className="py-1.5 pr-2 font-semibold">Quality</th>
            <th className="py-1.5 pr-2 font-semibold">Dye Slips</th>
            <th className="py-1.5 pl-2 font-semibold text-right">Than</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
          {lots.map(l => (
            <tr key={l.lot}>
              <td className="py-1.5 pr-2 font-mono text-gray-700 dark:text-gray-200">{l.lot}</td>
              <td className="py-1.5 pr-2 text-gray-600 dark:text-gray-300">{l.marka || '-'}</td>
              <td className="py-1.5 pr-2 text-gray-500 dark:text-gray-400">{l.quality || '-'}</td>
              <td className="py-1.5 pr-2 font-mono text-purple-600 dark:text-purple-400">{l.dyeSlips || '-'}</td>
              <td className="py-1.5 pl-2 text-right font-bold text-gray-800 dark:text-gray-100">{l.than}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  return (
    <div className="p-4 md:p-6 dark:text-gray-100">
      <div className="flex items-center gap-3 mb-5">
        <BackButton />
        <h1 className="text-lg sm:text-xl font-bold text-gray-800 dark:text-gray-100">Delivery Challan Report</h1>
      </div>

      {/* Exports */}
      <div className="flex gap-2 mb-3">
        <button onClick={handleExportExcel} disabled={exporting || !report.summary.challans}
          className="flex-1 sm:flex-none text-xs bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white px-4 py-2 rounded-lg font-medium"
          title="Export the current range to Excel">
          {exporting ? 'Exporting…' : '⬇ Excel'}
        </button>
        <button onClick={handleExportPdf} disabled={exporting || !report.summary.challans}
          className="flex-1 sm:flex-none text-xs bg-rose-600 hover:bg-rose-500 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white px-4 py-2 rounded-lg font-medium"
          title="Export the current range to PDF">
          {exporting ? 'Exporting…' : '⬇ PDF'}
        </button>
      </div>

      {/* Period chips */}
      <div className="flex flex-wrap gap-2 mb-3">
        {(['today', 'yesterday', 'week', 'month', 'custom'] as Period[]).map(p => (
          <button key={p} onClick={() => { setPeriod(p); setOffset(0) }}
            className={`text-xs px-3 py-1.5 rounded-lg border font-medium ${period === p
              ? 'bg-purple-100 dark:bg-purple-900/30 border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300'
              : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400'}`}>
            {p === 'today' ? 'Today' : p === 'yesterday' ? 'Yesterday' : p === 'week' ? 'This Week' : p === 'month' ? 'This Month' : 'Custom'}
          </button>
        ))}
      </div>

      {/* Pager (hidden in Custom — two date inputs instead) */}
      {period === 'custom' ? (
        <div className="flex flex-wrap gap-2 mb-4">
          <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
            className="text-xs border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 dark:text-gray-100" />
          <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
            className="text-xs border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 dark:text-gray-100" />
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 mb-4 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl px-3 py-2">
          <button onClick={() => navigate(-1)} className="text-sm text-gray-600 dark:text-gray-300 px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">← Prev</button>
          <span className="text-sm font-semibold text-gray-700 dark:text-gray-200 text-center">{range.label}</span>
          <button onClick={() => navigate(1)} className="text-sm text-gray-600 dark:text-gray-300 px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">Next →</button>
        </div>
      )}

      {isLoading && <div className="p-12 text-center text-gray-400">Loading...</div>}

      {!isLoading && data && (
        <>
          {/* Stat cards — than only */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4 mb-3">
            <p className="text-[10px] text-gray-500 uppercase tracking-wide">Total Than</p>
            <p className="text-3xl font-bold text-purple-600 dark:text-purple-400">{report.summary.totalThan.toLocaleString('en-IN')}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-5">
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-3">
              <p className="text-[10px] text-gray-500 uppercase tracking-wide">Challans</p>
              <p className="text-xl font-bold text-gray-800 dark:text-gray-100">{report.summary.challans}</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-3">
              <p className="text-[10px] text-gray-500 uppercase tracking-wide">Lots</p>
              <p className="text-xl font-bold text-gray-800 dark:text-gray-100">{report.summary.lots}</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mb-4 border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
            {([['party', 'Party-wise'], ['register', 'Challan Register']] as [Tab, string][]).map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`px-4 py-2 text-xs font-medium border-b-2 transition -mb-px whitespace-nowrap ${tab === k
                  ? 'border-purple-600 text-purple-600 dark:text-purple-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700'}`}>
                {label}
              </button>
            ))}
          </div>

          {report.summary.challans === 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-8 text-center text-gray-400 text-sm">
              No delivery challans in the selected range.
            </div>
          )}

          {/* ── Party-wise: party → challan → lots ── */}
          {tab === 'party' && report.parties.map(p => {
            const openP = openParties.has(p.name)
            return (
              <div key={p.name} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden mb-2">
                <button onClick={() => toggleParty(p.name)} className="w-full px-4 py-3 flex items-center justify-between gap-2 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition">
                  <span className="flex items-center gap-2 min-w-0 text-left">
                    <span className={`text-gray-400 text-[10px] transition-transform shrink-0 ${openP ? 'rotate-90' : ''}`}>▶</span>
                    <span className="min-w-0">
                      <span className="block text-sm font-bold text-gray-800 dark:text-gray-100 truncate">{p.name}</span>
                      <span className="block text-[11px] text-gray-500 dark:text-gray-400">{p.challanCount} challan{p.challanCount === 1 ? '' : 's'}</span>
                    </span>
                  </span>
                  <span className="text-right shrink-0">
                    <span className="block text-lg font-bold text-gray-800 dark:text-gray-100 leading-none">{p.than}</span>
                    <span className="block text-[10px] text-gray-400 uppercase">than</span>
                  </span>
                </button>

                {openP && (
                  <div className="border-t border-gray-100 dark:border-gray-700 px-2 sm:px-3 py-2 space-y-2 bg-gray-50/50 dark:bg-gray-900/30">
                    {p.challans.map(c => {
                      const openC = openChallans.has(c.no)
                      return (
                        <div key={c.no} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 overflow-hidden">
                          <button onClick={() => toggleChallan(c.no)} className="w-full px-3 py-2 flex items-center justify-between gap-2 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition">
                            <span className="flex items-center gap-2 min-w-0 text-left">
                              <span className={`text-gray-400 text-[10px] transition-transform shrink-0 ${openC ? 'rotate-90' : ''}`}>▶</span>
                              <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400">Challan {c.no}</span>
                              <span className="text-[11px] text-gray-400 whitespace-nowrap">{fmtFull(c.date)}</span>
                            </span>
                            <span className="text-right shrink-0">
                              <span className="block text-sm font-bold text-gray-800 dark:text-gray-100 leading-none">{c.than}</span>
                              <span className="block text-[10px] text-gray-400">{c.lots.length} lots</span>
                            </span>
                          </button>
                          {openC && (
                            <div className="border-t border-gray-100 dark:border-gray-700 px-3 py-2">
                              <LotTable lots={c.lots} />
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}

          {/* ── Challan Register: flat, newest challan no first ── */}
          {tab === 'register' && report.challans.map(c => {
            const openC = openChallans.has(c.no)
            return (
              <div key={c.no} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden mb-2">
                <button onClick={() => toggleChallan(c.no)} className="w-full px-4 py-3 flex items-center justify-between gap-2 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition">
                  <span className="flex items-center gap-2 min-w-0 text-left">
                    <span className={`text-gray-400 text-[10px] transition-transform shrink-0 ${openC ? 'rotate-90' : ''}`}>▶</span>
                    <span className="min-w-0">
                      <span className="block text-sm font-bold text-emerald-700 dark:text-emerald-400">
                        Challan {c.no} <span className="text-[11px] font-normal text-gray-400">{fmtFull(c.date)}</span>
                      </span>
                      <span className="block text-[11px] text-gray-500 dark:text-gray-400 truncate">{c.party} · {c.lots.length} lots</span>
                    </span>
                  </span>
                  <span className="text-right shrink-0">
                    <span className="block text-lg font-bold text-gray-800 dark:text-gray-100 leading-none">{c.than}</span>
                    <span className="block text-[10px] text-gray-400 uppercase">than</span>
                  </span>
                </button>
                {openC && (
                  <div className="border-t border-gray-100 dark:border-gray-700 px-3 sm:px-4 py-2">
                    <LotTable lots={c.lots} />
                  </div>
                )}
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}
