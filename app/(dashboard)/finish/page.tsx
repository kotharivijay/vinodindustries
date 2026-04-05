'use client'

import { useState, useMemo, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import BackButton from '../BackButton'

const fetcher = (url: string) => fetch(url).then(r => r.json())

function useDebounce(delay = 200) {
  const [debounced, setDebounced] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const set = (v: string) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setDebounced(v), delay)
  }
  return [debounced, set] as const
}

/* ── Types ────────────────────────────────────────────────────────── */

interface StockLot {
  lotNo: string
  than: number
  party: string | null
  quality: string | null
  weight: string | null
}

interface StockEntry {
  id: number
  slipNo: number
  date: string
  shadeName: string | null
  shadeDescription: string | null
  marka: string | null
  isPcJob: boolean
  machineName: string | null
  operatorName: string | null
  lots: StockLot[]
  totalThan: number
}

type SortField = 'date' | 'slipNo' | 'lotNo' | 'party' | 'quality' | 'than'
type SortDir = 'asc' | 'desc'
type Tab = 'register' | 'report'

function getValue(e: StockEntry, f: SortField): string | number {
  switch (f) {
    case 'date': return new Date(e.date).getTime()
    case 'slipNo': return e.slipNo
    case 'lotNo': return (e.lots.map(l => l.lotNo).join(' ')).toLowerCase()
    case 'party': return (e.lots[0]?.party ?? '').toLowerCase()
    case 'quality': return (e.lots[0]?.quality ?? '').toLowerCase()
    case 'than': return e.totalThan
  }
}

/* ── Shade display helper ─────────────────────────────────────────── */

function shadeDisplay(name: string | null, desc: string | null) {
  if (!name) return null
  return desc ? `${name} \u2014 ${desc}` : name
}

/* ── Stock Report grouping types ──────────────────────────────────── */

interface SlipDetail {
  id: number
  slipNo: number
  date: string
  shadeName: string | null
  shadeDescription: string | null
  lots: StockLot[]
  totalThan: number
  machineName: string | null
  operatorName: string | null
}

interface QualityGroup {
  quality: string
  weight: string | null
  totalThan: number
  slips: SlipDetail[]
}

interface PartyGroup {
  party: string
  totalThan: number
  totalSlips: number
  totalLots: number
  qualities: QualityGroup[]
}

