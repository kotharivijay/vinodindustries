'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface PrintSettings {
  headerFontSize: number
  lotFontSize: number
  labelFontSize: number
  chemFontSize: number
  boldChemName: boolean
  boldQuantity: boolean
  boldLotNo: boolean
  dotLeaders: boolean
  paperWidth: 58 | 80
}

const DEFAULTS: PrintSettings = {
  headerFontSize: 18,
  lotFontSize: 14,
  labelFontSize: 13,
  chemFontSize: 12,
  boldChemName: true,
  boldQuantity: true,
  boldLotNo: true,
  dotLeaders: true,
  paperWidth: 80,
}

const STORAGE_KEY = 'print-settings'

function loadSettings(): PrintSettings {
  if (typeof window === 'undefined') return DEFAULTS
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {}
  return DEFAULTS
}

function saveSettings(s: PrintSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
}

function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button onClick={() => onChange(!value)}
      className="flex items-center justify-between w-full py-2">
      <span className="text-sm text-gray-600 dark:text-gray-300">{label}</span>
      <div className={`w-10 h-5 rounded-full transition relative ${value ? 'bg-purple-600' : 'bg-gray-300 dark:bg-gray-600'}`}>
        <div className={`w-4 h-4 bg-white rounded-full absolute top-0.5 transition ${value ? 'left-5.5' : 'left-0.5'}`}
          style={{ left: value ? '22px' : '2px' }} />
      </div>
    </button>
  )
}

function PreviewSlip({ s }: { s: PrintSettings }) {
  const W = s.paperWidth === 58 ? 32 : 48
  const dot = s.dotLeaders ? '.' : ' '

  const chemRow = (name: string, qty: string, unit: string) => {
    const nameStr = name.length > W - 10 ? name.slice(0, W - 10) : name
    const qtyStr = `${qty} ${unit}`
    const pad = Math.max(1, W - 2 - nameStr.length - qtyStr.length)
    return `  ${nameStr}${dot.repeat(pad)}${qtyStr}`
  }

  return (
    <div className="bg-white text-black rounded-xl border border-gray-300 overflow-x-auto">
      <pre className="font-mono p-3 text-xs leading-relaxed whitespace-pre" style={{ fontSize: Math.min(s.chemFontSize, 11) }}>
        <span style={{ fontSize: s.headerFontSize }} className="font-bold block text-center">KOTHARI SYNTHETIC</span>
        <span style={{ fontSize: s.headerFontSize }} className="font-bold block text-center">INDUSTRIES</span>
        <span style={{ fontSize: s.labelFontSize }} className="block text-center text-gray-500">Dyeing Slip</span>
        <span className="block">{'='.repeat(W)}</span>
        <span className="block" style={{ fontSize: s.chemFontSize }}>Slip: 1774        Date: 29/03/26</span>
        <span className="block" style={{ fontSize: s.chemFontSize }}>Party: Prakash Shirting</span>
        <span className="block" style={{ fontSize: s.chemFontSize }}>Shade: PS/MAGIC/12</span>
        <span className="block">{'-'.repeat(W)}</span>
        <span className={`block ${s.boldLotNo ? 'font-bold' : ''}`} style={{ fontSize: s.lotFontSize }}>LOTS:</span>
        <span className={`block ${s.boldLotNo ? 'font-bold' : ''}`} style={{ fontSize: s.lotFontSize }}>  PS-885              30 than</span>
        <span className={`block ${s.boldLotNo ? 'font-bold' : ''}`} style={{ fontSize: s.lotFontSize }}>  PS-890              25 than</span>
        <span className="block">{'-'.repeat(W)}</span>
        <span className="font-bold block" style={{ fontSize: s.labelFontSize }}>DYES (grams)</span>
        <span className={`block`} style={{ fontSize: s.chemFontSize }}>
          <span className={s.boldChemName ? 'font-bold' : ''}>{chemRow('Reactive Navy 3G', '0050', 'gm').split(s.dotLeaders ? '.' : /(?=\d)/)[0]}</span>
          {s.dotLeaders && '...'}<span className={s.boldQuantity ? 'font-bold' : ''}>0050 gm</span>
        </span>
        <span className={`block`} style={{ fontSize: s.chemFontSize }}>
          <span className={s.boldChemName ? 'font-bold' : ''}>{`  Salt`}</span>
          {s.dotLeaders ? dot.repeat(W - 2 - 4 - 7) : ' '.repeat(W - 2 - 4 - 7)}<span className={s.boldQuantity ? 'font-bold' : ''}>0003 gm</span>
        </span>
        <span className="block">{'-'.repeat(W)}</span>
        <span className="font-bold block" style={{ fontSize: s.labelFontSize }}>SCOURING (kg)</span>
        <span className={`block`} style={{ fontSize: s.chemFontSize }}>
          <span className={s.boldChemName ? 'font-bold' : ''}>{`  Caustic Soda Flakes`}</span>
          {s.dotLeaders ? dot.repeat(W - 2 - 21 - 6) : ' '.repeat(W - 2 - 21 - 6)}<span className={s.boldQuantity ? 'font-bold' : ''}>2.0 kg</span>
        </span>
        <span className={`block`} style={{ fontSize: s.chemFontSize }}>
          <span className={s.boldChemName ? 'font-bold' : ''}>{`  XNI`}</span>
          {s.dotLeaders ? dot.repeat(W - 2 - 3 - 6) : ' '.repeat(W - 2 - 3 - 6)}<span className={s.boldQuantity ? 'font-bold' : ''}>0.5 kg</span>
        </span>
        <span className="block">{'='.repeat(W)}</span>
        <span className="block">Operator: ____________</span>
      </pre>
    </div>
  )
}

