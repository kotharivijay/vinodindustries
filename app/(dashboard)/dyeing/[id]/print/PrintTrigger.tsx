'use client'

import { useEffect } from 'react'

export default function PrintTrigger() {
  useEffect(() => {
    // Small delay to let styles load
    const timer = setTimeout(() => window.print(), 500)
    return () => clearTimeout(timer)
  }, [])

  return null
}

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="bg-purple-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-purple-700"
    >
      Print
    </button>
  )
}
