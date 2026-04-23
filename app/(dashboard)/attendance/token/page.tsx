'use client'

import { useState } from 'react'
import BackButton from '../../BackButton'

export default function AttendanceTokenPage() {
  const [raw, setRaw] = useState('')
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState('')

  async function save() {
    setSaving(true); setError(''); setResult(null)
    try {
      let payload: any = null
      try { payload = JSON.parse(raw) } catch {
        // assume raw is just the token string
        payload = { token: raw.trim() }
      }
      // If user pasted the full authUser JSON, wrap it
      if (payload?.data && payload?.token) payload = { authUser: payload }
      const res = await fetch('/api/attendance/save-token', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const d = await res.json()
      if (!res.ok) { setError(d.error || `HTTP ${res.status}`); return }
      setResult(d)
    } catch (e: any) { setError(e?.message || 'Failed') }
    finally { setSaving(false) }
  }

  const snippet = `(() => {
  const au = sessionStorage.getItem('authUser')
  if (!au) { alert('Not logged in — open payroll.petpooja.com first.'); return }
  fetch('${typeof window !== 'undefined' ? window.location.origin : ''}/api/attendance/save-token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authUser: JSON.parse(au) }),
    credentials: 'include',
  }).then(r => r.json()).then(d => {
    console.log(d); alert(d.ok ? '✅ Token saved (expires ' + d.expiresAt + ', ' + d.daysLeft + ' days)' : '❌ ' + JSON.stringify(d))
  })
})()`

  return (
    <div className="p-4 md:p-8 max-w-3xl">
      <div className="flex items-center gap-3 mb-5">
        <BackButton />
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Petpooja Token</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Capture or paste the token so the Attendance module can fetch data.</p>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 mb-4">
        <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100 mb-2">Option A — Browser snippet (easiest)</h2>
        <ol className="text-xs text-gray-600 dark:text-gray-300 space-y-1 mb-3 list-decimal list-inside">
          <li>Open <a className="text-indigo-600 underline" href="https://payroll.petpooja.com" target="_blank" rel="noreferrer">payroll.petpooja.com</a> and log in via Google.</li>
          <li>Open DevTools (F12) → <b>Console</b> tab.</li>
          <li>Paste the snippet below → hit Enter.</li>
          <li>A confirmation alert appears once the token is saved.</li>
        </ol>
        <pre className="bg-gray-900 text-green-300 text-[11px] p-3 rounded-lg overflow-auto max-h-48 whitespace-pre">{snippet}</pre>
        <button onClick={() => { navigator.clipboard.writeText(snippet); alert('Copied!') }}
          className="mt-2 text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg font-semibold">Copy snippet</button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100 mb-2">Option B — Paste manually</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Paste either the full <code>authUser</code> JSON from sessionStorage, or just the raw JWT token string.</p>
        <textarea value={raw} onChange={e => setRaw(e.target.value)}
          placeholder='{"data":{"user_id":…},"token":"eyJ…"}  or just  eyJ…'
          className="w-full h-40 text-xs font-mono border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
        <button onClick={save} disabled={!raw.trim() || saving}
          className="mt-3 bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50">
          {saving ? 'Saving…' : 'Save Token'}
        </button>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        {result && (
          <div className="mt-3 text-xs bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 rounded-lg p-2 text-green-700 dark:text-green-300">
            ✓ Saved. Expires <b>{new Date(result.expiresAt).toLocaleString('en-IN')}</b> ({result.daysLeft} days).
          </div>
        )}
      </div>
    </div>
  )
}
