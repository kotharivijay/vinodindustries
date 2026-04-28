'use client'

import Link from 'next/link'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const tiles = [
  { href: '/inventory/challans', icon: '📥', label: 'Inward Challans', desc: 'Record incoming material' },
  { href: '/inventory/po', icon: '📝', label: 'Purchase Orders', desc: 'Send POs to suppliers' },
  { href: '/inventory/invoices', icon: '🧾', label: 'Purchase Invoices', desc: 'Push to Tally' },
  { href: '/inventory/items', icon: '📦', label: 'Items Master', desc: 'Real items + aliases' },
  { href: '/inventory/parties', icon: '👥', label: 'Parties', desc: 'Suppliers (synced from Tally)' },
  { href: '/inventory/aliases', icon: '🏷️', label: 'Tally Aliases', desc: 'Stock items master' },
  { href: '/inventory/items/review', icon: '✅', label: 'Item Review', desc: 'Approve pending items' },
  { href: '/inventory/config', icon: '⚙️', label: 'Tally Config', desc: 'Ledgers & godowns' },
]

export default function InventoryHub() {
  const { data: review } = useSWR('/api/inv/items/review-queue', fetcher, { refreshInterval: 30000 })
  const reviewCount = Array.isArray(review) ? review.length : 0

  return (
    <div className="p-4 md:p-8 max-w-5xl">
      <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">Inventory</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        KSI inward · purchase · stock · Tally push.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {tiles.map(t => {
          const showBadge = t.href === '/inventory/items/review' && reviewCount > 0
          return (
            <Link key={t.href} href={t.href}
              className="relative bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 hover:border-indigo-400 hover:shadow-sm transition">
              <div className="text-2xl mb-2">{t.icon}</div>
              <div className="text-sm font-bold text-gray-800 dark:text-gray-100">{t.label}</div>
              <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{t.desc}</div>
              {showBadge && (
                <span className="absolute top-2 right-2 bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  {reviewCount}
                </span>
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
