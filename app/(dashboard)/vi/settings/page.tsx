'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface FirmInfo {
  code: string
  name: string
  tallyName: string
}

interface SyncResult {
  firm: string
  synced: number
  errors: number
}

export default function TallySettingsPage() {
  const router = useRouter()
  const [connected, setConnected] = useState<boolean | null>(null)
  const [tunnelConfigured, setTunnelConfigured] = useState(false)
  const [firms, setFirms] = useState<Record<string, FirmInfo>>({})
  const [testing, setTesting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncResults, setSyncResults] = useState<SyncResult[] | null>(null)

  useEffect(() => { checkConfig() }, [])

  async function checkConfig() {
    setTesting(true)
    try {
      const res = await fetch('/api/tally/config')
      const data = await res.json()
      setConnected(data.connected)
      setTunnelConfigured(data.tunnelConfigured)
      setFirms(data.firms || {})
    } catch {
      setConnected(false)
    }
    setTesting(false)
  }

  async function handleSyncAll() {
    setSyncing(true)
    setSyncResults(null)
    try {
      const res = await fetch('/api/tally/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firmCode: 'ALL' }),
      })
      const data = await res.json()
      setSyncResults(data.results || [])
    } catch {
      setSyncResults([])
    }
    setSyncing(false)
  }

  return (
    <div className="p-4 md:p-8 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600 transition">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Tally Settings</h1>
          <p className="text-sm text-gray-500 mt-0.5">Tally Prime integration status</p>
        </div>
      </div>

      {/* Connection Status Card */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 mb-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Connection Status</h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">Tunnel URL</span>
            <span className={`text-sm font-medium ${tunnelConfigured ? 'text-green-600' : 'text-red-500'}`}>
              {tunnelConfigured ? 'Configured' : 'Not configured'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">Tally Connection</span>
            <span className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${connected === true ? 'bg-green-500' : connected === false ? 'bg-red-500' : 'bg-gray-300'}`} />
              <span className={`text-sm font-medium ${connected === true ? 'text-green-600' : connected === false ? 'text-red-500' : 'text-gray-400'}`}>
                {connected === true ? 'Connected' : connected === false ? 'Offline' : 'Checking...'}
              </span>
            </span>
          </div>
        </div>
        <button
          onClick={checkConfig}
          disabled={testing}
          className="mt-4 w-full bg-gray-100 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-200 disabled:opacity-50"
        >
          {testing ? 'Testing...' : 'Test Connection'}
        </button>
      </div>

      {/* Companies Card */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 mb-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Tally Companies</h2>
        <div className="space-y-2">
          {Object.values(firms).map(f => (
            <div key={f.code} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
              <div>
                <span className="text-sm font-medium text-gray-800">{f.name}</span>
                <span className="text-xs text-gray-400 ml-2">({f.code})</span>
              </div>
              <span className="text-[10px] text-gray-400 font-mono max-w-[200px] truncate hidden sm:block">{f.tallyName}</span>
            </div>
          ))}
          {Object.keys(firms).length === 0 && (
            <p className="text-sm text-gray-400">No firms configured.</p>
          )}
        </div>
      </div>

      {/* Sync All Card */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 mb-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Sync All Ledgers</h2>
        <p className="text-xs text-gray-500 mb-4">
          Syncs all ledgers from all 5 Tally companies. This may take a few minutes for 9,000+ ledgers.
        </p>
        <button
          onClick={handleSyncAll}
          disabled={syncing || !connected}
          className="w-full bg-indigo-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
        >
          {syncing ? 'Syncing all firms...' : 'Sync All Firms'}
        </button>

        {syncResults && (
          <div className="mt-4 space-y-2">
            {syncResults.map((r, i) => (
              <div key={i} className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm ${
                r.errors === -1 ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'
              }`}>
                <span className="font-medium">{r.firm}</span>
                <span>
                  {r.errors === -1 ? 'Connection failed' : `${r.synced} synced${r.errors > 0 ? `, ${r.errors} errors` : ''}`}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Instructions */}
      <div className="bg-gray-50 rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">Setup Instructions</h2>
        <div className="text-xs text-gray-500 space-y-1.5">
          <p>1. Ensure Tally Prime is running with ODBC/XML server enabled on port 9000.</p>
          <p>2. Set up Cloudflare Tunnel pointing to Tally server (localhost:9000).</p>
          <p>3. Add the following to your <code className="bg-white px-1 py-0.5 rounded border text-gray-700">.env</code> file:</p>
          <pre className="bg-white rounded-lg border p-3 mt-2 text-gray-600 overflow-x-auto">
{`TALLY_TUNNEL_URL=https://your-tunnel.example.com
TALLY_API_SECRET=your-secret-key`}
          </pre>
          <p className="mt-2">4. Restart the application and test the connection above.</p>
        </div>
      </div>
    </div>
  )
}
