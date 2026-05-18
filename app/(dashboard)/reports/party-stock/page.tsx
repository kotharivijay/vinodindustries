'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import useSWR from 'swr'
import BackButton from '../../BackButton'
import { makePartyStockPdf, fileNameFor, variantTitle, type Variant, type ReportPayload } from './pdf'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface PartyOpt { id: number; name: string; tag: string | null }

const TABS: Variant[] = ['A', 'B', 'C']

const fmt = (d: string | null | undefined) => {
  if (!d) return '—'
  const dt = new Date(d)
  return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`
}

export default function PartyStockReportPage() {
  const { data: partyData } = useSWR<{ parties: PartyOpt[] }>(
    '/api/reports/party-stock?action=parties', fetcher, { revalidateOnFocus: false },
  )
  const parties = partyData?.parties ?? []
  const [partyId, setPartyId] = useState<number | null>(null)
  const [partyQuery, setPartyQuery] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [tab, setTab] = useState<Variant>('A')
  const [downloading, setDownloading] = useState<'pdf' | 'xlsx' | 'share' | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selectedParty = useMemo(() => parties.find(p => p.id === partyId) || null, [parties, partyId])

  const filteredParties = useMemo(() => {
    const q = partyQuery.trim().toLowerCase()
    if (!q) return parties.slice(0, 50)
    return parties.filter(p => p.name.toLowerCase().includes(q)).slice(0, 50)
  }, [parties, partyQuery])

  // Restore last-selected party (per-session) so flipping between tabs and
  // hitting back doesn't lose the context.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('reports.partyStock.partyId')
      if (raw) {
        const n = Number(raw)
        if (Number.isFinite(n)) setPartyId(n)
      }
    } catch {}
  }, [])
  useEffect(() => {
    try {
      if (partyId != null) sessionStorage.setItem('reports.partyStock.partyId', String(partyId))
    } catch {}
  }, [partyId])

  const { data: report, isLoading: reportLoading } = useSWR<ReportPayload>(
    partyId != null ? `/api/reports/party-stock?partyId=${partyId}` : null,
    fetcher, { revalidateOnFocus: false },
  )

  function pickParty(p: PartyOpt) {
    setPartyId(p.id)
    setPartyQuery('')
    setDropdownOpen(false)
    inputRef.current?.blur()
  }

  function downloadPdf(variant: Variant) {
    if (!report) return
    setDownloading('pdf')
    try {
      const doc = makePartyStockPdf(variant, report)
      doc.save(fileNameFor(variant, report.party.name, 'pdf'))
    } finally { setDownloading(null) }
  }

  async function sharePdf(variant: Variant) {
    if (!report) return
    setDownloading('share')
    try {
      const doc = makePartyStockPdf(variant, report)
      const blob = doc.output('blob')
      const file = new File([blob], fileNameFor(variant, report.party.name, 'pdf'), { type: 'application/pdf' })
      const title = `${variantTitle(variant)} — ${report.party.name}`
      const text = `${title}\nInward ${report.summary.inwardThan} than · Outward ${report.summary.outwardThan} than · Balance ${report.summary.balance} than`
      // Web Share API → native share sheet (WhatsApp shows up on mobile).
      // Desktop browsers fall back to opening WhatsApp Web with the message
      // and saving the PDF locally for manual attach.
      const nav = navigator as any
      if (nav.share && nav.canShare?.({ files: [file] })) {
        try { await nav.share({ files: [file], title, text }); return } catch { /* user cancelled */ }
      }
      doc.save(fileNameFor(variant, report.party.name, 'pdf'))
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
    } finally { setDownloading(null) }
  }

  async function downloadExcel(variant: Variant) {
    if (!report) return
    setDownloading('xlsx')
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.utils.book_new()

      const header = [
        ['KSI — Party Stock Report'],
        ['Party', report.party.name],
        ['Tag', report.party.tag || ''],
        ['Generated', fmt(new Date().toISOString())],
        [],
        ['Total Inward (than)',  report.summary.inwardThan],
        ['Total Outward (than)', report.summary.outwardThan],
        ['Balance with KSI',     report.summary.balance],
        ['Lots',                 report.summary.lotCount],
        ['Open lots',            report.summary.openLotCount],
        [],
      ]
      const headerWs = XLSX.utils.aoa_to_sheet(header)
      headerWs['!cols'] = [{ wch: 28 }, { wch: 50 }]
      XLSX.utils.book_append_sheet(wb, headerWs, 'Summary')

      if (variant === 'A') {
        const rows = report.perLot.map(r => ({
          'Lot No': r.lotNo, Quality: r.quality,
          'First Inward': fmt(r.firstInward), 'Last Outward': fmt(r.lastOutward),
          Inward: r.inward, Outward: r.outward, Balance: r.balance,
          Status: r.balance === 0 ? 'Cleared' : r.outward === 0 ? 'Not despatched' : 'Partial',
        }))
        const ws = XLSX.utils.json_to_sheet(rows)
        ws['!cols'] = [{ wch: 16 }, { wch: 24 }, { wch: 12 }, { wch: 12 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 16 }]
        XLSX.utils.book_append_sheet(wb, ws, 'Lot Summary')
      } else if (variant === 'B') {
        const txns: any[] = []
        let bal = 0
        const merged = [
          ...report.inwardRows.map(r => ({ ...r, kind: 'IN' as const, signed: r.than, ref: `Ch ${r.challanNo}`, detail: `Bale ${r.baleNo || '—'} · LR ${r.transportLrNo || '—'}` })),
          ...report.outwardRows.map(r => ({ ...r, kind: 'OUT' as const, signed: -r.than, ref: `Ch ${r.challanNo}`, detail: `Bill ${(r as any).billNo || '—'}`, baleNo: '', transportLrNo: '' })),
        ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || (a.kind === 'IN' ? -1 : 1))
        for (const t of merged) {
          bal += t.signed
          txns.push({
            Date: fmt(t.date), Type: t.kind, Ref: t.ref, Lot: t.lotNo, Quality: t.quality,
            Detail: t.detail,
            In: t.kind === 'IN' ? t.than : '',
            Out: t.kind === 'OUT' ? t.than : '',
            Balance: bal,
          })
        }
        const ws = XLSX.utils.json_to_sheet(txns)
        ws['!cols'] = [{ wch: 11 }, { wch: 6 }, { wch: 9 }, { wch: 16 }, { wch: 20 }, { wch: 32 }, { wch: 7 }, { wch: 7 }, { wch: 9 }]
        XLSX.utils.book_append_sheet(wb, ws, 'Ledger')
      } else {
        // C — separate rows for inward + outward, keyed by lot. Two sheets so
        // each one is easy to filter on its own.
        const inwardRows = report.perLot.flatMap(r => r.inwardRows.map(g => ({
          Lot: r.lotNo, Quality: r.quality, Date: fmt(g.date), Challan: g.challanNo,
          Bale: g.baleNo || '', LR: g.transportLrNo || '', Than: g.than,
        })))
        const outwardRows = report.perLot.flatMap(r => r.outwardRows.map(o => ({
          Lot: r.lotNo, Quality: r.quality, Date: fmt(o.date), Challan: o.challanNo,
          Bill: o.billNo || '', Than: o.than,
        })))
        const ws1 = XLSX.utils.json_to_sheet(inwardRows)
        ws1['!cols'] = [{ wch: 16 }, { wch: 24 }, { wch: 11 }, { wch: 8 }, { wch: 18 }, { wch: 18 }, { wch: 7 }]
        XLSX.utils.book_append_sheet(wb, ws1, 'Inward (per lot)')
        const ws2 = XLSX.utils.json_to_sheet(outwardRows)
        ws2['!cols'] = [{ wch: 16 }, { wch: 24 }, { wch: 11 }, { wch: 8 }, { wch: 10 }, { wch: 7 }]
        XLSX.utils.book_append_sheet(wb, ws2, 'Outward (per lot)')
        const summary = report.perLot.map(r => ({
          Lot: r.lotNo, Quality: r.quality, Inward: r.inward, Outward: r.outward, Balance: r.balance,
        }))
        const ws3 = XLSX.utils.json_to_sheet(summary)
        ws3['!cols'] = [{ wch: 16 }, { wch: 24 }, { wch: 9 }, { wch: 9 }, { wch: 9 }]
        XLSX.utils.book_append_sheet(wb, ws3, 'Lot Summary')
      }

      XLSX.writeFile(wb, fileNameFor(variant, report.party.name, 'xlsx'))
    } finally { setDownloading(null) }
  }

  const summaryColor = (n: number) =>
    n > 0 ? 'text-emerald-700 dark:text-emerald-400'
      : n < 0 ? 'text-rose-700 dark:text-rose-400'
      : 'text-gray-500 dark:text-gray-400'

  return (
    <div className="max-w-5xl mx-auto p-3 sm:p-4 pb-20">
      <div className="flex items-center gap-2 mb-3">
        <BackButton fallback="/dashboard" />
        <h1 className="text-base sm:text-lg font-bold text-gray-800 dark:text-gray-100">Party Stock Report</h1>
      </div>

      {/* Party selector */}
      <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl p-3 mb-3">
        <label className="text-[11px] text-gray-500 dark:text-gray-400 block mb-1">Party</label>
        <div className="relative">
          <input ref={inputRef} type="search"
            value={dropdownOpen ? partyQuery : (selectedParty?.name ?? '')}
            placeholder="Search party by name…"
            onFocus={() => { setDropdownOpen(true); setPartyQuery('') }}
            onChange={e => { setPartyQuery(e.target.value); setDropdownOpen(true) }}
            onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm placeholder-gray-400"
          />
          {dropdownOpen && (
            <div className="absolute z-30 mt-1 w-full max-h-80 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg">
              {filteredParties.length === 0 ? (
                <div className="px-3 py-2 text-xs text-gray-400">No matching party.</div>
              ) : filteredParties.map(p => (
                <button key={p.id} onMouseDown={e => { e.preventDefault(); pickParty(p) }}
                  className={`block w-full text-left px-3 py-1.5 text-sm hover:bg-indigo-50 dark:hover:bg-indigo-900/30 border-b border-gray-100 dark:border-gray-700 last:border-b-0 ${p.id === partyId ? 'bg-indigo-50/60 dark:bg-indigo-900/20 font-semibold' : ''}`}>
                  {p.name}
                  {p.tag && <span className="ml-2 text-[10px] bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded-full font-medium">{p.tag}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        {selectedParty?.tag && (
          <div className="mt-1.5 text-[11px] text-gray-500 dark:text-gray-400">
            Tag: <span className="font-medium text-amber-700 dark:text-amber-400">{selectedParty.tag}</span>
          </div>
        )}
      </div>

      {/* Summary cards */}
      {report && (
        <div className="grid grid-cols-3 gap-2 mb-3">
          <SummaryCard label="Inward (than)" value={report.summary.inwardThan} color="text-blue-700 dark:text-blue-400" />
          <SummaryCard label="Outward (than)" value={report.summary.outwardThan} color="text-orange-700 dark:text-orange-400" />
          <SummaryCard label="Balance" value={report.summary.balance} color={summaryColor(report.summary.balance)} />
        </div>
      )}

      {/* Tabs — pill set scrolls horizontally on mobile if it overflows, so
          each pill keeps a tappable size without forcing a wrap mid-label. */}
      {partyId != null && (
        <div className="flex gap-1.5 mb-3 overflow-x-auto -mx-1 px-1 pb-1 sm:flex-wrap">
          {TABS.map(v => (
            <button key={v} onClick={() => setTab(v)}
              className={`px-3 py-2 sm:py-1.5 rounded-lg border transition text-xs whitespace-nowrap shrink-0 ${tab === v
                ? 'bg-indigo-600 text-white border-indigo-600 font-semibold'
                : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600'}`}>
              <span className="sm:hidden">{v}. {variantTitle(v).replace('Stock Report ', '')}</span>
              <span className="hidden sm:inline">{v}. {variantTitle(v)}</span>
            </button>
          ))}
        </div>
      )}

      {/* Desktop export buttons (mobile version is a sticky bottom bar) */}
      {report && (
        <div className="hidden sm:flex flex-wrap gap-2 mb-3">
          <button onClick={() => downloadPdf(tab)} disabled={!!downloading}
            className="text-xs px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-semibold">
            {downloading === 'pdf' ? 'Building…' : '📄 Download PDF'}
          </button>
          <button onClick={() => downloadExcel(tab)} disabled={!!downloading}
            className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold">
            {downloading === 'xlsx' ? 'Building…' : '📊 Download Excel'}
          </button>
          <button onClick={() => sharePdf(tab)} disabled={!!downloading}
            className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold">
            {downloading === 'share' ? 'Sharing…' : '📤 Share PDF'}
          </button>
        </div>
      )}

      {/* Body */}
      {partyId == null && (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400 text-sm border border-dashed rounded-xl">
          Pick a party to view the report.
        </div>
      )}
      {partyId != null && reportLoading && (
        <div className="text-center py-12 text-gray-400 text-sm">Loading…</div>
      )}
      {report && tab === 'A' && <SummaryView data={report} />}
      {report && tab === 'B' && <LedgerView data={report} />}
      {report && tab === 'C' && <LotwiseView data={report} />}

      {/* Mobile sticky action bar — pinned at bottom so export controls are
          always reachable while scrolling a long ledger/lot list. Hidden on
          sm+ where the inline button row already covers this. */}
      {report && (
        <div className="sm:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 dark:bg-gray-900/95 backdrop-blur border-t border-gray-200 dark:border-gray-700 px-2 py-2 flex gap-1.5">
          <button onClick={() => downloadPdf(tab)} disabled={!!downloading}
            className="flex-1 text-[11px] px-2 py-2.5 rounded-lg bg-rose-600 active:bg-rose-700 disabled:opacity-50 text-white font-semibold">
            {downloading === 'pdf' ? '…' : '📄 PDF'}
          </button>
          <button onClick={() => downloadExcel(tab)} disabled={!!downloading}
            className="flex-1 text-[11px] px-2 py-2.5 rounded-lg bg-emerald-600 active:bg-emerald-700 disabled:opacity-50 text-white font-semibold">
            {downloading === 'xlsx' ? '…' : '📊 Excel'}
          </button>
          <button onClick={() => sharePdf(tab)} disabled={!!downloading}
            className="flex-1 text-[11px] px-2 py-2.5 rounded-lg bg-indigo-600 active:bg-indigo-700 disabled:opacity-50 text-white font-semibold">
            {downloading === 'share' ? '…' : '📤 Share'}
          </button>
        </div>
      )}
    </div>
  )
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl p-2 text-center">
      <div className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wide">{label}</div>
      <div className={`text-xl font-bold tabular-nums ${color}`}>{value.toLocaleString('en-IN')}</div>
    </div>
  )
}

