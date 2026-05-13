'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'

interface Lot {
  lotNo: string
  remaining: number
  party: string
  partyTag: string | null
  quality: string
  weight: string | null
  marka: string | null
  grayMtr: number | null
  date: string | null
  challanNos: string
  isOB: boolean
  originalThan: number
  deducted: { despatched: number; folded: number; obAllocated: number }
}

interface QualityGroup { quality: string; totalThan: number; lots: Lot[] }
interface PartyGroup { party: string; totalThan: number; totalLots: number; qualities: QualityGroup[] }

interface Response { parties: PartyGroup[]; grandTotal: number; totalLots: number; totalParties: number }

interface Props {
  open: boolean
  onClose: () => void
}

export default function UnallocatedStockModal({ open, onClose }: Props) {
  const [data, setData] = useState<Response | null>(null)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [expandedParties, setExpandedParties] = useState<Set<string>>(new Set())
  const [expandedQualities, setExpandedQualities] = useState<Set<string>>(new Set())
  const [sharingPdf, setSharingPdf] = useState(false)

  // Restore expansion state from sessionStorage
  useEffect(() => {
    if (!open) return
    try {
      const p = sessionStorage.getItem('unallocated-expanded-parties')
      const q = sessionStorage.getItem('unallocated-expanded-qualities')
      const s = sessionStorage.getItem('unallocated-search')
      if (p) setExpandedParties(new Set(JSON.parse(p)))
      if (q) setExpandedQualities(new Set(JSON.parse(q)))
      if (s) setSearch(s)
    } catch {}
    setLoading(true)
    fetch('/api/grey/unallocated-stock', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [open])

  // After data loads, scroll to the lot the user last clicked so they land
  // back on the same row instead of at the top of the modal.
  useEffect(() => {
    if (!open || loading || !data) return
    let lastLot: string | null = null
    try { lastLot = sessionStorage.getItem('unallocated-last-lot') } catch {}
    if (!lastLot) return
    // Wait one frame so the DOM has the rendered lot rows
    const t = setTimeout(() => {
      const el = document.getElementById(`unalloc-lot-${lastLot}`)
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior })
        el.classList.add('ring-2', 'ring-teal-400')
        setTimeout(() => el.classList.remove('ring-2', 'ring-teal-400'), 1500)
      }
      try { sessionStorage.removeItem('unallocated-last-lot') } catch {}
    }, 50)
    return () => clearTimeout(t)
  }, [open, loading, data])

  // Persist expansion state when user interacts
  useEffect(() => {
    if (!open) return
    try {
      sessionStorage.setItem('unallocated-expanded-parties', JSON.stringify(Array.from(expandedParties)))
      sessionStorage.setItem('unallocated-expanded-qualities', JSON.stringify(Array.from(expandedQualities)))
      sessionStorage.setItem('unallocated-search', search)
    } catch {}
  }, [expandedParties, expandedQualities, search, open])

  const filtered = useMemo(() => {
    if (!data) return null
    const q = search.toLowerCase().trim()
    if (!q) return data
    const parties = data.parties.filter(p => {
      const partyMatch = p.party.toLowerCase().includes(q)
      const qualityMatch = p.qualities.some(ql => ql.quality.toLowerCase().includes(q))
      const lotMatch = p.qualities.some(ql => ql.lots.some(l => l.lotNo.toLowerCase().includes(q)))
      return partyMatch || qualityMatch || lotMatch
    })
    return { ...data, parties }
  }, [data, search])

  // PDF share — same pattern as fold detail. Builds a hierarchical
  // listing (party → quality → lots) and either opens the native share
  // sheet (mobile WhatsApp / Mail / Drive) or falls back to a download
  // + WhatsApp Web on desktop. Respects the active search filter so
  // the user can share a subset.
  async function shareStockPdf() {
    if (!filtered || sharingPdf) return
    setSharingPdf(true)
    try {
      const { default: jsPDF } = await import('jspdf')
      const { default: autoTable } = await import('jspdf-autotable')
      const doc = new jsPDF({ orientation: 'portrait' })

      doc.setFontSize(16)
      doc.text('Unallocated Grey Stock', 14, 15)
      doc.setFontSize(10)
      doc.text(`${filtered.grandTotal} than · ${filtered.totalLots} lots · ${filtered.totalParties} parties`, 14, 22)
      doc.text(`As of ${new Date().toLocaleDateString('en-IN')}${search ? `   ·   filter: "${search}"` : ''}`, 14, 28)

      let y = 34
      for (const p of filtered.parties) {
        doc.setFontSize(11)
        doc.setFont('helvetica', 'bold')
        doc.text(`${p.party}  —  ${p.totalThan} than (${p.totalLots} lots)`, 14, y)
        doc.setFont('helvetica', 'normal')
        y += 2

        for (const q of p.qualities) {
          autoTable(doc, {
            head: [[{ content: q.quality, colSpan: 4, styles: { fillColor: [99, 102, 241], halign: 'left' } }, { content: `${q.totalThan} than`, styles: { fillColor: [99, 102, 241], halign: 'right' } }]],
            body: [
              ...q.lots.map(l => [
                l.lotNo,
                l.weight ?? '',
                l.challanNos ?? '',
                l.date ? new Date(l.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '',
                l.remaining,
              ]),
            ],
            startY: y,
            styles: { fontSize: 8 },
            headStyles: { fontStyle: 'bold' },
            columnStyles: { 0: { fontStyle: 'bold' }, 4: { fontStyle: 'bold', halign: 'right' } },
            margin: { left: 14, right: 14 },
          })
          y = (doc as any).lastAutoTable.finalY + 4
          if (y > 270) { doc.addPage(); y = 15 }
        }
        y += 4
      }

      const blob = doc.output('blob') as Blob
      const fname = `Unallocated-Stock-${new Date().toISOString().slice(0, 10)}.pdf`
      const file = new File([blob], fname, { type: 'application/pdf' })
      if (typeof navigator !== 'undefined' && (navigator as any).canShare?.({ files: [file] })) {
        try { await (navigator as any).share({ files: [file], title: 'Unallocated Grey Stock' }); return } catch {}
      }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = fname; a.click()
      URL.revokeObjectURL(url)
      window.open(`https://wa.me/?text=${encodeURIComponent('Unallocated Grey Stock (PDF attached)')}`, '_blank')
    } finally { setSharingPdf(false) }
  }

  if (!open) return null

  const toggleParty = (p: string) => {
    setExpandedParties(prev => {
      const n = new Set(prev)
      if (n.has(p)) n.delete(p); else n.add(p)
      return n
    })
  }
  const toggleQuality = (k: string) => {
    setExpandedQualities(prev => {
      const n = new Set(prev)
      if (n.has(k)) n.delete(k); else n.add(k)
      return n
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h3 className="text-base font-bold text-gray-800 dark:text-gray-100">📊 Unallocated Grey Stock</h3>
            {filtered && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {filtered.grandTotal} than · {filtered.totalLots} lots · {filtered.totalParties} parties
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={shareStockPdf} disabled={!filtered || sharingPdf || loading}
              title="Share the current view as a PDF (WhatsApp / Mail / Drive)"
              className="bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-emerald-700 disabled:opacity-50">
              {sharingPdf ? 'Sharing…' : '📤 Share PDF'}
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl leading-none">&times;</button>
          </div>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search party, quality, or lot..."
            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-400"
          />
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="text-center text-gray-400 py-12">Loading...</div>
          ) : !filtered || filtered.parties.length === 0 ? (
            <div className="text-center text-gray-400 py-12">No unallocated grey stock</div>
          ) : (
            <div className="space-y-2">
              {filtered.parties.map(p => {
                const pOpen = expandedParties.has(p.party)
                return (
                  <div key={p.party} className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                    <button
                      onClick={() => toggleParty(p.party)}
                      className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-700/30 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition"
                    >
                      <div className="text-left">
                        <p className="text-sm font-bold text-gray-800 dark:text-gray-100">{p.party}</p>
                        <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">{p.qualities.length} quality · {p.totalLots} lots</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{p.totalThan}</span>
                        <span className={`text-gray-400 text-xs transition-transform ${pOpen ? 'rotate-90' : ''}`}>▶</span>
                      </div>
                    </button>

                    {pOpen && (
                      <div className="px-3 pb-3 pt-2 space-y-1.5 border-t border-gray-100 dark:border-gray-700">
                        {p.qualities.map(q => {
                          const qKey = `${p.party}::${q.quality}`
                          const qOpen = expandedQualities.has(qKey)
                          return (
                            <div key={qKey} className="border border-gray-100 dark:border-gray-700 rounded-lg overflow-hidden">
                              <button
                                onClick={() => toggleQuality(qKey)}
                                className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition"
                              >
                                <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">{q.quality}</span>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">{q.totalThan}</span>
                                  <span className={`text-gray-400 text-[10px] transition-transform ${qOpen ? 'rotate-90' : ''}`}>▶</span>
                                </div>
                              </button>

                              {qOpen && (
                                <div className="px-2 pb-2 pt-1 space-y-1 border-t border-gray-50 dark:border-gray-700">
                                  {q.lots.map(l => (
                                    <Link
                                      key={l.lotNo}
                                      id={`unalloc-lot-${l.lotNo}`}
                                      href={`/lot/${encodeURIComponent(l.lotNo)}`}
                                      onClick={() => {
                                        try {
                                          sessionStorage.setItem('unallocated-reopen', '1')
                                          sessionStorage.setItem('unallocated-last-lot', l.lotNo)
                                        } catch {}
                                      }}
                                      className="flex items-center justify-between bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 hover:border-teal-300 dark:hover:border-teal-700 hover:bg-teal-50/50 dark:hover:bg-teal-900/10 rounded-lg px-3 py-2 transition"
                                    >
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <span className="text-xs font-semibold text-teal-700 dark:text-teal-400 hover:underline">{l.lotNo}</span>
                                          {l.isOB && (
                                            <span className="text-[9px] font-bold bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 px-1.5 py-0.5 rounded-full">OB</span>
                                          )}
                                          {l.weight && (
                                            <span className="text-[9px] text-gray-500 dark:text-gray-400">{l.weight}</span>
                                          )}
                                        </div>
                                        {(() => {
                                          const showMarka = /prakash\s+shirting/i.test(l.party) || (l.partyTag || '').toLowerCase() === 'pali pc job'
                                          if (!l.challanNos && !l.date && !(showMarka && l.marka)) return null
                                          return (
                                            <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 flex flex-wrap gap-x-2">
                                              {l.challanNos && <span>Ch: {l.challanNos}</span>}
                                              {l.date && <span>{new Date(l.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })}</span>}
                                              {showMarka && l.marka && <span>Marka: {l.marka}</span>}
                                            </p>
                                          )
                                        })()}
                                        {(l.deducted.despatched > 0 || l.deducted.folded > 0 || l.deducted.obAllocated > 0) && (
                                          <p className="text-[9px] text-gray-400 mt-0.5">
                                            Of {l.originalThan}: {l.deducted.despatched > 0 && `desp ${l.deducted.despatched} · `}{l.deducted.folded > 0 && `folded ${l.deducted.folded} · `}{l.deducted.obAllocated > 0 && `alloc ${l.deducted.obAllocated}`}
                                          </p>
                                        )}
                                      </div>
                                      <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 ml-2">{l.remaining}</span>
                                    </Link>
                                  ))}
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
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
