import Link from 'next/link'
import type { CategoryLotSummary } from '@/lib/finish-category-summary'

// On-screen "Colour Category → lots (with than)" card for a Finish Program.
// Flat: each category lists its lots (clickable → /lot/[lotNo]) + a subtotal.
// The print page renders its own black-and-white version of the same data.

const dot: Record<string, string> = {
  Deep: 'bg-violet-500',
  Medium: 'bg-orange-500',
  Light: 'bg-amber-400',
  Uncategorised: 'bg-gray-400',
}

export default function ColourCategoryLotSummary({ summary }: { summary: CategoryLotSummary[] }) {
  if (!summary.length) return null
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 mb-4">
      <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">🎨 Colour Category — Lot Detail</h2>
      <div className="space-y-3">
        {summary.map(cat => (
          <div key={cat.label}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="flex items-center gap-2 text-xs font-bold text-gray-700 dark:text-gray-200">
                <span className={`w-2 h-2 rounded-full ${dot[cat.label] ?? 'bg-gray-400'}`} />
                {cat.label}
              </span>
              <span className="text-xs font-bold text-gray-600 dark:text-gray-300">{cat.total} than</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {cat.lots.map((l, i) => (
                <Link key={i} href={`/lot/${encodeURIComponent(l.lotNo)}`}
                  className="flex items-center gap-1.5 border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1 bg-gray-50 dark:bg-gray-700/40 hover:border-indigo-300 dark:hover:border-indigo-600 transition">
                  <span className="text-[12px] font-mono font-bold text-teal-700 dark:text-teal-300">{l.lotNo}</span>
                  <span className="text-[10px] text-gray-400">{l.than}</span>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