export default function FinishStockPage() {
  const router = useRouter()
  void router

  const { data: rawData, isLoading: loading } = useSWR<{ stock: StockEntry[]; totalSlips: number; totalThan: number }>('/api/finish/stock', fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
  })
  const entries = rawData?.stock ?? []

  const [tab, setTab] = useState<Tab>('register')

  /* ── Stock Register state ─────────────────────────────────────── */
  const [filterSlip, setFilterSlipRaw] = useState('')
  const [debouncedSlip, setDebouncedSlip] = useDebounce()
  const [filterLot, setFilterLotRaw] = useState('')
  const [debouncedLot, setDebouncedLot] = useDebounce()
  const [filterParty, setFilterPartyRaw] = useState('')
  const [debouncedParty, setDebouncedParty] = useDebounce()
  const [filterQuality, setFilterQualityRaw] = useState('')
  const [debouncedQuality, setDebouncedQuality] = useDebounce()
  const [sortField, setSortField] = useState<SortField>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // suppress unused warnings
  void filterSlip; void filterLot; void filterParty; void filterQuality

  function toggleSort(f: SortField) {
    if (sortField === f) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(f); setSortDir('asc') }
  }

  const filtered = useMemo(() => {
    const fs = debouncedSlip.toLowerCase()
    const fl = debouncedLot.toLowerCase()
    const fp = debouncedParty.toLowerCase()
    const fq = debouncedQuality.toLowerCase()

    return entries
      .filter(e => {
        const allLots = e.lots.map(l => l.lotNo).join(' ').toLowerCase()
        const allParties = e.lots.map(l => l.party ?? '').join(' ').toLowerCase()
        const allQualities = e.lots.map(l => l.quality ?? '').join(' ').toLowerCase()
        const matchSlip = !fs || String(e.slipNo).includes(fs)
        const matchLot = !fl || allLots.includes(fl)
        const matchParty = !fp || allParties.includes(fp)
        const matchQuality = !fq || allQualities.includes(fq)
        return matchSlip && matchLot && matchParty && matchQuality
      })
      .sort((a, b) => {
        const av = getValue(a, sortField), bv = getValue(b, sortField)
        const cmp = av < bv ? -1 : av > bv ? 1 : 0
        return sortDir === 'asc' ? cmp : -cmp
      })
  }, [entries, debouncedSlip, debouncedLot, debouncedParty, debouncedQuality, sortField, sortDir])

  /* ── Stock Report grouped data ──────────────────────────────────── */

  const partyGroups = useMemo<PartyGroup[]>(() => {
    // Flatten: for each entry, for each lot, produce a record
    const records: { party: string; quality: string; weight: string | null; slip: SlipDetail; lotNo: string; than: number }[] = []
    for (const e of entries) {
      for (const l of e.lots) {
        records.push({
          party: l.party ?? 'Unknown',
          quality: l.quality ?? 'Unknown',
          weight: l.weight,
          slip: e,
          lotNo: l.lotNo,
          than: l.than,
        })
      }
    }

    // Group by party
    const partyMap = new Map<string, Map<string, { weight: string | null; slipSet: Set<number>; slips: Map<number, SlipDetail>; totalThan: number; lotSet: Set<string> }>>()
    for (const r of records) {
      if (!partyMap.has(r.party)) partyMap.set(r.party, new Map())
      const qMap = partyMap.get(r.party)!
      if (!qMap.has(r.quality)) qMap.set(r.quality, { weight: r.weight, slipSet: new Set(), slips: new Map(), totalThan: 0, lotSet: new Set() })
      const qg = qMap.get(r.quality)!
      qg.totalThan += r.than
      qg.lotSet.add(r.lotNo)
      qg.slipSet.add(r.slip.id)
      if (!qg.slips.has(r.slip.id)) qg.slips.set(r.slip.id, r.slip)
    }

    const result: PartyGroup[] = []
    for (const [party, qMap] of partyMap) {
      const qualities: QualityGroup[] = []
      let totalThan = 0
      let totalSlips = 0
      const lotSet = new Set<string>()
      for (const [quality, data] of qMap) {
        qualities.push({
          quality,
          weight: data.weight,
          totalThan: data.totalThan,
          slips: Array.from(data.slips.values()).sort((a, b) => a.slipNo - b.slipNo),
        })
        totalThan += data.totalThan
        totalSlips += data.slipSet.size
        data.lotSet.forEach(l => lotSet.add(l))
      }
      qualities.sort((a, b) => a.quality.localeCompare(b.quality))
      result.push({ party, totalThan, totalSlips, totalLots: lotSet.size, qualities })
    }
    result.sort((a, b) => a.party.localeCompare(b.party))
    return result
  }, [entries])

  /* ── Stock Report expand state ─────────────────────────────────── */
  const [expandedParties, setExpandedParties] = useState<Set<string>>(new Set())
  const [expandedQualities, setExpandedQualities] = useState<Set<string>>(new Set())

  const toggleParty = (party: string) => {
    setExpandedParties(prev => {
      const next = new Set(prev)
      if (next.has(party)) next.delete(party); else next.add(party)
      return next
    })
  }
  const toggleQuality = (key: string) => {
    setExpandedQualities(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  const totalThan = useMemo(() => entries.reduce((s, e) => s + e.totalThan, 0), [entries])

  return (
    <div className="p-4 md:p-8">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div className="flex items-center gap-3">
          <BackButton />
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Finish / Center</h1>
            <p className="text-sm text-gray-500 mt-1">
              {entries.length} slips &middot; {totalThan.toLocaleString()} than (done dyeing)
            </p>
          </div>
        </div>
        <Link href="/finish/new" className="flex items-center gap-2 bg-teal-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-teal-700 w-fit">
          + New Entry
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-gray-200">
        {([['register', 'Stock Register'], ['report', 'Stock Report']] as [Tab, string][]).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition -mb-px ${tab === key ? 'border-teal-600 text-teal-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* ═══ STOCK REGISTER TAB ═══════════════════════════════════════ */}
      {tab === 'register' && (
        <>
          {/* Filters + Sort */}
          <div className="mb-4 space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div>
                <label className="block text-[10px] text-gray-400 mb-0.5">Slip No</label>
                <input type="text" placeholder="Filter..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                  value={filterSlip}
                  onChange={e => { setFilterSlipRaw(e.target.value); setDebouncedSlip(e.target.value) }} />
              </div>
              <div>
                <label className="block text-[10px] text-gray-400 mb-0.5">Lot No</label>
                <input type="text" placeholder="Filter..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                  value={filterLot}
                  onChange={e => { setFilterLotRaw(e.target.value); setDebouncedLot(e.target.value) }} />
              </div>
              <div>
                <label className="block text-[10px] text-gray-400 mb-0.5">Party</label>
                <input type="text" placeholder="Filter..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                  value={filterParty}
                  onChange={e => { setFilterPartyRaw(e.target.value); setDebouncedParty(e.target.value) }} />
              </div>
              <div>
                <label className="block text-[10px] text-gray-400 mb-0.5">Quality</label>
                <input type="text" placeholder="Filter..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                  value={filterQuality}
                  onChange={e => { setFilterQualityRaw(e.target.value); setDebouncedQuality(e.target.value) }} />
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] text-gray-400">Sort:</span>
              {([['date', 'Date'], ['slipNo', 'Slip'], ['lotNo', 'Lot'], ['party', 'Party'], ['quality', 'Quality'], ['than', 'Than']] as [SortField, string][]).map(([f, label]) => (
                <button key={f} onClick={() => toggleSort(f)}
                  className={`text-xs px-2 py-1 rounded border ${sortField === f ? 'bg-teal-100 border-teal-300 text-teal-700 font-medium' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                  {label} {sortField === f ? (sortDir === 'asc' ? '\u2191' : '\u2193') : ''}
                </button>
              ))}
              {(filterSlip || filterLot || filterParty || filterQuality) && (
                <button onClick={() => {
                  setFilterSlipRaw(''); setDebouncedSlip('')
                  setFilterLotRaw(''); setDebouncedLot('')
                  setFilterPartyRaw(''); setDebouncedParty('')
                  setFilterQualityRaw(''); setDebouncedQuality('')
                }} className="text-xs text-red-400 hover:text-red-600">Clear</button>
              )}
              <span className="text-xs text-gray-400 ml-auto">{filtered.length} of {entries.length}</span>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            {loading ? <div className="p-12 text-center text-gray-400">Loading...</div> :
              filtered.length === 0 ? (
                <div className="p-12 text-center text-gray-400">
                  {entries.length === 0 ? 'No done dyeing slips found.' : 'No results found.'}
                </div>
              ) : (
                <>
                  {/* Mobile card view */}
                  <div className="block sm:hidden divide-y divide-gray-100">
                    {filtered.map(e => {
                      const shade = shadeDisplay(e.shadeName, e.shadeDescription)
                      const parties = [...new Set(e.lots.map(l => l.party).filter(Boolean))].join(', ')
                      const qualities = [...new Set(e.lots.map(l => l.quality).filter(Boolean))].join(', ')
                      return (
                        <div key={e.id} className="p-4">
                          <div className="flex items-start justify-between mb-1.5">
                            <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                              <span>{new Date(e.date).toLocaleDateString('en-IN')}</span>
                              <span className="text-gray-300">&middot;</span>
                              <span className="text-teal-600 font-medium">Slip {e.slipNo}</span>
                            </div>
                            <span className="text-sm font-bold text-emerald-600">{e.totalThan}T</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                            {e.lots.map((lot, li) => (
                              <Link key={li} href={`/lot/${encodeURIComponent(lot.lotNo)}`}
                                className="inline-flex items-center gap-1 bg-teal-50 text-teal-700 text-xs font-semibold px-2.5 py-1 rounded-full hover:bg-teal-100">
                                {lot.lotNo} <span className="text-teal-400 font-normal">({lot.than})</span>
                              </Link>
                            ))}
                          </div>
                          {shade && <p className="text-xs text-gray-600 mb-0.5">{shade}</p>}
                          {parties && <p className="text-[10px] text-gray-500">{parties}</p>}
                          {qualities && <p className="text-[10px] text-gray-400">{qualities}</p>}
                          <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-400">
                            {e.machineName && <span>{e.machineName}</span>}
                            {e.operatorName && <span>{e.operatorName}</span>}
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* Desktop table */}
                  <div className="hidden sm:block overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b">
                        <tr>
                          <ThSort field="date" label="Date" active={sortField} dir={sortDir} toggle={toggleSort} />
                          <ThSort field="slipNo" label="Slip" active={sortField} dir={sortDir} toggle={toggleSort} />
                          <ThSort field="lotNo" label="Lot No (Than)" active={sortField} dir={sortDir} toggle={toggleSort} />
                          <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Shade</th>
                          <ThSort field="party" label="Party" active={sortField} dir={sortDir} toggle={toggleSort} />
                          <ThSort field="quality" label="Quality" active={sortField} dir={sortDir} toggle={toggleSort} />
                          <ThSort field="than" label="Than" active={sortField} dir={sortDir} toggle={toggleSort} right />
                          <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Machine</th>
                          <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Operator</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {filtered.map(e => {
                          const shade = shadeDisplay(e.shadeName, e.shadeDescription)
                          const parties = [...new Set(e.lots.map(l => l.party).filter(Boolean))].join(', ')
                          const qualities = [...new Set(e.lots.map(l => l.quality).filter(Boolean))].join(', ')
                          return (
                            <tr key={e.id} className="hover:bg-gray-50 transition">
                              <td className="px-3 py-2.5 whitespace-nowrap text-xs text-gray-500">{new Date(e.date).toLocaleDateString('en-IN')}</td>
                              <td className="px-3 py-2.5 font-medium text-teal-600">{e.slipNo}</td>
                              <td className="px-3 py-2.5">
                                <div className="flex flex-wrap gap-1">
                                  {e.lots.map((lot, li) => (
                                    <Link key={li} href={`/lot/${encodeURIComponent(lot.lotNo)}`}
                                      className="inline-flex items-center gap-1 bg-teal-50 text-teal-700 text-xs font-semibold px-2 py-0.5 rounded-full hover:bg-teal-100">
                                      {lot.lotNo} <span className="text-teal-400 font-normal">({lot.than})</span>
                                    </Link>
                                  ))}
                                </div>
                              </td>
                              <td className="px-3 py-2.5 text-xs text-gray-600 max-w-[200px] truncate">{shade ?? '\u2014'}</td>
                              <td className="px-3 py-2.5 text-sm text-gray-600">{parties || '\u2014'}</td>
                              <td className="px-3 py-2.5 text-sm text-gray-600">{qualities || '\u2014'}</td>
                              <td className="px-3 py-2.5 text-right font-semibold">{e.totalThan}</td>
                              <td className="px-3 py-2.5 text-xs text-gray-500">{e.machineName ?? '\u2014'}</td>
                              <td className="px-3 py-2.5 text-xs text-gray-500">{e.operatorName ?? '\u2014'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                      <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                        <tr>
                          <td colSpan={6} className="px-3 py-3 text-xs font-semibold text-gray-500 uppercase">Total ({filtered.length} slips)</td>
                          <td className="px-3 py-3 text-right font-bold text-emerald-700">{filtered.reduce((s, e) => s + e.totalThan, 0)}</td>
                          <td colSpan={2}></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </>
              )}
          </div>
        </>
      )}

      {/* ═══ STOCK REPORT TAB ═════════════════════════════════════════ */}
      {tab === 'report' && (
        <div>
          {loading ? <div className="p-12 text-center text-gray-400">Loading...</div> :
            partyGroups.length === 0 ? <div className="p-12 text-center text-gray-400">No done dyeing slips found.</div> : (
              <div className="space-y-3">
                {/* Summary stats */}
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Parties</p>
                    <p className="text-2xl font-bold text-gray-800 mt-1">{partyGroups.length}</p>
                  </div>
                  <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Slips</p>
                    <p className="text-2xl font-bold text-teal-600 mt-1">{entries.length}</p>
                  </div>
                  <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Total Than</p>
                    <p className="text-2xl font-bold text-emerald-600 mt-1">{totalThan.toLocaleString()}</p>
                  </div>
                </div>

                {/* Party cards */}
                {partyGroups.map(pg => {
                  const isOpen = expandedParties.has(pg.party)
                  return (
                    <div key={pg.party} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                      {/* Level 1: Party header */}
                      <button
                        onClick={() => toggleParty(pg.party)}
                        className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-gray-50 transition"
                      >
                        <div className="text-left">
                          <h3 className="text-sm font-bold text-gray-800">{pg.party}</h3>
                          <p className="text-[10px] text-gray-400 mt-0.5">
                            {pg.totalSlips} slip{pg.totalSlips !== 1 ? 's' : ''} &middot; {pg.totalLots} lot{pg.totalLots !== 1 ? 's' : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-bold text-emerald-600">{pg.totalThan} than</span>
                          <span className={`text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`}>&#9654;</span>
                        </div>
                      </button>

                      {/* Level 2: Quality cards inside party */}
                      {isOpen && (
                        <div className="border-t border-gray-100 px-3 pb-3 space-y-2 pt-2">
                          {pg.qualities.map(qg => {
                            const qKey = `${pg.party}::${qg.quality}`
                            const qOpen = expandedQualities.has(qKey)
                            return (
                              <div key={qKey} className="border border-gray-100 rounded-lg overflow-hidden">
                                <button
                                  onClick={() => toggleQuality(qKey)}
                                  className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-50 transition"
                                >
                                  <div className="text-left">
                                    <h4 className="text-sm font-semibold text-gray-700">{qg.quality}</h4>
                                    {qg.weight && <p className="text-[10px] text-gray-400">Weight: {qg.weight}</p>}
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <span className="text-sm font-semibold text-emerald-600">{qg.totalThan} than</span>
                                    <span className={`text-gray-400 text-xs transition-transform ${qOpen ? 'rotate-90' : ''}`}>&#9654;</span>
                                  </div>
                                </button>

                                {/* Level 3: Slip details inside quality */}
                                {qOpen && (
                                  <div className="border-t border-gray-50 divide-y divide-gray-50">
                                    {qg.slips.map(slip => {
                                      const shade = shadeDisplay(slip.shadeName, slip.shadeDescription)
                                      // Filter lots that belong to this quality
                                      const qLots = slip.lots.filter(l => (l.quality ?? 'Unknown') === qg.quality && (l.party ?? 'Unknown') === pg.party)
                                      const slipQualityThan = qLots.reduce((s, l) => s + l.than, 0)
                                      return (
                                        <div key={slip.id} className="px-3 py-2.5">
                                          <div className="flex items-center justify-between mb-1">
                                            <div className="flex items-center gap-2 text-xs text-gray-500">
                                              <span className="font-medium text-teal-600">Slip {slip.slipNo}</span>
                                              <span className="text-gray-300">&middot;</span>
                                              <span>{new Date(slip.date).toLocaleDateString('en-IN')}</span>
                                            </div>
                                            <span className="text-xs font-semibold text-gray-600">{slipQualityThan}T</span>
                                          </div>
                                          {shade && <p className="text-xs text-gray-600 mb-0.5">{shade}</p>}
                                          <div className="flex flex-wrap gap-1.5">
                                            {qLots.map((lot, li) => (
                                              <Link key={li} href={`/lot/${encodeURIComponent(lot.lotNo)}`}
                                                className="inline-flex items-center gap-0.5 text-[11px] text-teal-700 bg-teal-50 px-2 py-0.5 rounded-full hover:bg-teal-100">
                                                {lot.lotNo}<span className="text-teal-400">({lot.than})</span>
                                              </Link>
                                            ))}
                                          </div>
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
                  )
                })}
              </div>
            )}
        </div>
      )}
    </div>
  )
}

/* ── Reusable sortable table header ───────────────────────────────── */

function ThSort({ field, label, active, dir, toggle, right }: {
  field: SortField; label: string; active: SortField; dir: SortDir; toggle: (f: SortField) => void; right?: boolean
}) {
  const isActive = active === field
  return (
    <th onClick={() => toggle(field)}
      className={`px-3 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:text-teal-600 ${right ? 'text-right' : 'text-left'}`}>
      <span className={`flex items-center gap-1 ${right ? 'justify-end' : ''}`}>
        {label}
        <span className={isActive ? 'text-teal-600' : 'text-gray-300'}>
          {isActive ? (dir === 'asc' ? '\u2191' : '\u2193') : '\u2195'}
        </span>
      </span>
    </th>
  )
}