type Tab = 'print' | 'service'
const TAB_KEY = 'settings-active-tab'

export default function SettingsPage() {
  const router = useRouter()
  const [s, setS] = useState<PrintSettings>(DEFAULTS)
  const [saved, setSaved] = useState(false)
  const [aiBubbleHidden, setAiBubbleHidden] = useState(false)
  const [tab, setTab] = useState<Tab>('print')

  useEffect(() => {
    setS(loadSettings())
    setAiBubbleHidden(localStorage.getItem('ai-bubble-hidden') === 'true')
    const savedTab = localStorage.getItem(TAB_KEY)
    if (savedTab === 'print' || savedTab === 'service') setTab(savedTab)
  }, [])
  useEffect(() => {
    try { localStorage.setItem(TAB_KEY, tab) } catch {}
  }, [tab])

  function update<K extends keyof PrintSettings>(key: K, value: PrintSettings[K]) {
    setS(prev => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  function handleSave() {
    saveSettings(s)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function handleReset() {
    setS(DEFAULTS)
    saveSettings(DEFAULTS)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const sliders: { key: keyof PrintSettings; label: string; icon: string }[] = [
    { key: 'headerFontSize', label: 'Header (Company Name)', icon: '🏢' },
    { key: 'lotFontSize', label: 'Lot No & Than', icon: '📦' },
    { key: 'labelFontSize', label: 'Section Labels', icon: '🏷️' },
    { key: 'chemFontSize', label: 'Chemical & Quantity', icon: '🧪' },
  ]

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg px-4 py-2 text-sm font-medium transition">
          &larr; Back
        </button>
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Settings</h1>
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 mb-4 border-b border-gray-200 dark:border-gray-700">
        {([['print', 'Print'], ['service', 'Service']] as [Tab, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition ${
              tab === k
                ? 'border-purple-600 text-purple-700 dark:text-purple-300'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'service' && <ServiceTab />}
      {tab !== 'service' && (<>

      {/* Font Size */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5 mb-4">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4">Font Size</h2>
        <div className="space-y-4">
          {sliders.map(sl => (
            <div key={sl.key}>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm text-gray-600 dark:text-gray-300">{sl.icon} {sl.label}</label>
                <span className="text-sm font-bold text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30 px-2 py-0.5 rounded">
                  {s[sl.key] as number}px
                </span>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => update(sl.key, Math.max(10, (s[sl.key] as number) - 1) as any)}
                  className="w-8 h-8 flex items-center justify-center bg-gray-100 dark:bg-gray-700 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 font-bold text-lg">−</button>
                <input type="range" min={10} max={36}
                  value={s[sl.key] as number}
                  onChange={e => update(sl.key, parseInt(e.target.value) as any)}
                  className="flex-1 h-2 bg-gray-200 dark:bg-gray-600 rounded-lg appearance-none cursor-pointer accent-purple-600" />
                <button onClick={() => update(sl.key, Math.min(36, (s[sl.key] as number) + 1) as any)}
                  className="w-8 h-8 flex items-center justify-center bg-gray-100 dark:bg-gray-700 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 font-bold text-lg">+</button>
              </div>
              {/* Bluetooth hint */}
              <p className="text-[9px] text-gray-400 mt-0.5">
                Bluetooth: {(s[sl.key] as number) >= 28 ? '⬛ 2x Large' : (s[sl.key] as number) >= 20 ? '◼️ 2x Height' : '▪️ Normal'}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Font Style */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5 mb-4">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Font Style</h2>
        <div className="space-y-1">
          <Toggle label="Bold Chemical Name" value={s.boldChemName} onChange={v => update('boldChemName', v)} />
          <Toggle label="Bold Quantity" value={s.boldQuantity} onChange={v => update('boldQuantity', v)} />
          <Toggle label="Bold Lot No" value={s.boldLotNo} onChange={v => update('boldLotNo', v)} />
        </div>
      </div>

      {/* Column & Paper */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5 mb-4">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Layout</h2>

        <Toggle label="Dot Leaders (Name....Qty)" value={s.dotLeaders} onChange={v => update('dotLeaders', v)} />

        <div className="mt-3">
          <label className="text-sm text-gray-600 dark:text-gray-300 block mb-2">Paper Width (Thermal Printer)</label>
          <div className="flex gap-2">
            {([58, 80] as const).map(w => (
              <button key={w} onClick={() => update('paperWidth', w)}
                className={`flex-1 py-2 rounded-xl text-sm font-medium border transition ${
                  s.paperWidth === w
                    ? 'bg-purple-600 border-purple-600 text-white'
                    : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'
                }`}>
                {w}mm {w === 58 ? '(32 chars)' : '(48 chars)'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* AI Chat Bot */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5 mb-4">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">🤖 AI Chat Bot</h2>
        <Toggle label="Show AI Bot Bubble" value={!aiBubbleHidden} onChange={v => {
          setAiBubbleHidden(!v)
          localStorage.setItem('ai-bubble-hidden', String(!v))
        }} />
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
          {aiBubbleHidden ? 'AI bot is hidden. Toggle ON to show it again.' : 'AI bot bubble is visible on all pages.'}
        </p>
      </div>

      {/* Save/Reset */}
      <div className="flex gap-3 mb-4">
        <button onClick={handleSave}
          className="flex-1 bg-purple-600 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-purple-700 transition">
          {saved ? '✅ Saved!' : 'Save Settings'}
        </button>
        <button onClick={handleReset}
          className="px-4 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-xl text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition">
          Reset
        </button>
      </div>

      {/* Live Preview */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Thermal Print Preview</h2>
        <PreviewSlip s={s} />
      </div>

      </>)}
    </div>
  )
}

// ─── Service Tab ─────────────────────────────────────────────────────────
// Operator-triggered maintenance tasks. First job: clean Party master rows
// that aren't in TallyLedger and aren't referenced anywhere.
interface OrphanRow { id: number; name: string; tag: string | null }
interface LinkedRow { id: number; name: string; tag: string | null; total: number; grey: number; despatch: number; fold: number; finishRecipe: number }
interface CleanupPreview {
  counts: { total: number; inLedger: number; linked: number; orphans: number }
  orphans: OrphanRow[]
  linked: LinkedRow[]
}

function ServiceTab() {
  const [preview, setPreview] = useState<CleanupPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ deleted: number; skipped: number } | null>(null)
  const [showLinked, setShowLinked] = useState(false)

  async function load() {
    setLoading(true); setError(''); setDone(null)
    try {
      const r = await fetch('/api/maintenance/parties', { cache: 'no-store' })
      const data = await r.json()
      if (!r.ok) { setError(data.error || 'Failed to load'); return }
      setPreview(data)
    } catch (e: any) {
      setError(e?.message || 'Network error')
    } finally { setLoading(false) }
  }

  async function deleteOrphans() {
    if (!preview || preview.orphans.length === 0) return
    if (!confirm(`Delete ${preview.orphans.length} orphan parties? This is irreversible.`)) return
    setDeleting(true); setError('')
    try {
      const r = await fetch('/api/maintenance/parties', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: preview.orphans.map(o => o.id) }),
      })
      const data = await r.json()
      if (!r.ok) { setError(data.error || 'Delete failed'); return }
      setDone({ deleted: data.deleted, skipped: data.skipped?.length ?? 0 })
      await load()
    } catch (e: any) {
      setError(e?.message || 'Network error')
    } finally { setDeleting(false) }
  }

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">Party Master Cleanup</h2>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-4">
          Removes Party rows that aren&apos;t in the TallyLedger master AND have zero references in
          any entry (grey, despatch, fold, finish recipes). Safe — the same gate is re-checked
          server-side at delete time.
        </p>

        {!preview && !loading && (
          <button onClick={load}
            className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold">
            Scan Party Master
          </button>
        )}

        {loading && <div className="text-sm text-gray-400">Scanning…</div>}

        {preview && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
              <Stat label="Total" value={preview.counts.total} />
              <Stat label="In Ledger" value={preview.counts.inLedger} tone="green" />
              <Stat label="Typo (linked)" value={preview.counts.linked} tone={preview.counts.linked ? 'amber' : 'green'} />
              <Stat label="Orphans" value={preview.counts.orphans} tone={preview.counts.orphans ? 'rose' : 'green'} />
            </div>

            {preview.counts.linked > 0 && (
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                    {preview.counts.linked} Party row{preview.counts.linked === 1 ? '' : 's'} not in TallyLedger but referenced — needs manual merge:
                  </p>
                  <button onClick={() => setShowLinked(v => !v)}
                    className="text-[11px] text-amber-700 dark:text-amber-300 underline">
                    {showLinked ? 'Hide' : 'Show'}
                  </button>
                </div>
                {showLinked && (
                  <ul className="text-[11px] text-amber-700 dark:text-amber-300 space-y-0.5 max-h-40 overflow-y-auto">
                    {preview.linked.map(p => (
                      <li key={p.id}>
                        <span className="font-medium">{p.name}</span>
                        {p.tag && <span className="opacity-70"> · {p.tag}</span>}
                        <span className="opacity-60"> — refs: {p.total}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div>
              <p className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1.5">
                Orphans ({preview.orphans.length}) — safe to delete:
              </p>
              {preview.orphans.length === 0 ? (
                <p className="text-[11px] text-gray-400">Nothing to clean. ✅</p>
              ) : (
                <ul className="text-[11px] text-gray-600 dark:text-gray-300 space-y-0.5 max-h-48 overflow-y-auto bg-gray-50 dark:bg-gray-900/40 rounded-lg p-2">
                  {preview.orphans.map(p => (
                    <li key={p.id}>
                      <span className="font-mono text-gray-400">[{p.id}]</span> {p.name}
                      {p.tag && <span className="opacity-70"> · {p.tag}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex gap-2">
              <button onClick={load} disabled={loading}
                className="px-4 py-2 rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm">
                Refresh
              </button>
              {preview.orphans.length > 0 && (
                <button onClick={deleteOrphans} disabled={deleting}
                  className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold disabled:opacity-50">
                  {deleting ? 'Deleting…' : `Delete ${preview.orphans.length} orphan${preview.orphans.length === 1 ? '' : 's'}`}
                </button>
              )}
            </div>

            {done && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400">
                ✅ Deleted {done.deleted}. {done.skipped > 0 && `Skipped ${done.skipped} (became referenced).`}
              </p>
            )}
            {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'green' | 'amber' | 'rose' }) {
  const cls = tone === 'green'
    ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20'
    : tone === 'amber'
      ? 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20'
      : tone === 'rose'
        ? 'text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-900/20'
        : 'text-gray-700 dark:text-gray-200 bg-gray-50 dark:bg-gray-900/40'
  return (
    <div className={`rounded-lg p-2 ${cls}`}>
      <div className="text-[10px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  )
}
