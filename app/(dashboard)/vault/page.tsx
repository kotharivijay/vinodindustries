'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

type Status = 'loading' | 'setup' | 'locked' | 'unlocked'
type EntityType = 'company' | 'person' | 'huf'
interface Entity {
  id: number
  type: EntityType
  name: string
  docCount: number
  createdAt: string
}

const TYPE_ICONS: Record<EntityType, string> = { company: '\u{1F3E2}', person: '\u{1F464}', huf: '\u{1F3E0}' }
const TYPE_LABELS: Record<EntityType, string> = { company: 'Company', person: 'Person', huf: 'HUF' }

const DETAIL_FIELDS: Record<EntityType, { key: string; label: string }[]> = {
  company: [
    { key: 'pan', label: 'PAN' },
    { key: 'gst', label: 'GST' },
    { key: 'cin', label: 'CIN' },
    { key: 'address', label: 'Address' },
    { key: 'bank', label: 'Bank' },
    { key: 'notes', label: 'Notes' },
  ],
  person: [
    { key: 'pan', label: 'PAN' },
    { key: 'aadhaar', label: 'Aadhaar' },
    { key: 'mobile', label: 'Mobile' },
    { key: 'address', label: 'Address' },
    { key: 'relation', label: 'Relation' },
    { key: 'notes', label: 'Notes' },
  ],
  huf: [
    { key: 'pan', label: 'PAN' },
    { key: 'karta', label: 'Karta' },
    { key: 'members', label: 'Members' },
    { key: 'address', label: 'Address' },
    { key: 'notes', label: 'Notes' },
  ],
}

