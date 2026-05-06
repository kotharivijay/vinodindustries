'use client'

import { useState } from 'react'
import useSWR from 'swr'
import BackButton from '../../../BackButton'
import { EditNameModal, MergeIntoModal } from '../ItemFixModals'

const fetcher = (url: string) => fetch(url).then(r => r.json())

export default function ReviewQueuePage() {
  const { data, mutate, isLoading } = useSWR<any[]>('/api/inv/items/review-queue', fetcher)
  const [editTarget, setEditTarget] = useState<any | null>(null)
  const [mergeTarget, setMergeTarget] = useState<any | null>(null)

  async function approve(id: number) {
    await fetch(`/api/inv/items/${id}/approve`, { method: 'POST' })
    mutate()
  }
  async function reject(id: number) {
    const reason = prompt('Reason for rejection?') || ''
    await fetch(`/api/inv/items/${id}/reject`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    })
    mutate()
  }

  return (
    <div className="p-4 md:p-8 max-w-4xl">
      <div className="flex items-center gap-3 mb-5">
        <BackButton />
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Item Review Queue</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{data?.length || 0} pending</p>
        </div>
      </div>

      {isLoading ? (
        <div className="p-12 text-center text-gray-400">Loading…</div>
      ) : !data?.length ? (
        <div className="p-12 text-center text-gray-400">Nothing pending review. ✅</div>
      ) : (
        <div className="space-y-2">
          {data.map((it: any) => (
            <div key={it.id} className="bg-white dark:bg-gray-800 rounded-xl border border-amber-300 dark:border-amber-700 p-4 flex items-center gap-3 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-gray-800 dark:text-gray-100">{it.displayName}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Alias: <span className="font-medium">{it.alias.tallyStockItem}</span> · {it.alias.category} · {it.unit} · GST {Number(it.alias.gstRate).toFixed(0)}%
                </div>
                {it.challanLines?.[0]?.challan && (
                  <div className="text-[11px] text-gray-400 mt-0.5">
                    First seen on challan {it.challanLines[0].challan.challanNo}
                    {it.challanLines[0].challan.party?.displayName ? ` from ${it.challanLines[0].challan.party.displayName}` : ''}
                  </div>
                )}
              </div>
              <button onClick={() => setEditTarget(it)}
                className="bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 px-3 py-1.5 rounded-lg text-xs font-semibold border border-indigo-200 dark:border-indigo-800">
                Edit name
              </button>
              <button onClick={() => setMergeTarget(it)}
                className="bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 px-3 py-1.5 rounded-lg text-xs font-semibold border border-purple-200 dark:border-purple-800">
                Merge into…
              </button>
              <button onClick={() => reject(it.id)}
                className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300 px-3 py-1.5 rounded-lg text-xs font-semibold border border-red-200 dark:border-red-800">Reject</button>
              <button onClick={() => approve(it.id)}
                className="bg-green-600 hover:bg-green-700 text-white px-4 py-1.5 rounded-lg text-xs font-semibold">Approve</button>
            </div>
          ))}
        </div>
      )}

      {editTarget && (
        <EditNameModal
          item={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => { setEditTarget(null); mutate() }}
        />
      )}
      {mergeTarget && (
        <MergeIntoModal
          source={mergeTarget}
          onClose={() => setMergeTarget(null)}
          onMerged={(c) => {
            setMergeTarget(null)
            mutate()
            const parts = []
            if (c.challanLines) parts.push(`${c.challanLines} challan line${c.challanLines === 1 ? '' : 's'}`)
            if (c.invoiceLines) parts.push(`${c.invoiceLines} invoice line${c.invoiceLines === 1 ? '' : 's'}`)
            if (c.poLines) parts.push(`${c.poLines} PO line${c.poLines === 1 ? '' : 's'}`)
            if (c.stockMovements) parts.push(`${c.stockMovements} stock movement${c.stockMovements === 1 ? '' : 's'}`)
            alert('Merged. Repointed: ' + (parts.join(', ') || 'nothing — no past references'))
          }}
        />
      )}
    </div>
  )
}
