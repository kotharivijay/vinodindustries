'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface PrintSettings {
  lotFontSize: number
  chemFontSize: number
  headerFontSize: number
  labelFontSize: number
}

const DEFAULTS: PrintSettings = {
  lotFontSize: 14,
  chemFontSize: 12,
  headerFontSize: 18,
  labelFontSize: 13,
}

const STORAGE_KEY = 'print-settings'

const FONT_PRESETS = [
  { label: 'Small', value: 10 },
  { label: 'Normal', value: 12 },
  { label: 'Medium', value: 14 },
  { label: 'Large', value: 18 },
  { label: 'X-Large', value: 22 },
  { label: 'XX-Large', value: 26 },
  { label: 'XXX-Large', value: 30 },
  { label: 'MAX', value: 36 },
]

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

function getPresetLabel(value: number): string {
  const preset = FONT_PRESETS.find(p => p.value === value)
  return preset ? preset.label : `${value}px`
}

function PreviewSlip({ settings }: { settings: PrintSettings }) {
  const chems = [
    { num: 1, name: 'Reactive Navy 3G', qty: '0050', unit: 'gm' },
    { num: 2, name: 'Salt', qty: '10.0', unit: 'kg' },
    { num: 3, name: 'Reactive Black B', qty: '0003', unit: 'gm' },
    { num: 4, name: 'XNI', qty: '0.5', unit: 'kg' },
  ]

  return (
    <div className="bg-white text-black rounded-xl p-4 border border-gray-300 overflow-x-auto">
      <h1 className="font-bold text-center border-b-2 border-black pb-2 mb-2" style={{ fontSize: settings.headerFontSize }}>
        KOTHARI SYNTHETIC INDUSTRIES
      </h1>
      <p className="text-center text-gray-500 mb-3" style={{ fontSize: settings.labelFontSize }}>Dyeing Slip</p>

      <div className="mb-3" style={{ fontSize: settings.lotFontSize }}>
        <span className="font-bold">PS-885</span> <span className="text-gray-600">(30 than)</span>
        <span className="ml-3 font-bold">PS-890</span> <span className="text-gray-600">(25 than)</span>
      </div>

      <h3 className="font-bold uppercase border-b border-gray-400 pb-1 mb-2" style={{ fontSize: settings.labelFontSize }}>
        DYES (grams)
      </h3>
      <table className="w-full" style={{ fontSize: settings.chemFontSize }}>
        <thead>
          <tr className="border-b border-gray-300">
            <th className="text-left py-1 w-6">#</th>
            <th className="text-left py-1">Chemical</th>
            <th className="text-right py-1 w-20">Qty</th>
            <th className="text-left py-1 pl-2 w-10">Unit</th>
          </tr>
        </thead>
        <tbody>
          {chems.map(c => (
            <tr key={c.num} className="border-b border-gray-200">
              <td className="py-1 text-gray-500">{c.num}</td>
              <td className="py-1 font-medium">{c.name}</td>
              <td className="py-1 text-right font-bold">{c.qty}</td>
              <td className="py-1 pl-2 text-gray-600">{c.unit}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 pt-2 border-t border-gray-300" style={{ fontSize: Math.min(settings.chemFontSize, 12) }}>
        <div className="flex justify-between">
          <span>Operator: ____________</span>
          <span>Supervisor: ____________</span>
        </div>
      </div>
    </div>
  )
}

export default function SettingsPage() {
  const router = useRouter()
  const [settings, setSettings] = useState<PrintSettings>(DEFAULTS)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setSettings(loadSettings())
  }, [])

  function update(key: keyof PrintSettings, value: number) {
    setSettings(prev => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  function handleSave() {
    saveSettings(settings)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function handleReset() {
    setSettings(DEFAULTS)
    saveSettings(DEFAULTS)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const fields: { key: keyof PrintSettings; label: string; icon: string }[] = [
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
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Print Settings</h1>
      </div>

      {/* Font Size Settings */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5 mb-4">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4">Font Size</h2>

        <div className="space-y-4">
          {fields.map(f => (
            <div key={f.key} className="bg-gray-50 dark:bg-gray-900 rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm text-gray-600 dark:text-gray-300 flex items-center gap-2">
                  <span>{f.icon}</span>
                  <span>{f.label}</span>
                </label>
                <span className="text-xs font-bold text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30 px-2 py-0.5 rounded">
                  {getPresetLabel(settings[f.key])}
                </span>
              </div>

              {/* Dropdown */}
              <select
                value={settings[f.key]}
                onChange={e => update(f.key, parseInt(e.target.value))}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500 mb-2"
              >
                {FONT_PRESETS.map(p => (
                  <option key={p.value} value={p.value}>{p.label} ({p.value}px)</option>
                ))}
              </select>

              {/* Quick buttons */}
              <div className="flex gap-1 flex-wrap">
                {FONT_PRESETS.map(p => (
                  <button
                    key={p.value}
                    onClick={() => update(f.key, p.value)}
                    className={`text-[10px] px-2 py-0.5 rounded border transition ${
                      settings[f.key] === p.value
                        ? 'bg-purple-600 border-purple-600 text-white'
                        : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-600'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Bluetooth size hint */}
        <div className="mt-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-3">
          <p className="text-xs text-blue-700 dark:text-blue-400 font-medium mb-1">Bluetooth Printer Size Mapping:</p>
          <div className="grid grid-cols-3 gap-1 text-[10px] text-blue-600 dark:text-blue-500">
            <span>Small-Medium → Normal</span>
            <span>Large-XL → 2x Height</span>
            <span>XXL-MAX → 2x Both</span>
          </div>
        </div>

        <div className="flex gap-3 mt-5">
          <button onClick={handleSave}
            className="flex-1 bg-purple-600 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-purple-700 transition">
            {saved ? '✅ Saved!' : 'Save Settings'}
          </button>
          <button onClick={handleReset}
            className="px-4 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-xl text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition">
            Reset
          </button>
        </div>
      </div>

      {/* Live Preview */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Live Preview</h2>
        <PreviewSlip settings={settings} />
      </div>
    </div>
  )
}
