'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface PrintSettings {
  lotFontSize: number     // px for lot no + than
  chemFontSize: number    // px for chemical name + quantity
  headerFontSize: number  // px for slip header
  labelFontSize: number   // px for section labels
}

const DEFAULTS: PrintSettings = {
  lotFontSize: 14,
  chemFontSize: 12,
  headerFontSize: 18,
  labelFontSize: 13,
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

function PreviewSlip({ settings }: { settings: PrintSettings }) {
  return (
    <div className="bg-white text-black rounded-xl p-4 border border-gray-300 max-w-sm">
      <h1 className="font-bold text-center border-b border-black pb-2 mb-3" style={{ fontSize: settings.headerFontSize }}>
        KOTHARI SYNTHETIC INDUSTRIES
      </h1>
      <p className="text-center text-gray-500 mb-3" style={{ fontSize: settings.labelFontSize - 2 }}>Dyeing Slip</p>
      <div className="mb-3" style={{ fontSize: settings.lotFontSize }}>
        <span className="font-bold">PS-885</span> <span className="text-gray-600">(30 than)</span>
      </div>
      <h3 className="font-bold uppercase border-b border-gray-400 pb-1 mb-2" style={{ fontSize: settings.labelFontSize }}>
        Shade Chemicals
      </h3>
      <table className="w-full" style={{ fontSize: settings.chemFontSize }}>
        <tbody>
          <tr className="border-b border-gray-200">
            <td className="py-1">1</td>
            <td className="py-1 font-medium">Reactive Navy 3G</td>
            <td className="py-1 text-right font-bold">3.5</td>
            <td className="py-1 pl-1 text-gray-600">kg</td>
          </tr>
          <tr className="border-b border-gray-200">
            <td className="py-1">2</td>
            <td className="py-1 font-medium">Salt</td>
            <td className="py-1 text-right font-bold">10.0</td>
            <td className="py-1 pl-1 text-gray-600">kg</td>
          </tr>
          <tr className="border-b border-gray-200">
            <td className="py-1">3</td>
            <td className="py-1 font-medium">Reactive Black B</td>
            <td className="py-1 text-right font-bold">1.2</td>
            <td className="py-1 pl-1 text-gray-600">kg</td>
          </tr>
        </tbody>
      </table>
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

  const sliders: { key: keyof PrintSettings; label: string; min: number; max: number }[] = [
    { key: 'headerFontSize', label: 'Slip Header (Company Name)', min: 10, max: 36 },
    { key: 'lotFontSize', label: 'Lot No & Than', min: 10, max: 36 },
    { key: 'labelFontSize', label: 'Section Labels (Shade, Scouring...)', min: 10, max: 36 },
    { key: 'chemFontSize', label: 'Chemical Name & Quantity', min: 10, max: 36 },
  ]

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg px-4 py-2 text-sm font-medium transition">
          &larr; Back
        </button>
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Settings</h1>
      </div>

      {/* Print Settings */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5 mb-4">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4">Print — Font Size</h2>

        <div className="space-y-5">
          {sliders.map(s => (
            <div key={s.key}>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm text-gray-600 dark:text-gray-300">{s.label}</label>
                <span className="text-sm font-bold text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30 px-2 py-0.5 rounded">{settings[s.key]}px</span>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => update(s.key, Math.max(s.min, settings[s.key] - 1))}
                  className="w-8 h-8 flex items-center justify-center bg-gray-100 dark:bg-gray-700 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 font-bold">
                  −
                </button>
                <input
                  type="range"
                  min={s.min}
                  max={s.max}
                  value={settings[s.key]}
                  onChange={e => update(s.key, parseInt(e.target.value))}
                  className="flex-1 h-2 bg-gray-200 dark:bg-gray-600 rounded-lg appearance-none cursor-pointer accent-purple-600"
                />
                <button onClick={() => update(s.key, Math.min(s.max, settings[s.key] + 1))}
                  className="w-8 h-8 flex items-center justify-center bg-gray-100 dark:bg-gray-700 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 font-bold">
                  +
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={handleSave}
            className="flex-1 bg-purple-600 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-purple-700 transition">
            {saved ? '✅ Saved!' : 'Save Settings'}
          </button>
          <button onClick={handleReset}
            className="px-4 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-xl text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition">
            Reset Default
          </button>
        </div>
      </div>

      {/* Live Preview */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Print Preview</h2>
        <PreviewSlip settings={settings} />
      </div>
    </div>
  )
}
