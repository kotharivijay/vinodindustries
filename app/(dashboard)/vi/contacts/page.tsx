'use client'

import { useState, useEffect, useCallback } from 'react'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const FIRMS = ['', 'VI', 'VCF']
const TAGS = ['', 'customer', 'agent', 'supplier']

interface SyncStep { firm: string; stage: string; message: string; total?: number; progress?: number }

function useDebounce(value: string, delay: number) {
  const [d, setD] = useState(value)
  useEffect(() => { const t = setTimeout(() => setD(value), delay); return () => clearTimeout(t) }, [value, delay])
  return d
}

export default function ContactsPage() {
  const [firm, setFirm] = useState('')
  const [tag, setTag] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const debouncedSearch = useDebounce(search, 350)
  const [syncing, setSyncing] = useState(false)
  const [showSync, setShowSync] = useState(false)
  const [syncSteps, setSyncSteps] = useState<SyncStep[]>([])

  const params = new URLSearchParams()
  if (firm) params.set('firm', firm)
  if (tag) params.set('tag', tag)
  if (debouncedSearch) params.set('search', debouncedSearch)
  params.set('page', String(page))

  const { data, mutate, isLoading } = useSWR(`/api/tally/contacts?${params}`, fetcher, { dedupingInterval: 30000, revalidateOnFocus: false })
  const contacts = data?.contacts || []
  const total = data?.total || 0
  const totalPages = Math.ceil(total / 50)

  const handleSync = useCallback(async () => {
    setSyncing(true)
    setShowSync(true)
    setSyncSteps([
      { firm: 'VI', stage: 'waiting', message: 'Waiting...' },
      { firm: 'VCF', stage: 'waiting', message: 'Waiting...' },
    ])
    const es = new EventSource('/api/tally/contacts-sync')
    es.onmessage = (e) => {
      const d = JSON.parse(e.data)
      if (d.type === 'progress') setSyncSteps(prev => prev.map(s => s.firm === d.firm ? { ...s, ...d } : s))
      if (d.type === 'complete') { setSyncing(false); mutate(); es.close() }
    }
    es.onerror = () => { setSyncing(false); es.close() }
  }, [mutate])

  return (
    <div className="p-4 md:p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-white">Contacts</h1>
          <p className="text-xs text-gray-400">Party contacts from vi pa / vcf pa sheets</p>
        </div>
        <button onClick={handleSync} disabled={syncing} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
          {syncing ? 'Syncing...' : '🔄 Sync Contacts'}
        </button>
      </div>

      {/* Sync Modal */}
      {showSync && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="bg-gray-800 rounded-2xl shadow-xl w-full max-w-md p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold text-white">{syncing ? 'Syncing...' : 'Done'}</h2>
              {!syncing && <button onClick={() => setShowSync(false)} className="text-gray-400 text-2xl">&times;</button>}
            </div>
            <div className="space-y-2">
              {syncSteps.map(s => (
                <div key={s.firm} className="flex gap-2 text-sm">
                  <span className={s.stage === 'done' ? 'text-green-400' : s.stage === 'error' ? 'text-red-400' : 'text-gray-500'}>
                    {s.stage === 'done' ? '✓' : s.stage === 'error' ? '✗' : '⟳'}
                  </span>
                  <span className="text-white font-bold">{s.firm}</span>
                  <span className="text-gray-400">{s.message}</span>
                </div>
              ))}
            </div>
            {!syncing && <button onClick={() => setShowSync(false)} className="mt-3 w-full bg-indigo-600 text-white py-2 rounded-lg text-sm">Done</button>}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-1.5 mb-3 flex-wrap">
        {FIRMS.map(f => (
          <button key={f || 'all'} onClick={() => { setFirm(f); setPage(1) }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${firm === f ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400'}`}>
            {f || 'All'}
          </button>
        ))}
        <span className="mx-1" />
        {TAGS.map(t => (
          <button key={t || 'all'} onClick={() => { setTag(t); setPage(1) }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize ${tag === t ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400'}`}>
            {t || 'All Tags'}
          </button>
        ))}
      </div>

      <input type="text" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
        placeholder="Search name, mobile, agent..."
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm text-white mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-500" />

      <p className="text-xs text-gray-500 mb-2">{total} contacts</p>

      {isLoading ? (
        <div className="py-12 text-center text-gray-500">Loading...</div>
      ) : contacts.length === 0 ? (
        <div className="py-12 text-center text-gray-500">No contacts. Click Sync to import.</div>
      ) : (
        <div className="space-y-2">
          {contacts.map((c: any) => (
            <div key={c.id} className="bg-gray-800 rounded-xl p-3 border border-gray-700">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-white text-sm">{c.name}</span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-900/50 text-indigo-400">{c.firmCode}</span>
                    {c.tag && <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold capitalize ${c.tag === 'agent' ? 'bg-purple-900/50 text-purple-400' : c.tag === 'customer' ? 'bg-green-900/50 text-green-400' : 'bg-gray-700 text-gray-400'}`}>{c.tag}</span>}
                  </div>
                  {c.contactPerson && <p className="text-xs text-gray-400 mt-0.5">👤 {c.contactPerson}</p>}
                  {c.agentName && <p className="text-xs text-gray-500 mt-0.5">Agent: {c.agentName}</p>}
                  {c.address && <p className="text-xs text-gray-500 mt-0.5">📍 {c.address}</p>}
                  <div className="flex flex-wrap gap-2 mt-1.5">
                    {[c.mobile1, c.mobile2, c.mobile3].filter(Boolean).map((m: string, i: number) => (
                      <span key={i} className="text-xs text-gray-300">📱 {m}</span>
                    ))}
                  </div>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  {c.mobile1 && (
                    <>
                      <a href={`tel:${c.mobile1}`} className="px-2 py-1 bg-green-900/50 text-green-400 rounded text-xs font-medium">📞</a>
                      <a href={`https://wa.me/91${c.mobile1}`} target="_blank" className="px-2 py-1 bg-green-900/50 text-green-400 rounded text-xs font-medium">💬</a>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 bg-gray-800 text-gray-400 rounded text-sm disabled:opacity-30">‹</button>
          <span className="text-xs text-gray-500">Page {page} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-1 bg-gray-800 text-gray-400 rounded text-sm disabled:opacity-30">›</button>
        </div>
      )}
    </div>
  )
}