// ── Variant A — on-screen view ───────────────────────────────────
function SummaryView({ data }: { data: ReportPayload }) {
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 dark:bg-gray-700/60 border-b border-gray-100 dark:border-gray-700">
            <tr>
              <Th>Lot No</Th>
              <Th>Quality</Th>
              <Th align="center">First In</Th>
              <Th align="center">Last Out</Th>
              <Th align="right">Inward</Th>
              <Th align="right">Outward</Th>
              <Th align="right">Balance</Th>
              <Th align="center">Status</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {data.perLot.map(r => {
              const status = r.balance === 0 ? 'Cleared' : r.outward === 0 ? 'Not despatched' : 'Partial'
              const statusCls = status === 'Cleared' ? 'text-emerald-700 dark:text-emerald-400'
                : status === 'Partial' ? 'text-amber-700 dark:text-amber-400'
                : 'text-blue-700 dark:text-blue-400'
              return (
                <tr key={r.lotNo} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                  <Td><span className="font-bold text-indigo-700 dark:text-indigo-400">{r.lotNo}</span></Td>
                  <Td>{r.quality}</Td>
                  <Td align="center">{fmt(r.firstInward)}</Td>
                  <Td align="center">{fmt(r.lastOutward)}</Td>
                  <Td align="right">{r.inward}</Td>
                  <Td align="right">{r.outward}</Td>
                  <Td align="right"><span className="font-bold">{r.balance}</span></Td>
                  <Td align="center"><span className={`font-semibold ${statusCls}`}>{status}</span></Td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="bg-gray-50 dark:bg-gray-700/60 border-t-2 border-gray-200 dark:border-gray-600">
            <tr>
              <Td colSpan={4}><span className="font-bold uppercase tracking-wide text-[10px] text-gray-500">Total ({data.perLot.length} lots)</span></Td>
              <Td align="right"><span className="font-bold">{data.summary.inwardThan}</span></Td>
              <Td align="right"><span className="font-bold">{data.summary.outwardThan}</span></Td>
              <Td align="right"><span className="font-bold text-indigo-700 dark:text-indigo-400">{data.summary.balance}</span></Td>
              <Td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

// ── Variant B — on-screen view ───────────────────────────────────
function LedgerView({ data }: { data: ReportPayload }) {
  const txns = useMemo(() => {
    const merged = [
      ...data.inwardRows.map(r => ({
        date: r.date, kind: 'IN' as const, ref: `Ch ${r.challanNo}`, lot: r.lotNo, quality: r.quality,
        detail: `Bale ${r.baleNo || '—'} · LR ${r.transportLrNo || '—'}`, signed: r.than,
      })),
      ...data.outwardRows.map(r => ({
        date: r.date, kind: 'OUT' as const, ref: `Ch ${r.challanNo}`, lot: r.lotNo, quality: r.quality,
        detail: `Bill ${r.billNo || '—'}`, signed: -r.than,
      })),
    ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || (a.kind === 'IN' ? -1 : 1))
    let bal = 0
    return merged.map(t => { bal += t.signed; return { ...t, bal } })
  }, [data])
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 dark:bg-gray-700/60 border-b border-gray-100 dark:border-gray-700">
            <tr>
              <Th>Date</Th>
              <Th align="center">Type</Th>
              <Th>Ref</Th>
              <Th>Lot</Th>
              <Th>Quality</Th>
              <Th>Detail</Th>
              <Th align="right">In</Th>
              <Th align="right">Out</Th>
              <Th align="right">Bal</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {txns.map((t, i) => (
              <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                <Td>{fmt(t.date)}</Td>
                <Td align="center"><span className={`font-bold ${t.kind === 'IN' ? 'text-blue-700 dark:text-blue-400' : 'text-orange-700 dark:text-orange-400'}`}>{t.kind}</span></Td>
                <Td>{t.ref}</Td>
                <Td><span className="font-bold text-indigo-700 dark:text-indigo-400">{t.lot}</span></Td>
                <Td>{t.quality}</Td>
                <Td>{t.detail}</Td>
                <Td align="right">{t.kind === 'IN' ? <span className="text-blue-700 dark:text-blue-400">{t.signed}</span> : ''}</Td>
                <Td align="right">{t.kind === 'OUT' ? <span className="text-orange-700 dark:text-orange-400">{Math.abs(t.signed)}</span> : ''}</Td>
                <Td align="right"><span className="font-bold">{t.bal}</span></Td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50 dark:bg-gray-700/60 border-t-2 border-gray-200 dark:border-gray-600">
            <tr>
              <Td colSpan={6}><span className="font-bold uppercase tracking-wide text-[10px] text-gray-500">Total</span></Td>
              <Td align="right"><span className="font-bold text-blue-700 dark:text-blue-400">{data.summary.inwardThan}</span></Td>
              <Td align="right"><span className="font-bold text-orange-700 dark:text-orange-400">{data.summary.outwardThan}</span></Td>
              <Td align="right"><span className="font-bold text-indigo-700 dark:text-indigo-400">{data.summary.balance}</span></Td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

// ── Variant C — on-screen view ───────────────────────────────────
function LotwiseView({ data }: { data: ReportPayload }) {
  return (
    <div className="space-y-3">
      {data.perLot.map(r => (
        <div key={r.lotNo} className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl overflow-hidden">
          {/* Section header: lot + quality + pill row */}
          <div className="px-3 py-2 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="font-bold text-indigo-700 dark:text-indigo-400 text-sm break-words">{r.lotNo}</div>
                <div className="text-[11px] text-gray-500 dark:text-gray-400 break-words">{r.quality}</div>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap shrink-0 text-[10px] font-semibold">
                <span className="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded">In {r.inward}</span>
                <span className="bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 px-1.5 py-0.5 rounded">Out {r.outward}</span>
                <span className={`px-1.5 py-0.5 rounded ${r.balance > 0 ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' : 'bg-gray-100 dark:bg-gray-700 text-gray-500'}`}>
                  Bal {r.balance}
                </span>
              </div>
            </div>
          </div>

          {/* Mobile rows — wrap-friendly. Desktop keeps a tighter table layout. */}
          <div className="sm:hidden divide-y divide-gray-100 dark:divide-gray-700">
            {r.inwardRows.map((g, i) => (
              <div key={`in-${i}`} className="px-3 py-2 flex items-start gap-2">
                <span className="text-[10px] font-bold bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded shrink-0 mt-0.5">IN</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] text-gray-500 dark:text-gray-400">
                    {fmt(g.date)} · Ch {g.challanNo}
                  </div>
                  <div className="text-[11px] text-gray-700 dark:text-gray-200 break-words">
                    Bale {g.baleNo || '—'} · LR {g.transportLrNo || '—'}
                  </div>
                </div>
                <div className="text-sm font-bold tabular-nums shrink-0">{g.than}</div>
              </div>
            ))}
            {r.outwardRows.map((o, i) => (
              <div key={`out-${i}`} className="px-3 py-2 flex items-start gap-2">
                <span className="text-[10px] font-bold bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 px-1.5 py-0.5 rounded shrink-0 mt-0.5">OUT</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] text-gray-500 dark:text-gray-400">
                    {fmt(o.date)} · Ch {o.challanNo}{o.billNo ? ` / Bill ${o.billNo}` : ''}
                  </div>
                </div>
                <div className="text-sm font-bold tabular-nums shrink-0">{o.than}</div>
              </div>
            ))}
          </div>

          {/* Desktop table view — unchanged */}
          <table className="hidden sm:table w-full text-xs">
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {r.inwardRows.map((g, i) => (
                <tr key={`in-${i}`} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                  <Td align="center"><span className="font-bold text-blue-700 dark:text-blue-400">IN</span></Td>
                  <Td>{fmt(g.date)}</Td>
                  <Td>Ch {g.challanNo}</Td>
                  <Td>Bale {g.baleNo || '—'} · LR {g.transportLrNo || '—'}</Td>
                  <Td align="right"><span className="font-bold">{g.than}</span></Td>
                </tr>
              ))}
              {r.outwardRows.map((o, i) => (
                <tr key={`out-${i}`} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                  <Td align="center"><span className="font-bold text-orange-700 dark:text-orange-400">OUT</span></Td>
                  <Td>{fmt(o.date)}</Td>
                  <Td>Ch {o.challanNo}{o.billNo ? ` / Bill ${o.billNo}` : ''}</Td>
                  <Td>—</Td>
                  <Td align="right"><span className="font-bold">{o.than}</span></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' | 'center' }) {
  return <th className={`px-2 py-2 text-${align} text-[10px] font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wide whitespace-nowrap`}>{children}</th>
}
function Td({ children, align = 'left', colSpan }: { children?: React.ReactNode; align?: 'left' | 'right' | 'center'; colSpan?: number }) {
  return <td colSpan={colSpan} className={`px-2 py-1.5 text-${align} text-gray-700 dark:text-gray-200 whitespace-nowrap`}>{children}</td>
}