export default function VaultPage() {
  const router = useRouter()
  const [status, setStatus] = useState<Status>('loading')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [entities, setEntities] = useState<Entity[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [newEntity, setNewEntity] = useState<{ type: EntityType; name: string; details: Record<string, string> }>({
    type: 'company',
    name: '',
    details: {},
  })
  const [filterType, setFilterType] = useState<'' | EntityType>('')
  const [search, setSearch] = useState('')
  const [unlockTime, setUnlockTime] = useState<number | null>(null)
  const [timeLeft, setTimeLeft] = useState('')

  const loadEntities = useCallback(async () => {
    try {
      const res = await fetch('/api/vault/entities')
      if (res.ok) {
        const data = await res.json()
        setEntities(data)
        setStatus('unlocked')
        setUnlockTime(Date.now())
      } else if (res.status === 403) {
        setStatus('locked')
      }
    } catch {
      setError('Failed to load entities')
    }
  }, [])

  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch('/api/vault/unlock')
        const data = await res.json()
        if (!data.configured) setStatus('setup')
        else if (!data.unlocked) setStatus('locked')
        else {
          setUnlockTime(Date.now())
          loadEntities()
        }
      } catch {
        setError('Failed to check vault status')
        setStatus('locked')
      }
    })()
  }, [loadEntities])

  // Auto-lock timer display
  useEffect(() => {
    if (status !== 'unlocked' || !unlockTime) return
    const LOCK_DURATION = 15 * 60 * 1000 // 15 min
    const interval = setInterval(() => {
      const elapsed = Date.now() - unlockTime
      const remaining = Math.max(0, LOCK_DURATION - elapsed)
      if (remaining <= 0) {
        // Auto-lock
        fetch('/api/vault/unlock', { method: 'DELETE' }).then(() => {
          setStatus('locked')
          setEntities([])
          setUnlockTime(null)
          setPassword('')
        })
        clearInterval(interval)
        return
      }
      const mins = Math.floor(remaining / 60000)
      const secs = Math.floor((remaining % 60000) / 1000)
      setTimeLeft(`${mins}:${secs.toString().padStart(2, '0')}`)
    }, 1000)
    return () => clearInterval(interval)
  }, [status, unlockTime])

  const handleSetup = async () => {
    setError('')
    if (password.length < 6) { setError('Password must be at least 6 characters'); return }
    if (password !== confirmPassword) { setError('Passwords do not match'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/vault/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (!res.ok) { const d = await res.json(); setError(d.error || 'Setup failed'); setSaving(false); return }
      // Auto-unlock after setup
      const unlockRes = await fetch('/api/vault/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (unlockRes.ok) {
        setUnlockTime(Date.now())
        await loadEntities()
      }
    } catch { setError('Network error') }
    setSaving(false)
  }

  const handleUnlock = async () => {
    setError('')
    if (!password) { setError('Enter your password'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/vault/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (!res.ok) {
        const d = await res.json()
        setError(d.error || 'Unlock failed')
        setSaving(false)
        return
      }
      setPassword('')
      setUnlockTime(Date.now())
      await loadEntities()
    } catch { setError('Network error') }
    setSaving(false)
  }

  const handleLock = async () => {
    await fetch('/api/vault/unlock', { method: 'DELETE' })
    setStatus('locked')
    setEntities([])
    setUnlockTime(null)
    setPassword('')
  }

  const handleAddEntity = async () => {
    setError('')
    if (!newEntity.name.trim()) { setError('Name is required'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/vault/entities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newEntity),
      })
      if (!res.ok) { const d = await res.json(); setError(d.error || 'Failed to add'); setSaving(false); return }
      setShowAdd(false)
      setNewEntity({ type: 'company', name: '', details: {} })
      await loadEntities()
    } catch { setError('Network error') }
    setSaving(false)
  }

  const filtered = entities.filter(e => {
    if (filterType && e.type !== filterType) return false
    if (search && !e.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  // ── LOADING ──
  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-amber-50">
        <div className="text-center">
          <div className="text-4xl mb-3 animate-pulse">{'\u{1F512}'}</div>
          <p className="text-amber-700 font-medium">Loading vault...</p>
        </div>
      </div>
    )
  }

  // ── SETUP ──
  if (status === 'setup') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-amber-50 p-4">
        <div className="bg-white rounded-2xl shadow-lg border border-amber-200 p-8 w-full max-w-md">
          <div className="text-center mb-6">
            <div className="text-5xl mb-3">{'\u{1F512}'}</div>
            <h1 className="text-2xl font-bold text-amber-800">Create Document Vault</h1>
            <p className="text-amber-600 mt-2 text-sm">Set a password to encrypt your sensitive documents</p>
          </div>
          {error && <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">{error}</div>}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-amber-800 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Min 6 characters"
                className="w-full border border-amber-300 rounded-lg px-4 py-3 text-base focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                onKeyDown={e => e.key === 'Enter' && handleSetup()}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-amber-800 mb-1">Confirm Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Re-enter password"
                className="w-full border border-amber-300 rounded-lg px-4 py-3 text-base focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                onKeyDown={e => e.key === 'Enter' && handleSetup()}
              />
            </div>
            <button
              onClick={handleSetup}
              disabled={saving}
              className="w-full bg-amber-600 text-white py-3 rounded-lg font-semibold text-base hover:bg-amber-700 transition disabled:opacity-50"
            >
              {saving ? 'Creating...' : '\u{1F512} Create Vault'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── LOCKED ──
  if (status === 'locked') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-amber-50 p-4">
        <div className="bg-white rounded-2xl shadow-lg border border-amber-200 p-8 w-full max-w-md">
          <div className="text-center mb-6">
            <div className="text-5xl mb-3">{'\u{1F510}'}</div>
            <h1 className="text-2xl font-bold text-amber-800">Vault Locked</h1>
            <p className="text-amber-600 mt-2 text-sm">Enter your password to access encrypted documents</p>
          </div>
          {error && <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">{error}</div>}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-amber-800 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter vault password"
                className="w-full border border-amber-300 rounded-lg px-4 py-3 text-base focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                onKeyDown={e => e.key === 'Enter' && handleUnlock()}
              />
            </div>
            <button
              onClick={handleUnlock}
              disabled={saving}
              className="w-full bg-amber-600 text-white py-3 rounded-lg font-semibold text-base hover:bg-amber-700 transition disabled:opacity-50"
            >
              {saving ? 'Unlocking...' : '\u{1F513} Unlock Vault'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── UNLOCKED ──
  return (
    <div className="min-h-screen bg-amber-50">
      {/* Header */}
      <div className="bg-white border-b border-amber-200 px-4 py-4 md:px-6 sticky top-0 z-10">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl md:text-2xl font-bold text-amber-800">{'\u{1F512}'} Document Vault</h1>
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline text-xs text-amber-600 bg-amber-100 px-2 py-1 rounded-full font-medium">
              {'\u{1F512}'} Auto-locks in {timeLeft || '15:00'}
            </span>
            <button
              onClick={handleLock}
              className="bg-red-100 text-red-700 px-3 py-2 rounded-lg text-sm font-semibold hover:bg-red-200 transition"
            >
              {'\u{1F510}'} Lock
            </button>
            <button
              onClick={() => { setShowAdd(true); setError('') }}
              className="bg-amber-600 text-white px-3 py-2 rounded-lg text-sm font-semibold hover:bg-amber-700 transition"
            >
              + Add Entity
            </button>
          </div>
        </div>
        {/* Mobile auto-lock indicator */}
        <div className="sm:hidden mt-2 text-xs text-amber-600 bg-amber-100 px-2 py-1 rounded-full font-medium text-center">
          {'\u{1F512}'} Auto-locks in {timeLeft || '15:00'}
        </div>
      </div>

      <div className="px-4 md:px-6 py-4">
        {error && <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">{error}</div>}

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="flex gap-1 flex-wrap">
            {(['' , 'company', 'person', 'huf'] as const).map(t => (
              <button
                key={t}
                onClick={() => setFilterType(t as '' | EntityType)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                  filterType === t
                    ? 'bg-amber-600 text-white'
                    : 'bg-white text-amber-700 border border-amber-300 hover:bg-amber-100'
                }`}
              >
                {t === '' ? 'All' : TYPE_LABELS[t]}
              </button>
            ))}
          </div>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search entities..."
            className="border border-amber-300 rounded-lg px-3 py-1.5 text-sm flex-1 focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
          />
        </div>

        {/* Entity list */}
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-amber-600">
            <div className="text-4xl mb-3">{'\u{1F4C1}'}</div>
            <p className="font-medium">No entities found</p>
            <p className="text-sm mt-1">Add a company, person, or HUF to get started</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map(e => (
              <Link
                key={e.id}
                href={`/vault/${e.id}`}
                className="bg-white rounded-xl border border-amber-200 p-4 hover:shadow-md hover:border-amber-400 transition block"
              >
                <div className="flex items-start gap-3">
                  <span className="text-2xl">{TYPE_ICONS[e.type]}</span>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-900 truncate">{e.name}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                        {TYPE_LABELS[e.type]}
                      </span>
                      <span className="text-xs text-gray-500">
                        {e.docCount} {e.docCount === 1 ? 'doc' : 'docs'}
                      </span>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Add Entity Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-xl border border-amber-200 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-amber-800">Add Entity</h2>
                <button onClick={() => { setShowAdd(false); setError('') }} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
              </div>
              {error && <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">{error}</div>}

              {/* Type selector */}
              <div className="flex gap-2 mb-4">
                {(['company', 'person', 'huf'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setNewEntity({ ...newEntity, type: t, details: {} })}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${
                      newEntity.type === t
                        ? 'bg-amber-600 text-white'
                        : 'bg-amber-50 text-amber-700 border border-amber-300 hover:bg-amber-100'
                    }`}
                  >
                    {TYPE_ICONS[t]} {TYPE_LABELS[t]}
                  </button>
                ))}
              </div>

              {/* Name */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-amber-800 mb-1">Name</label>
                <input
                  type="text"
                  value={newEntity.name}
                  onChange={e => setNewEntity({ ...newEntity, name: e.target.value })}
                  placeholder="Entity name"
                  className="w-full border border-amber-300 rounded-lg px-4 py-2.5 text-base focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                />
              </div>

              {/* Detail fields */}
              <div className="space-y-3">
                {DETAIL_FIELDS[newEntity.type].map(f => (
                  <div key={f.key}>
                    <label className="block text-sm font-medium text-amber-800 mb-1">{f.label}</label>
                    {f.key === 'notes' || f.key === 'members' ? (
                      <textarea
                        value={newEntity.details[f.key] || ''}
                        onChange={e => setNewEntity({ ...newEntity, details: { ...newEntity.details, [f.key]: e.target.value } })}
                        placeholder={f.label}
                        rows={2}
                        className="w-full border border-amber-300 rounded-lg px-4 py-2.5 text-base focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none resize-none"
                      />
                    ) : (
                      <input
                        type="text"
                        value={newEntity.details[f.key] || ''}
                        onChange={e => setNewEntity({ ...newEntity, details: { ...newEntity.details, [f.key]: e.target.value } })}
                        placeholder={f.label}
                        className="w-full border border-amber-300 rounded-lg px-4 py-2.5 text-base focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                      />
                    )}
                  </div>
                ))}
              </div>

              <button
                onClick={handleAddEntity}
                disabled={saving}
                className="w-full mt-5 bg-amber-600 text-white py-3 rounded-lg font-semibold text-base hover:bg-amber-700 transition disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Entity'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
