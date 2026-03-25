'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface FoldBatchLot {
  lotNo: string
  than: number
  party?: { name: string }
  quality?: { name: string }
}

interface FoldBatch {
  id: number
  batchNo: number
  shadeName?: string
  shade?: { name: string }
  lots: FoldBatchLot[]
}

interface FoldProgram {
  id: number
  foldNo: string
  date: string
  status: 'draft' | 'confirmed'
  notes?: string
  batches: FoldBatch[]
}

export default function FoldListPage() {
  const router = useRouter()
  const { data: programs, isLoading, mutate } = useSWR<FoldProgram[]>('/api/fold', fetcher)
  const [search, setSearch] = useState('')

  const filtered = (programs ?? []).filter(p =>
    p.foldNo.toLowerCase().includes(search.toLowerCase()) ||
    p.batches.some(b =>
      b.lots.some(l => l.lotNo.toLowerCase().includes(search.toLowerCase()))
    )
  )

  async function deleteProgram(id: number, foldNo: string) {
    if (!confirm(`Delete Fold Program ${foldNo}? This cannot be undone.`)) return
    await fetch(`/api/fold/${id}`, { method: 'DELETE' })
    mutate()
  }

  const totalThan = (p: FoldProgram) =>
    p.batches.reduce((s, b) => s + b.lots.reduce((ls, l) => ls + l.than, 0), 0)

  if (isLoading) return <div className="p-8 text-gray-400">Loading fold programs...</div>

  return (
    <div className="p-4 md:p-8 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 rounded-lg px-4 py-2 text-sm font-medium transition">
          &larr; Back
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-800">Fold Programs</h1>
          <p className="text-sm text-gray-500">{programs?.length ?? 0} programs</p>
        </div>
        <Link
          href="/fold/new"
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition"
        >
          + New Fold
        </Link>
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search fold no, lot no..."
        className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-indigo-400"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      {filtered.length === 0 ? (
        <div className="text-center text-gray-400 py-16">
          {programs?.length === 0 ? 'No fold programs yet. Create one!' : 'No results found.'}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(p => (
            <div key={p.id} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <Link href={`/fold/${p.id}`} className="text-sm font-bold text-indigo-700 hover:underline">
                      {p.foldNo}
                    </Link>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                      p.status === 'confirmed'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      {p.status}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400">
                    {new Date(p.date).toLocaleDateString('en-IN')} &middot; {p.batches.length} batch{p.batches.length !== 1 ? 'es' : ''} &middot; {p.batches.reduce((s, b) => s + b.lots.length, 0)} lots
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-lg font-bold text-indigo-600">{totalThan(p)}</p>
                  <p className="text-[10px] text-gray-400">than</p>
                </div>
                <div className="flex gap-1.5">
                  <Link
                    href={`/fold/${p.id}`}
                    className="text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-1 rounded hover:bg-indigo-100"
                  >
                    View
                  </Link>
                  <button
                    onClick={() => deleteProgram(p.id, p.foldNo)}
                    className="text-xs bg-red-50 text-red-600 border border-red-200 px-2 py-1 rounded hover:bg-red-100"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
