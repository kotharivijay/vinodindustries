'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface LotStock {
  lotNo: string
  party: string
  quality: string
  stock: number
  openingBalance: number
  greyThan: number
  despatchThan: number
}

interface PartyStock {
  party: string
  totalStock: number
  lotCount: number
  lots: LotStock[]
}

type SortMode = 'party-asc' | 'party-desc' | 'stock-desc' | 'stock-asc'

export default function StockPage() {
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

  if (isLoading) return <div className="p-8 text-gray-400">Loading stock data...</div>

  return (
    <div className="p-4 md:p-8 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Link href="/dashboard" className="flex items-center gap-1.5 text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 rounded-lg px-4 py-2 text-sm font-medium transition">
          &larr; Back
        </Link>
        <div>
          <h1 className="text-xl font-bold text-gray-800">Balance Stock</h1>
          <p className="text-sm text-gray-500">{data?.totalStock?.toLocaleString()} than &middot; {data?.totalLots} lots &middot; {data?.parties?.length} parties</p>
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
                sort === key ? 'bg-indigo-100 border-indigo-300 text-indigo-700 font-medium' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
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
            <div key={p.party} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              {/* Party header - tappable */}
              <button
                onClick={() => toggle(p.party)}
                className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition"
              >
                <span className="text-lg">{'\uD83D\uDCE6'}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800 truncate">{p.party}</p>
                  <p className="text-xs text-gray-400">{p.lotCount} lot{p.lotCount !== 1 ? 's' : ''}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-lg font-bold text-indigo-600">{p.totalStock}</p>
                  <p className="text-[10px] text-gray-400">than</p>
                </div>
                <span className="text-gray-300 text-sm">{expanded.has(p.party) ? '\u25B2' : '\u25BC'}</span>
              </button>

              {/* Expanded lot cards */}
              {expanded.has(p.party) && (
                <div className="border-t border-gray-100 bg-gray-50 px-4 py-3 space-y-2">
                  {p.lots.map(lot => (
                    <div key={lot.lotNo} className="bg-white rounded-lg border border-gray-200 p-3">
                      <div className="flex items-center justify-between mb-1">
                        <Link href={`/lot/${encodeURIComponent(lot.lotNo)}`} className="text-sm font-semibold text-indigo-700 hover:underline">
                          {lot.lotNo}
                        </Link>
                        <span className="text-sm font-bold text-indigo-600">{lot.stock} than</span>
                      </div>
                      <p className="text-xs text-gray-500 mb-1">{lot.quality}</p>
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
