'use client'

import { useState, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import BackButton from '../../BackButton'
import { DUE_BUCKETS, bucketFor } from '@/lib/inv/due-days'
import type { DueBucket } from '@/lib/inv/due-days'

const fetcher = (url: string) => fetch(url).then(r => r.json())
const fmtMoney = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (iso: string) => {
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}-${d.toLocaleString('en-IN', { month: 'short' })}-${String(d.getFullYear()).slice(2)}`
}
// dd/mm/yyyy — used in WhatsApp share text per user preference.
const fmtDateSlash = (iso: string) => {
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

interface OutInvoice { id: number; vchNumber: string; vchType: string; date: string; totalAmount: number; pending: number; dueDays: number }
interface OutParty { name: string; totalPending: number; oldestDueDays: number; invoiceCount: number; onAccount: number; invoices: OutInvoice[] }
interface OutReceipt { id: number; vchNumber: string; vchType: string; date: string; partyName: string; amount: number; linkedCash: number; carryOver: number; unallocated: number; daysSince: number; bankRef: string | null; instrumentNo: string | null; narration: string | null }
interface OutResponse {
  totals: { outstanding: number; onAccount: number; netReceivable: number; parties: number; invoices: number; receipts: number }
  parties: OutParty[]
  receipts: OutReceipt[]
}

type Tab = 'party' | 'invoice' | 'onacc'
const PAGE_SIZE = 6

export default function OutstandingPage() {
  const router = useRouter()
  const { data, isLoading } = useSWR<OutResponse>('/api/accounts/outstanding', fetcher)
  const [tab, setTab] = useState<Tab>('party')
  const [page, setPage] = useState(0)
  const [bucketFilter, setBucketFilter] = useState<DueBucket | 'all'>('all')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [partyQuery, setPartyQuery] = useState('')

  function toggleExpand(name: string) {
    setExpanded(prev => {
      const s = new Set(prev)
      s.has(name) ? s.delete(name) : s.add(name)
      return s
    })
  }

  // Reset pagination when tab or filter changes
  function setTabAndReset(t: Tab) { setTab(t); setPage(0) }
  function setBucketAndReset(b: DueBucket | 'all') { setBucketFilter(b); setPage(0) }

  const allParties = data?.parties ?? []
  const allReceipts = data?.receipts ?? []
  const totals = data?.totals
  const q = partyQuery.trim().toLowerCase()

  // Search filter is applied to all three tabs by partyName.
  const parties = useMemo(
    () => q ? allParties.filter(p => p.name.toLowerCase().includes(q)) : allParties,
    [allParties, q],
  )
  const receipts = useMemo(
    () => q ? allReceipts.filter(r => r.partyName.toLowerCase().includes(q)) : allReceipts,
    [allReceipts, q],
  )

  const flatInvoices = useMemo(() => {
    const list: (OutInvoice & { partyName: string })[] = []
    for (const p of parties) for (const inv of p.invoices) list.push({ ...inv, partyName: p.name })
    if (bucketFilter === 'all') return list.sort((a, b) => b.dueDays - a.dueDays)
    return list.filter(inv => bucketFor(inv.dueDays) === bucketFilter).sort((a, b) => b.dueDays - a.dueDays)
  }, [parties, bucketFilter])

  // Pagination — current page slice for the active tab
  const paged = useMemo(() => {
    const src: any[] = tab === 'party' ? parties : tab === 'invoice' ? flatInvoices : receipts
    const totalPages = Math.max(1, Math.ceil(src.length / PAGE_SIZE))
    const safePage = Math.min(page, totalPages - 1)
    return {
      items: src.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE),
      totalPages, safePage,
    }
  }, [tab, page, parties, flatInvoices, receipts])

  return (
    <div className="max-w-3xl mx-auto p-3 pb-20">
      <div className="flex items-center gap-2 mb-3">
        <BackButton fallback="/accounts/receipts" />
        <h1 className="text-base sm:text-lg font-bold text-gray-800 dark:text-gray-100">Outstanding</h1>
      </div>

      {isLoading && <div className="text-center py-8 text-gray-400 text-sm">Loading…</div>}

      {totals && (
        <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl p-3 mb-3">
          <div className="grid grid-cols-3 gap-2 text-center text-[10px]">
            <div>
              <div className="text-gray-500 dark:text-gray-400">Outstanding</div>
              <div className="text-rose-700 dark:text-rose-400 font-bold tabular-nums">₹{fmtMoney(totals.outstanding)}</div>
            </div>
            <div>
              <div className="text-gray-500 dark:text-gray-400">On-account</div>
              <div className="text-indigo-700 dark:text-indigo-400 font-bold tabular-nums">₹{fmtMoney(totals.onAccount)}</div>
            </div>
            <div>
              <div className="text-gray-500 dark:text-gray-400">Net receivable</div>
              <div className="text-emerald-700 dark:text-emerald-400 font-bold tabular-nums">₹{fmtMoney(totals.netReceivable)}</div>
            </div>
          </div>
          <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-1.5 text-center">
            {totals.parties} parties · {totals.invoices} pending invoices · {totals.receipts} on-account receipts
          </div>
        </div>
      )}

      {/* Party search */}
      <div className="flex items-center gap-1.5 mb-2">
        <input type="search" value={partyQuery}
          onChange={e => { setPartyQuery(e.target.value); setPage(0) }}
          placeholder="🔍 Search party…"
          className="flex-1 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-[12px] placeholder-gray-400" />
        {partyQuery && (
          <button onClick={() => { setPartyQuery(''); setPage(0) }}
            className="text-[11px] px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400">
            ✕ Clear
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5 mb-3 text-[11px] flex-wrap">
        <TabBtn active={tab === 'party'} onClick={() => setTabAndReset('party')}>👥 Party-wise ({parties.length})</TabBtn>
        <TabBtn active={tab === 'invoice'} onClick={() => setTabAndReset('invoice')}>📄 Invoice-wise ({totals?.invoices ?? 0})</TabBtn>
        <TabBtn active={tab === 'onacc'} onClick={() => setTabAndReset('onacc')}>💰 On-account ({receipts.length})</TabBtn>
      </div>

      {tab === 'invoice' && (
        <div className="flex gap-1.5 mb-2 text-[11px] flex-wrap">
          <span className="text-gray-500 dark:text-gray-400 mr-0.5">Bucket:</span>
          <BucketBtn active={bucketFilter === 'all'} onClick={() => setBucketAndReset('all')}>All</BucketBtn>
          {DUE_BUCKETS.slice().reverse().map(b => (
            <BucketBtn key={b.id} active={bucketFilter === b.id} onClick={() => setBucketAndReset(b.id)}>
              {b.color} {b.label}
            </BucketBtn>
          ))}
        </div>
      )}

      {/* Body */}
      <div className="space-y-2">
        {tab === 'party' && paged.items.map((p: OutParty) => (
          <PartyCard key={p.name} party={p}
            isExpanded={expanded.has(p.name)}
            onAccountReceipts={allReceipts.filter(r => r.partyName === p.name)}
            onToggle={() => toggleExpand(p.name)}
            onInvoiceClick={inv => router.push(`/accounts/sales/${inv.id}`)}
            onReceiptClick={r => router.push(`/accounts/receipts/${r.id}?view=all`)}
          />
        ))}
        {tab === 'invoice' && paged.items.map((inv: OutInvoice & { partyName: string }) => (
          <InvoiceCard key={inv.id} inv={inv} onClick={() => router.push(`/accounts/sales/${inv.id}`)} />
        ))}
        {tab === 'onacc' && paged.items.map((r: OutReceipt) => (
          <OnAccountCard key={r.id} receipt={r} onClick={() => router.push(`/accounts/receipts/${r.id}?view=all`)} />
        ))}
        {!isLoading && paged.items.length === 0 && (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400 text-sm border border-dashed rounded-xl">
            {tab === 'party' && 'No parties with outstanding.'}
            {tab === 'invoice' && (bucketFilter === 'all' ? 'No pending invoices.' : `No invoices in this bucket.`)}
            {tab === 'onacc' && 'No on-account receipts.'}
          </div>
        )}
      </div>

      {/* Pagination */}
      {paged.totalPages > 1 && (
        <div className="flex items-center justify-between mt-3 text-[11px]">
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={paged.safePage === 0}
            className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 disabled:opacity-40">
            ← Prev
          </button>
          <span className="text-gray-500 dark:text-gray-400">
            Page {paged.safePage + 1} / {paged.totalPages}
          </span>
          <button onClick={() => setPage(p => Math.min(paged.totalPages - 1, p + 1))} disabled={paged.safePage >= paged.totalPages - 1}
            className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 disabled:opacity-40">
            Next →
          </button>
        </div>
      )}
    </div>
  )
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: any }) {
  return (
    <button onClick={onClick}
      className={`px-3 py-1.5 rounded-full border font-semibold transition ${
        active
          ? 'bg-emerald-600 text-white border-emerald-600'
          : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'
      }`}>
      {children}
    </button>
  )
}
function BucketBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: any }) {
  return (
    <button onClick={onClick}
      className={`px-2.5 py-1 rounded-full border transition ${
        active
          ? 'bg-indigo-600 text-white border-indigo-600'
          : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'
      }`}>
      {children}
    </button>
  )
}

function bucketDot(days: number) {
  return DUE_BUCKETS.find(b => b.id === bucketFor(days))?.color ?? '⚪'
}

function PartyCard({ party, isExpanded, onAccountReceipts, onToggle, onInvoiceClick, onReceiptClick }: {
  party: OutParty; isExpanded: boolean; onAccountReceipts: OutReceipt[];
  onToggle: () => void; onInvoiceClick: (inv: OutInvoice) => void; onReceiptClick: (r: OutReceipt) => void
}) {
  const shareCardRef = useRef<HTMLDivElement>(null)
  const [sharing, setSharing] = useState(false)
  // Drives what subset of the party's invoices the off-screen share
  // card renders for the current page when generating a multi-page
  // PNG. Null = show everything (default UI snapshot).
  const [pageRender, setPageRender] = useState<{
    invoices: OutInvoice[]
    pageIdx: number
    totalPages: number
    includeOnAccount: boolean
  } | null>(null)
  // Tuned so the page comfortably fits a portrait mobile screen with
  // header + three summary chips + footer.
  const ROWS_PER_SHARE_PAGE = 16
  const cardInvoices = pageRender?.invoices ?? party.invoices
  const cardShowOnAccount = pageRender ? pageRender.includeOnAccount : true
  const pageLabel = pageRender && pageRender.totalPages > 1
    ? `Page ${pageRender.pageIdx + 1} of ${pageRender.totalPages}`
    : null
  function buildShareText() {
    const lines: string[] = []
    lines.push(`📋 *Outstanding* — ${party.name}`)
    lines.push(`As of ${fmtDateSlash(new Date().toISOString())}`)
    lines.push('')
    lines.push(`*Pending: ₹${fmtMoney(party.totalPending)}* across ${party.invoiceCount} invoice${party.invoiceCount === 1 ? '' : 's'}`)
    if (party.onAccount > 0) lines.push(`*On-account: ₹${fmtMoney(party.onAccount)}* (cash sitting unallocated)`)
    lines.push('')
    if (party.invoices.length > 0) {
      lines.push(`*Invoices (oldest first):*`)
      // Voucher type dropped, date is dd/mm/yyyy, days moved to the
      // last column. Padding keeps amounts and days aligned in
      // monospaced WhatsApp rendering.
      for (const inv of party.invoices) {
        const dot = bucketDot(inv.dueDays)
        const num = inv.vchNumber.padEnd(13)
        const date = fmtDateSlash(inv.date)
        const amt = `₹${fmtMoney(inv.pending)}`.padEnd(12)
        lines.push(`${dot} ${num} ${date}  ${amt} ${String(inv.dueDays).padStart(3)}d`)
      }
    }
    if (onAccountReceipts.length > 0) {
      lines.push('')
      lines.push(`*On-account receipts:*`)
      for (const r of onAccountReceipts) {
        // Fully unallocated → just date + amount.
        // Partially allocated (linked > 0 or carry-over > 0) → also
        // show the pending portion next to the original amount.
        const partial = r.linkedCash > 0.5 || r.carryOver > 0.5
        const tail = partial ? `  pend ₹${fmtMoney(r.unallocated)}` : ''
        lines.push(`💰 ${fmtDateSlash(r.date)}  ₹${fmtMoney(r.amount)}${tail}`)
      }
    }
    if (party.invoiceCount > 0 && party.onAccount > 0) {
      lines.push('')
      lines.push(`Net receivable: ₹${fmtMoney(party.totalPending - party.onAccount)}`)
    }
    return lines.join('\n')
  }
  async function shareWhatsApp(e: React.MouseEvent) {
    e.stopPropagation()
    const text = buildShareText()
    setSharing(true)
    try {
      if (!shareCardRef.current) throw new Error('share card not mounted')
      const html2canvas = (await import('html2canvas')).default

      // Slice the invoice list into ~16-row pages so the PNG height
      // fits a portrait mobile screen. The on-account section is
      // appended only on the last page so it shows up exactly once.
      const safeName = party.name.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '')
      const chunks: OutInvoice[][] = []
      for (let i = 0; i < party.invoices.length; i += ROWS_PER_SHARE_PAGE) {
        chunks.push(party.invoices.slice(i, i + ROWS_PER_SHARE_PAGE))
      }
      // No invoices but maybe on-account → still produce one page.
      if (chunks.length === 0) chunks.push([])

      const files: File[] = []
      for (let i = 0; i < chunks.length; i++) {
        const isLast = i === chunks.length - 1
        setPageRender({
          invoices: chunks[i], pageIdx: i, totalPages: chunks.length,
          includeOnAccount: isLast && onAccountReceipts.length > 0,
        })
        // Wait two animation frames + a microtask so React commits the
        // state into the off-screen DOM before html2canvas captures it.
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(null))))
        const canvas = await html2canvas(shareCardRef.current!, {
          scale: 2, backgroundColor: '#ffffff', logging: false, useCORS: true,
        })
        const blob: Blob | null = await new Promise(r => canvas.toBlob(b => r(b), 'image/png'))
        if (blob) {
          const suffix = chunks.length > 1 ? `-p${i + 1}of${chunks.length}` : ''
          files.push(new File([blob], `outstanding-${safeName}${suffix}.png`, { type: 'image/png' }))
        }
      }
      setPageRender(null)

      if (files.length === 0) throw new Error('no PNG generated')

      // Native share with files — supports multi-file on iOS Safari 15+
      // and Chrome 102+ Android. Send all pages in one go so WhatsApp
      // can attach them together.
      if (typeof navigator !== 'undefined' && (navigator as any).canShare?.({ files })) {
        try {
          await (navigator as any).share({ title: `Outstanding — ${party.name}`, text, files })
          return
        } catch { return /* user cancelled */ }
      }
      // Some browsers only allow one file; try one-by-one.
      if (files.length > 1 && typeof navigator !== 'undefined' && (navigator as any).canShare?.({ files: [files[0]] })) {
        for (const f of files) {
          try { await (navigator as any).share({ title: f.name, files: [f] }) } catch { return }
        }
        return
      }
      // Fallback: download all PNGs sequentially.
      for (const f of files) {
        const url = URL.createObjectURL(f)
        const a = document.createElement('a')
        a.href = url; a.download = f.name
        document.body.appendChild(a); a.click(); a.remove()
        URL.revokeObjectURL(url)
        await new Promise(r => setTimeout(r, 200))
      }
      return
    } catch (err: any) {
      console.error('Image share failed', err)
    } finally {
      setSharing(false)
      setPageRender(null)
    }
    // Last-resort text fallback
    if (typeof navigator !== 'undefined' && (navigator as any).share) {
      try { await (navigator as any).share({ title: `Outstanding — ${party.name}`, text }); return } catch { /* */ }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
  }

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl shadow-sm">
      <button onClick={onToggle} className="w-full text-left p-3">
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">{party.name}</div>
            <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
              {party.invoiceCount > 0 && (
                <span>{party.invoiceCount} invoice{party.invoiceCount === 1 ? '' : 's'} · oldest {party.oldestDueDays}d {bucketDot(party.oldestDueDays)}</span>
              )}
              {party.invoiceCount > 0 && party.onAccount > 0 && <span> · </span>}
              {party.onAccount > 0 && (
                <span className="text-indigo-600 dark:text-indigo-400">on-acc ₹{fmtMoney(party.onAccount)}</span>
              )}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-base font-bold text-rose-700 dark:text-rose-400 tabular-nums">₹{fmtMoney(party.totalPending)}</div>
            <div className="text-[10px] text-gray-400">{isExpanded ? '▲' : '▼'}</div>
          </div>
        </div>
      </button>
      {isExpanded && (
        <div className="border-t border-gray-100 dark:border-gray-700 p-3 space-y-1.5">
          {party.invoices.map(inv => (
            <button key={inv.id} onClick={() => onInvoiceClick(inv)}
              className="w-full text-left flex items-start justify-between gap-2 py-1 px-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-700/40">
              <div className="min-w-0">
                <div className="text-[11px] flex items-center gap-1.5 flex-wrap">
                  <span>{bucketDot(inv.dueDays)}</span>
                  <span className="font-mono text-indigo-600 dark:text-indigo-300">{inv.vchNumber}</span>
                  <span className="text-gray-500">{fmtDate(inv.date)}</span>
                  <span className="text-rose-600 dark:text-rose-400 font-semibold">{inv.dueDays}d</span>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[11px] font-bold text-gray-800 dark:text-gray-100 tabular-nums">₹{fmtMoney(inv.pending)}</div>
              </div>
            </button>
          ))}
          {onAccountReceipts.length > 0 && (
            <div className="mt-2 pt-2 border-t border-dashed border-gray-200 dark:border-gray-700 space-y-0.5">
              <div className="text-[10px] text-indigo-700 dark:text-indigo-300 font-semibold">
                💰 On-account · ₹{fmtMoney(party.onAccount)}
              </div>
              {onAccountReceipts.map(r => (
                <button key={r.id} onClick={() => onReceiptClick(r)}
                  className="w-full text-left flex items-start justify-between gap-2 py-1 px-1.5 rounded hover:bg-indigo-50 dark:hover:bg-indigo-900/20 text-[11px]">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono text-emerald-700 dark:text-emerald-300">#{r.vchNumber}</span>
                      <span className="text-gray-500">{fmtDate(r.date)}</span>
                      <span className="text-gray-400">{r.daysSince}d ago</span>
                    </div>
                    <div className="text-[10px] text-gray-500 dark:text-gray-400">
                      Receipt ₹{fmtMoney(r.amount)}
                      {r.linkedCash > 0 && <> · linked ₹{fmtMoney(r.linkedCash)}</>}
                      {r.carryOver > 0 && <> · ⏪ ₹{fmtMoney(r.carryOver)}</>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-bold text-indigo-700 dark:text-indigo-400 tabular-nums">
                      ₹{fmtMoney(r.unallocated)}
                    </div>
                    <div className="text-[9px] text-emerald-600 dark:text-emerald-400">→ Allocate</div>
                  </div>
                </button>
              ))}
            </div>
          )}
          <div className="flex justify-end pt-1.5">
            <button onClick={shareWhatsApp} disabled={sharing}
              className="text-[11px] px-2.5 py-1 rounded-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold">
              {sharing ? 'Generating…' : '📤 Share on WhatsApp'}
            </button>
          </div>
        </div>
      )}

      {/* Off-screen render target for the PNG export. Always mounted so
         html2canvas can find it; positioned far off-screen so the user
         doesn't see it. Inline styles keep html2canvas happy (no CSS
         vars or unsupported colour functions). */}
      <div ref={shareCardRef}
        style={{ position: 'fixed', left: '-9999px', top: 0, width: 480, background: '#ffffff', color: '#000000',
          padding: 20, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', boxSizing: 'border-box' }}
        aria-hidden>
        {/* Firm header — repeated on every page so each PNG is
           self-identifying when shared as separate images. */}
        <div style={{ borderBottom: '2px solid #000000', paddingBottom: 6, marginBottom: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: 0.5, color: '#000000' }}>
            KOTHARI SYNTHETIC INDUSTRIES
          </div>
          <div style={{ fontSize: 10, color: '#000000', marginTop: 2 }}>Outstanding Statement</div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.2, color: '#000000' }}>OUTSTANDING</div>
          <div style={{ fontSize: 10, color: '#000000' }}>
            {fmtDateSlash(new Date().toISOString())}
            {pageLabel && <span style={{ marginLeft: 8, fontWeight: 700 }}>· {pageLabel}</span>}
          </div>
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#000000', marginBottom: 10 }}>{party.name}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
          <div style={{ background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: 8, padding: '6px 8px' }}>
            <div style={{ fontSize: 9, color: '#000000', textTransform: 'uppercase', letterSpacing: 0.6 }}>Pending</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#000000' }}>₹{fmtMoney(party.totalPending)}</div>
          </div>
          <div style={{ background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 8, padding: '6px 8px' }}>
            <div style={{ fontSize: 9, color: '#000000', textTransform: 'uppercase', letterSpacing: 0.6 }}>On-account</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#000000' }}>₹{fmtMoney(party.onAccount)}</div>
          </div>
          <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 8, padding: '6px 8px' }}>
            <div style={{ fontSize: 9, color: '#000000', textTransform: 'uppercase', letterSpacing: 0.6 }}>Net receivable</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#000000' }}>₹{fmtMoney(party.totalPending - party.onAccount)}</div>
          </div>
        </div>

        {cardInvoices.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#000000', marginBottom: 4 }}>
              Invoices ({party.invoiceCount}) · oldest first
              {pageLabel && <span style={{ fontWeight: 400, color: '#000000' }}> — {pageLabel}</span>}
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <tbody>
                {cardInvoices.map(inv => (
                  <tr key={inv.id} style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '4px 0', width: 18 }}>{bucketDot(inv.dueDays)}</td>
                    <td style={{ padding: '4px 6px', fontFamily: 'ui-monospace, SFMono-Regular, monospace', color: '#000000' }}>{inv.vchNumber}</td>
                    <td style={{ padding: '4px 6px', color: '#000000' }}>{fmtDateSlash(inv.date)}</td>
                    <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontWeight: 600, color: '#000000' }}>
                      ₹{fmtMoney(inv.pending)}
                    </td>
                    <td style={{ padding: '4px 0', textAlign: 'right', color: '#000000', fontWeight: 600, width: 38 }}>
                      {inv.dueDays}d
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {cardShowOnAccount && onAccountReceipts.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#000000', marginBottom: 4 }}>
              On-account receipts ({onAccountReceipts.length})
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <tbody>
                {onAccountReceipts.map(r => {
                  const partial = r.linkedCash > 0.5 || r.carryOver > 0.5
                  return (
                    <tr key={r.id} style={{ borderTop: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '4px 0', width: 18 }}>💰</td>
                      <td style={{ padding: '4px 6px', color: '#000000' }}>{fmtDateSlash(r.date)}</td>
                      <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontWeight: 600, color: '#000000' }}>
                        ₹{fmtMoney(r.amount)}
                      </td>
                      <td style={{ padding: '4px 0', textAlign: 'right', color: '#000000', width: 110, fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>
                        {partial ? `pend ₹${fmtMoney(r.unallocated)}` : ''}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ borderTop: '1px solid #000000', paddingTop: 6, display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#000000' }}>
          <span>KSI · Outstanding Statement{pageLabel ? ` · ${pageLabel}` : ''}</span>
          <span>Generated {fmtDateSlash(new Date().toISOString())}</span>
        </div>
      </div>
    </div>
  )
}

function InvoiceCard({ inv, onClick }: { inv: OutInvoice & { partyName: string }; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="w-full text-left bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl p-3 shadow-sm hover:border-emerald-300 dark:hover:border-emerald-700/40">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
            <span className="text-base">{bucketDot(inv.dueDays)}</span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300">
              {inv.vchNumber}
            </span>
            <span className="text-[10px] text-rose-600 dark:text-rose-400 font-semibold">{inv.dueDays}d due</span>
          </div>
          <div className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">{inv.partyName}</div>
          <div className="text-[10px] text-gray-500 dark:text-gray-400">{fmtDate(inv.date)}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-base font-bold text-rose-700 dark:text-rose-400 tabular-nums">₹{fmtMoney(inv.pending)}</div>
          {inv.totalAmount !== inv.pending && (
            <div className="text-[10px] text-gray-500 dark:text-gray-400 tabular-nums">of ₹{fmtMoney(inv.totalAmount)}</div>
          )}
        </div>
      </div>
    </button>
  )
}

function OnAccountCard({ receipt, onClick }: { receipt: OutReceipt; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="w-full text-left bg-white dark:bg-gray-800 border border-indigo-200 dark:border-indigo-700/40 rounded-xl p-3 shadow-sm hover:border-indigo-400">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
            <span>💰</span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
              {receipt.vchType} #{receipt.vchNumber}
            </span>
            <span className="text-[10px] text-gray-500">{fmtDate(receipt.date)}</span>
            <span className="text-[10px] text-gray-400">{receipt.daysSince}d ago</span>
          </div>
          <div className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">{receipt.partyName}</div>
          {(receipt.bankRef || receipt.instrumentNo) && (
            <div className="text-[10px] text-indigo-600 dark:text-indigo-400 font-mono truncate">
              {receipt.instrumentNo}{receipt.instrumentNo && receipt.bankRef && ' · '}{receipt.bankRef}
            </div>
          )}
          <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
            Receipt ₹{fmtMoney(receipt.amount)} · linked ₹{fmtMoney(receipt.linkedCash)}
            {receipt.carryOver > 0 && <> · ⏪ ₹{fmtMoney(receipt.carryOver)}</>}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] text-gray-500">unallocated</div>
          <div className="text-base font-bold text-indigo-700 dark:text-indigo-400 tabular-nums">₹{fmtMoney(receipt.unallocated)}</div>
          <div className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-0.5">→ Allocate</div>
        </div>
      </div>
    </button>
  )
}
