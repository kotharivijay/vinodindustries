'use client'

import { useRouter } from 'next/navigation'

export default function BackButton({ fallback }: { fallback?: string }) {
  const router = useRouter()
  const onClick = () => {
    // history.length is 1 on a freshly-opened tab / direct URL load —
    // router.back() would be a no-op there. Fall through to `fallback`
    // so the back button always lands the user somewhere sensible.
    if (fallback && typeof window !== 'undefined' && window.history.length <= 1) {
      router.push(fallback)
    } else {
      router.back()
    }
  }
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg px-4 py-2 text-sm font-medium transition"
    >
      &larr; Back
    </button>
  )
}
