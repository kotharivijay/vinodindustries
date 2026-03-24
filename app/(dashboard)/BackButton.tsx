'use client'

import { useRouter } from 'next/navigation'

export default function BackButton() {
  const router = useRouter()
  return (
    <button
      onClick={() => router.back()}
      className="flex items-center gap-1.5 text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 rounded-lg px-4 py-2 text-sm font-medium transition"
    >
      &larr; Back
    </button>
  )
}
