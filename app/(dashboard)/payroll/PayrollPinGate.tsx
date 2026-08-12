'use client'

import { useEffect, useState } from 'react'

// Lightweight PIN gate for the Payroll module. This is a soft lock — it keeps
// the wages/salary screens out of casual view, NOT a security boundary (the
// data still loads from authenticated APIs). Unlock persists for the browser
// session (sessionStorage), so navigating within Payroll won't re-prompt but a
// new tab / fresh session will.
const PIN = '040140'
const KEY = 'payroll-pin-ok'

export default function PayrollPinGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  const [unlocked, setUnlocked] = useState(false)
  const [entry, setEntry] = useState('')
  const [error, setError] = useState(false)

  useEffect(() => {
    try { if (sessionStorage.getItem(KEY) === '1') setUnlocked(true) } catch {}
    setReady(true)
  }, [])

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (entry === PIN) {
      try { sessionStorage.setItem(KEY, '1') } catch {}
      setUnlocked(true)
      setError(false)
    } else {
      setError(true)
      setEntry('')
    }
  }

  // Avoid a flash of the PIN screen before sessionStorage is read.
  if (!ready) return null
  if (unlocked) return <>{children}</>

  return (
    <div className="min-h-[70vh] flex items-center justify-center p-4">
      <form onSubmit={submit}
        className="w-full max-w-xs bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 space-y-4 text-center">
        <div className="text-3xl">🔒</div>
        <div>
          <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">Payroll locked</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Enter the PIN to open the Payroll module.</p>
        </div>
        <input
          type="password"
          inputMode="numeric"
          autoFocus
          value={entry}
          onChange={(e) => { setEntry(e.target.value); setError(false) }}
          placeholder="••••••"
          className={`w-full text-center tracking-[0.4em] text-lg px-3 py-2.5 border rounded-lg bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 ${
            error ? 'border-red-400 focus:ring-red-300' : 'border-gray-300 dark:border-gray-600 focus:ring-indigo-400'
          }`}
        />
        {error && <p className="text-xs text-red-600 dark:text-red-400">Wrong PIN — try again.</p>}
        <button type="submit"
          className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold">
          Unlock
        </button>
      </form>
    </div>
  )
}
