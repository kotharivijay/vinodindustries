'use client'

import { useEffect } from 'react'

export default function PrintTrigger() {
  useEffect(() => {
    const timer = setTimeout(() => window.print(), 500)
    return () => clearTimeout(timer)
  }, [])

  return null
}

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="bg-teal-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-teal-700"
    >
      Print
    </button>
  )
}
