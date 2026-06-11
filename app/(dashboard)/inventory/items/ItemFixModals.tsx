'use client'

import { useState, useMemo } from 'react'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface ItemLite {
  id: number
  displayName: string
  alias: { id: number; tallyStockItem: string; gstRate: string | number; category: string }
  unit: string
}

/**
 * Edit just the displayName of an item. Optional checkbox to also rewrite
 * snapshot `description` on past purchase-invoice lines.
 */
export function EditNameModal({ item, onClose, onSaved }: {
  item: ItemLite
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(item.displayName)
  const [refreshDesc, setRefreshDesc] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    const trimmed = name.trim()
    if (!trimmed) { setError('Name is required'); return }
    if (trimmed === item.displayName) { onClose(); return }
    setSaving(true); setError('')
    const res = await fetch(`/api/inv/items/${item.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: trimmed, refreshLineDescriptions: refreshDesc }),
    })
    setSaving(false)
    if (!res.ok) { setError((await res.json()).error || 'Save failed'); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-800 dark:text-gray-100">Edit Item Name</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg">✕</button>
        </div>
        <div className="p-5 space-y-3">
          <div className="text-[11px] text-gray-500 dark:text-gray-400">
            Alias: <span className="font-medium">{item.alias.tallyStockItem}</span> · {item.unit} · GST {Number(item.alias.gstRate).toFixed(0)}%
          </div>
          <label className="block text-xs">
            <span className="text-gray-500 dark:text-gray-400">Display name</span>
            <input value={name} onChange={e => setName(e.target.value)} autoFocus
              className="mt-0.5 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
          </label>
          <label className="flex items-start gap-2 text-xs text-gray-600 dark:text-gray-300">
            <input type="checkbox" checked={refreshDesc} onChange={e => setRefreshDesc(e.target.checked)}
              className="mt-0.5 h-4 w-4" />
            <span>
              Also fix the description on past purchase-invoice lines that snapshot-stored the old name. Manual overrides are preserved.
            </span>
          </label>
          {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
        </div>
        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <button onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200">Cancel</button>
          <button onClick={submit} disabled={saving}
            className="px-5 py-2 rounded-lg text-sm bg-indigo-600 hover:bg-indigo-700 text-white font-semibold disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Merge `source` into another item. Search box → pick target → confirm.
 * Server filters/blocks based on alias-mismatch and pushed-invoice usage.
 */
export function MergeIntoModal({ source, onClose, onMerged }: {
  source: ItemLite
  onClose: () => void
  onMerged: (counts: any) => void
}) {
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<ItemLite | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Filter to items sharing the same alias (server enforces this anyway, but
  // it makes the picker useful instead of hostile).
  const { data: items = [] } = useSWR<ItemLite[]>(
    search.length >= 2
      ? `/api/inv/items?q=${encodeURIComponent(search)}&aliasId=${source.alias.id}`
      : null,
    fetcher,
  )
  const candidates = useMemo(
    () => (items || []).filter(i => i.id !== source.id),
    [items, source.id],
  )

  async function submit() {
    if (!picked) { setError('Pick a target item'); return }
    setSaving(true); setError('')
    const res = await fetch(`/api/inv/items/${source.id}/merge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetId: picked.id }),
    })
    setSaving(false)
    if (!res.ok) { setError((await res.json()).error || 'Merge failed'); return }
    const data = await res.json()
    onMerged(data.counts)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-gray-800 dark:text-gray-100">Merge Item</h3>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
              From <span className="font-semibold">{source.displayName}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg">✕</button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            All past challan lines, invoice lines, PO lines and stock movements
            will repoint from <span className="font-semibold">{source.displayName}</span> to the chosen target.
            The source will be soft-deleted (kept for audit, hidden from new picks).
          </p>
          <input value={search} onChange={e => { setSearch(e.target.value); setPicked(null) }}
            autoFocus
            placeholder="Search the canonical item to merge into…"
            className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
          {search.length >= 2 && (
            <div className="border border-gray-200 dark:border-gray-700 rounded max-h-56 overflow-y-auto">
              {candidates.length === 0 ? (
                <div className="px-3 py-3 text-xs text-gray-400">
                  No matches with the same alias (<span className="font-medium">{source.alias.tallyStockItem}</span>).
                  Re-alias one of the items first if they should be merged.
                </div>
              ) : candidates.map(c => (
                <button key={c.id} onClick={() => setPicked(c)}
                  className={`w-full text-left px-3 py-2 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 border-b border-gray-50 dark:border-gray-700/40 last:border-b-0 ${
                    picked?.id === c.id ? 'bg-indigo-50 dark:bg-indigo-900/30' : ''
                  }`}>
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{c.displayName}</p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">
                    {c.alias.tallyStockItem} · {c.alias.category} · {c.unit} · GST {Number(c.alias.gstRate).toFixed(0)}%
                  </p>
                </button>
              ))}
            </div>
          )}
          {picked && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              About to merge: <strong>{source.displayName}</strong> → <strong>{picked.displayName}</strong>. This is irreversible.
            </div>
          )}
          {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
        </div>
        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <button onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200">Cancel</button>
          <button onClick={submit} disabled={saving || !picked}
            className="px-5 py-2 rounded-lg text-sm bg-rose-600 hover:bg-rose-700 text-white font-semibold disabled:opacity-50">
            {saving ? 'Merging…' : 'Merge'}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Re-point an item to a different Tally alias. Hits PATCH /api/inv/items/{id}
 * with { aliasId, remapReason }. The server blocks the change (409
 * ALIAS_IN_USE) if the item appears on any pushed Tally invoice — in that
 * case we surface the offending invoice list inline so the operator can
 * void/unlink them before retrying.
 */
interface AliasOption {
  id: number
  tallyStockItem: string
  category: string
  unit: string
  gstRate: string | number
}
export function ChangeAliasModal({ item, onClose, onSaved }: {
  item: ItemLite
  onClose: () => void
  onSaved: () => void
}) {
  const { data: aliases = [] } = useSWR<AliasOption[]>('/api/inv/aliases', fetcher)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<AliasOption | null>(null)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [blocked, setBlocked] = useState<{ invoices: any[]; count: number } | null>(null)

  // Same filtering rule as the create-item alias combobox in page.tsx —
  // search across stockItem / category / unit, cap to 100 so the list
  // stays usable.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const base = q
      ? aliases.filter(a =>
          a.tallyStockItem.toLowerCase().includes(q) ||
          a.category.toLowerCase().includes(q) ||
          a.unit.toLowerCase().includes(q),
        )
      : aliases
    // Hide the current alias — re-picking it would be a no-op.
    return base.filter(a => a.id !== item.alias.id).slice(0, 100)
  }, [aliases, query, item.alias.id])

  async function submit() {
    if (!picked) { setError('Pick a target alias'); return }
    setSaving(true); setError(''); setBlocked(null)
    const res = await fetch(`/api/inv/items/${item.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aliasId: picked.id, remapReason: reason.trim() || null }),
    })
    setSaving(false)
    if (res.ok) { onSaved(); return }
    const d = await res.json().catch(() => ({}))
    if (res.status === 409 && d.code === 'ALIAS_IN_USE') {
      setBlocked({ invoices: d.details?.usedInInvoices || [], count: d.details?.usedInInvoiceCount || 0 })
      return
    }
    setError(d.error || `Save failed (HTTP ${res.status})`)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-gray-800 dark:text-gray-100">Change Alias</h3>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
              <span className="font-semibold">{item.displayName}</span> · currently uses{' '}
              <span className="font-mono">{item.alias.tallyStockItem}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg">✕</button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            The new alias takes over <span className="font-mono">unit</span> and{' '}
            <span className="font-mono">gstRate</span> for this item, and any{' '}
            <span className="font-mono">gstOverride</span> is cleared. Every challan / PO / future
            invoice that uses this item will push to the new Tally stock-item name.
          </p>

          <input value={query} onChange={e => { setQuery(e.target.value); setPicked(null) }}
            autoFocus
            placeholder="Search Tally stock items…"
            className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />

          <div className="border border-gray-200 dark:border-gray-700 rounded max-h-56 overflow-y-auto">
            {aliases.length === 0 ? (
              <div className="px-3 py-3 text-xs text-gray-400">Loading aliases…</div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-3 text-xs text-gray-400">
                No other aliases match. {query ? 'Clear the search to see all.' : ''}
              </div>
            ) : filtered.map(a => (
              <button key={a.id} onClick={() => setPicked(a)}
                className={`w-full text-left px-3 py-2 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 border-b border-gray-50 dark:border-gray-700/40 last:border-b-0 ${
                  picked?.id === a.id ? 'bg-indigo-50 dark:bg-indigo-900/30' : ''
                }`}>
                <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{a.tallyStockItem}</p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">
                  {a.category} · {a.unit} · GST {Number(a.gstRate).toFixed(0)}%
                </p>
              </button>
            ))}
          </div>

          {picked && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              About to re-map: <strong>{item.displayName}</strong> →{' '}
              <span className="font-mono">{picked.tallyStockItem}</span>
              {(item.unit !== picked.unit) && (
                <> · unit changes <span className="font-mono">{item.unit}</span> →{' '}
                  <span className="font-mono">{picked.unit}</span></>
              )}
              {(Number(item.alias.gstRate) !== Number(picked.gstRate)) && (
                <> · GST {Number(item.alias.gstRate).toFixed(0)}% →{' '}
                  {Number(picked.gstRate).toFixed(0)}%</>
              )}
            </div>
          )}

          <label className="block text-xs">
            <span className="text-gray-500 dark:text-gray-400">Reason (optional, recorded in audit log)</span>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2}
              placeholder="e.g. Mis-mapped at item creation; should have been Dye 5%"
              className="mt-0.5 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm" />
          </label>

          {blocked && (
            <div className="bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-lg px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
              <p className="font-semibold mb-1">Blocked — item is on {blocked.count} pushed invoice{blocked.count === 1 ? '' : 's'}:</p>
              <ul className="space-y-0.5 max-h-32 overflow-y-auto pl-3 list-disc">
                {blocked.invoices.map((inv: any) => (
                  <li key={inv.id} className="font-mono">
                    {inv.supplierInvoiceNo}
                    {inv.tallyVoucherNo && <> · Tally #{inv.tallyVoucherNo}</>}
                  </li>
                ))}
              </ul>
              <p className="mt-1.5">Void or unlink those invoices first, then retry.</p>
            </div>
          )}
          {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
        </div>
        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <button onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200">Cancel</button>
          <button onClick={submit} disabled={saving || !picked}
            className="px-5 py-2 rounded-lg text-sm bg-indigo-600 hover:bg-indigo-700 text-white font-semibold disabled:opacity-50">
            {saving ? 'Saving…' : 'Change Alias'}
          </button>
        </div>
      </div>
    </div>
  )
}
