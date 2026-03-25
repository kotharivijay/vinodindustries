'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import * as XLSX from 'xlsx'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface LotStock {
  lotNo: string
  party: string
  quality: string
  stock: number
  openingBalance: number
  greyThan: number
  despatchThan: number
  foldProgrammed: number
  foldAvailable: number
}

interface PartyStock {
  party: string
  totalStock: number
  lotCount: number
  lots: LotStock[]
}

type SortMode = 'party-asc' | 'party-desc' | 'stock-desc' | 'stock-asc'

export default function StockPage() {
  const router = useRouter()
  const { data, isLoading } = useSWR<{ parties: PartyStock[]; totalStock: number; totalLots: number }>('/api/stock', fetcher)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortMode>('party-asc')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggle = (party: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(party)) next.delete(party)
      else next.add(party)
      return next
    })
  }

  const filtered = useMemo(() => {
    if (!data?.parties) return []
    let list = data.parties
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(p =>
        p.party.toLowerCase().includes(q) ||
        p.lots.some(l => l.lotNo.toLowerCase().includes(q) || l.quality.toLowerCase().includes(q))
      )
    }
    // Sort
    list = [...list]
    switch (sort) {
      case 'party-asc': list.sort((a, b) => a.party.localeCompare(b.party)); break
      case 'party-desc': list.sort((a, b) => b.party.localeCompare(a.party)); break
      case 'stock-desc': list.sort((a, b) => b.totalStock - a.totalStock); break
      case 'stock-asc': list.sort((a, b) => a.totalStock - b.totalStock); break
    }
    return list
  }, [data, search, sort])

  function getFlatRows() {
    return filtered.flatMap(p =>
      p.lots.map(l => [p.party, l.lotNo, l.quality, l.openingBalance, l.greyThan, l.despatchThan, l.stock, l.foldProgrammed, l.foldAvailable])
    )
  }

  function exportXLSX() {
    const headers = ['Party', 'Lot No', 'Quality', 'Opening Balance', 'Grey Than', 'Despatch Than', 'Balance Stock', 'Fold Programmed', 'Fold Available']
    const ws = XLSX.utils.aoa_to_sheet([headers, ...getFlatRows()])
    // Bold header
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Balance Stock')
    XLSX.writeFile(wb, 'balance-stock.xlsx')
  }

  async function exportPDF() {
    const { default: jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    const doc = new jsPDF({ orientation: 'landscape' })
    doc.setFontSize(14)
    doc.text('Balance Stock Report', 14, 14)
    doc.setFontSize(9)
    doc.text(`${data?.totalStock?.toLocaleString()} than · ${data?.totalLots} lots · ${filtered.length} parties${search ? ` · Search: "${search}"` : ''}`, 14, 21)
    autoTable(doc, {
      head: [['Party', 'Lot No', 'Quality', 'OB', 'Grey', 'Desp', 'Balance', 'Fold Prog', 'Fold Avail']],
      body: getFlatRows(),
      startY: 26,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [79, 70, 229] },
      columnStyles: {
        6: { fontStyle: 'bold', textColor: [79, 70, 229] },
        8: { fontStyle: 'bold', textColor: [5, 150, 105] },
      },
    })
    doc.save('balance-stock.pdf')
  }

  if (isLoading) return <div className="p-8 text-gray-400">Loading stock data...</div>

  return (
    <div className="p-4 md:p-8 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg px-4 py-2 text-sm font-medium transition">
          &larr; Back
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Balance Stock</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{data?.totalStock?.toLocaleString()} than &middot; {data?.totalLots} lots &middot; {data?.parties?.length} parties</p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportXLSX} className="flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-2 rounded-lg text-xs font-medium hover:bg-emerald-700">
            ⬇ XLSX
          </button>
          <button onClick={exportPDF} className="flex items-center gap-1.5 bg-red-600 text-white px-3 py-2 rounded-lg text-xs font-medium hover:bg-red-700">
            ⬇ PDF
          </button>
        </div>
      </div>

      {/* Search + Sort */}
      <div className="mb-4 space-y-3">
        <input
          type="text"
          placeholder="Search party, lot no, quality..."
          className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="flex gap-2 flex-wrap">
          <span className="text-xs text-gray-400">Sort:</span>
          {([
            ['party-asc', 'Party A-Z'],
            ['party-desc', 'Party Z-A'],
            ['stock-desc', 'Stock High\u2192Low'],
            ['stock-asc', 'Stock Low\u2192High'],
          ] as [SortMode, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setSort(key)}
              className={`text-xs px-2 py-1 rounded border ${
                sort === key ? 'bg-indigo-100 dark:bg-indigo-900/30 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-400 font-medium' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Party Cards */}
      {filtered.length === 0 ? (
        <div className="text-center text-gray-400 py-16">No stock found</div>
      ) : (
        <div className="space-y-3">
          {filtered.map(p => (
            <div key={p.party} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
              {/* Party header - tappable */}
              <button
                onClick={() => toggle(p.party)}
                className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition"
              >
                <span className="text-lg">{'\uD83D\uDCE6'}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">{p.party}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500">{p.lotCount} lot{p.lotCount !== 1 ? 's' : ''}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-lg font-bold text-indigo-600 dark:text-indigo-400">{p.totalStock}</p>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500">than</p>
                </div>
                <span className="text-gray-300 dark:text-gray-600 text-sm">{expanded.has(p.party) ? '\u25B2' : '\u25BC'}</span>
              </button>

              {/* Expanded lot cards */}
              {expanded.has(p.party) && (
                <div className="border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 px-4 py-3 space-y-2">
                  {p.lots.map(lot => (
                    <div key={lot.lotNo} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                      <div className="flex items-center justify-between mb-1">
                        <Link href={`/lot/${encodeURIComponent(lot.lotNo)}`} className="text-sm font-semibold text-indigo-700 dark:text-indigo-400 hover:underline">
                          {lot.lotNo}
                        </Link>
                        <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400">{lot.stock} than</span>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{lot.quality}</p>
                      <div className="flex flex-wrap gap-2 text-[10px]">
                        {lot.openingBalance > 0 && (
                          <span className="bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded">OB: {lot.openingBalance}</span>
                        )}
                        {lot.greyThan > 0 && (
                          <span className="bg-green-50 text-green-700 border border-green-200 px-1.5 py-0.5 rounded">Grey: {lot.greyThan}</span>
                        )}
                        {lot.despatchThan > 0 && (
                          <span className="bg-orange-50 text-orange-700 border border-orange-200 px-1.5 py-0.5 rounded">Desp: {lot.despatchThan}</span>
                        )}
                        {lot.foldProgrammed > 0 && (
                          <span className="bg-purple-50 text-purple-700 border border-purple-200 px-1.5 py-0.5 rounded">Fold: {lot.foldProgrammed}</span>
                        )}
                        {lot.foldProgrammed > 0 && (
                          <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded font-semibold">Avail: {lot.foldAvailable}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
