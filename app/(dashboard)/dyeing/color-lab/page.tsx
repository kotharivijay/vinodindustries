'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import BackButton from '../../BackButton'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Chemical {
  name: string
  quantity: number | null
  unit: string
  cost: number | null
  processTag: string | null
}

interface ColorEntry {
  id: number
  slipNo: number
  lotNo: string
  than: number
  shadeName: string | null
  colorC: number
  colorM: number
  colorY: number
  colorK: number
  colorHex: string | null
  dyeingDoneAt: string
  dyeingPhotoUrl: string | null
  totalCost: number
  shadeCost: number
  chemicals: Chemical[]
  shadeChemicals: Chemical[]
}

interface Suggestion {
  shadeName: string
  avgCMYK: { C: number; M: number; Y: number; K: number }
  avgDeltaE: number
  avgCost: number
  timesUsed: number
  recipe: Chemical[]
  savings: number
}

interface Prediction {
  colorC: number
  colorM: number
  colorY: number
  colorK: number
  colorHex: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const cmykToHex = (c: number, m: number, y: number, k: number): string => {
  const r = Math.round(255 * (1 - c / 100) * (1 - k / 100))
  const g = Math.round(255 * (1 - m / 100) * (1 - k / 100))
  const b = Math.round(255 * (1 - y / 100) * (1 - k / 100))
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

const deltaE = (c1: number[], c2: number[]): number => {
  return Math.sqrt(
    (c1[0] - c2[0]) ** 2 +
    (c1[1] - c2[1]) ** 2 +
    (c1[2] - c2[2]) ** 2 +
    (c1[3] - c2[3]) ** 2
  )
}

const deltaLabel = (d: number): { text: string; color: string } => {
  if (d < 5) return { text: 'Exact', color: 'text-green-400' }
  if (d < 10) return { text: 'Very Close', color: 'text-blue-400' }
  if (d < 20) return { text: 'Similar', color: 'text-yellow-400' }
  return { text: 'Different', color: 'text-red-400' }
}

const formatDate = (d: string) => {
  const date = new Date(d)
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

const formatCurrency = (n: number) => {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

// ─── Color Swatch Component ─────────────────────────────────────────────────

const ColorSwatch = ({ hex, size = 32, className = '' }: { hex: string | null; size?: number; className?: string }) => (
  <div
    className={`rounded border border-gray-600 flex-shrink-0 ${className}`}
    style={{
      width: size,
      height: size,
      backgroundColor: hex || '#000',
    }}
  />
)

// ─── CMYK Slider ─────────────────────────────────────────────────────────────

const CMYKSlider = ({
  label,
  value,
  onChange,
  color,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  color: string
}) => (
  <div className="flex items-center gap-3">
    <span className="text-xs font-bold w-4 text-gray-400">{label}</span>
    <input
      type="range"
      min={0}
      max={100}
      value={value}
      onChange={(e) => onChange(parseInt(e.target.value))}
      className="flex-1 h-2 rounded-lg appearance-none cursor-pointer"
      style={{
        background: `linear-gradient(to right, white, ${color})`,
      }}
    />
    <input
      type="number"
      min={0}
      max={100}
      value={value}
      onChange={(e) => onChange(Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))}
      className="w-14 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm text-center"
    />
  </div>
)

// ─── Tab Button ──────────────────────────────────────────────────────────────

const TabBtn = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button
    onClick={onClick}
    className={`px-4 py-2 text-sm font-medium rounded-lg transition ${
      active ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
    }`}
  >
    {children}
  </button>
)

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function ColorLabPage() {
  // Data
  const [entries, setEntries] = useState<ColorEntry[]>([])
  const [loading, setLoading] = useState(true)

  // Tabs
  const [activeTab, setActiveTab] = useState<'analytics' | 'match' | 'suggest' | 'predict'>('analytics')

  // Analytics state
  const [sortField, setSortField] = useState<'date' | 'shade' | 'cost'>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [search, setSearch] = useState('')

  // Color Match state
  const [matchC, setMatchC] = useState(0)
  const [matchM, setMatchM] = useState(0)
  const [matchY, setMatchY] = useState(0)
  const [matchK, setMatchK] = useState(0)

  // Suggestions state
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [suggestLowData, setSuggestLowData] = useState(false)
  const [suggestTotal, setSuggestTotal] = useState(0)

  // Predict state
  const [predictChems, setPredictChems] = useState<{ name: string; quantity: number }[]>([
    { name: '', quantity: 0 },
  ])
  const [prediction, setPrediction] = useState<Prediction | null>(null)
  const [predictConfidence, setPredictConfidence] = useState(0)
  const [predictMatches, setPredictMatches] = useState(0)
  const [predictTopMatches, setPredictTopMatches] = useState<any[]>([])
  const [predictLoading, setPredictLoading] = useState(false)

  // Chemical names for autocomplete
  const [allChemNames, setAllChemNames] = useState<string[]>([])

  // Image upload for color match
  const fileRef = useRef<HTMLInputElement>(null)
  const [extracting, setExtracting] = useState(false)

  // ── Fetch data ──
  useEffect(() => {
    fetch('/api/dyeing/color-data')
      .then((r) => r.json())
      .then((data) => {
        setEntries(data)
        // Extract unique chemical names
        const names = new Set<string>()
        data.forEach((e: ColorEntry) =>
          e.chemicals.forEach((c) => {
            if (c.processTag === 'shade') names.add(c.name)
          })
        )
        setAllChemNames(Array.from(names).sort())
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  // ── Analytics: stats ──
  const stats = useMemo(() => {
    const uniqueShades = new Set(entries.filter((e) => e.shadeName).map((e) => e.shadeName))
    return {
      total: entries.length,
      uniqueShades: uniqueShades.size,
    }
  }, [entries])

  // ── Analytics: filtered + sorted list ──
  const filteredEntries = useMemo(() => {
    let list = [...entries]
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(
        (e) =>
          (e.shadeName?.toLowerCase().includes(q)) ||
          e.lotNo.toLowerCase().includes(q) ||
          String(e.slipNo).includes(q)
      )
    }
    list.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1
      if (sortField === 'date') return dir * (new Date(a.dyeingDoneAt).getTime() - new Date(b.dyeingDoneAt).getTime())
      if (sortField === 'shade') return dir * ((a.shadeName || '').localeCompare(b.shadeName || ''))
      return dir * (a.totalCost - b.totalCost)
    })
    return list
  }, [entries, search, sortField, sortDir])

  // ── Color Match: results ──
  const matchResults = useMemo(() => {
    const target = [matchC, matchM, matchY, matchK]
    return entries
      .map((e) => ({
        ...e,
        deltaE: deltaE(target, [e.colorC, e.colorM, e.colorY, e.colorK]),
      }))
      .sort((a, b) => a.deltaE - b.deltaE)
      .slice(0, 10)
  }, [entries, matchC, matchM, matchY, matchK])

  const targetHex = cmykToHex(matchC, matchM, matchY, matchK)

  // ── Fetch suggestions ──
  const fetchSuggestions = useCallback(async () => {
    setSuggestLoading(true)
    try {
      const res = await fetch('/api/dyeing/color-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ colorC: matchC, colorM: matchM, colorY: matchY, colorK: matchK }),
      })
      const data = await res.json()
      setSuggestions(data.suggestions || [])
      setSuggestLowData(data.lowData)
      setSuggestTotal(data.totalConfirmed)
    } catch (err) {
      console.error(err)
    } finally {
      setSuggestLoading(false)
    }
  }, [matchC, matchM, matchY, matchK])

  // ── Fetch prediction ──
  const fetchPrediction = useCallback(async () => {
    const valid = predictChems.filter((c) => c.name.trim())
    if (!valid.length) return
    setPredictLoading(true)
    try {
      const res = await fetch('/api/dyeing/color-predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chemicals: valid }),
      })
      const data = await res.json()
      setPrediction(data.prediction)
      setPredictConfidence(data.confidence || 0)
      setPredictMatches(data.matchCount || 0)
      setPredictTopMatches(data.topMatches || [])
    } catch (err) {
      console.error(err)
    } finally {
      setPredictLoading(false)
    }
  }, [predictChems])

  // ── Image upload → extract CMYK ──
  const handleImageUpload = async (file: File) => {
    setExtracting(true)
    try {
      const reader = new FileReader()
      const base64 = await new Promise<string>((resolve) => {
        reader.onload = () => {
          const result = reader.result as string
          resolve(result.split(',')[1])
        }
        reader.readAsDataURL(file)
      })

      // Create canvas to extract center 30%
      const img = new Image()
      const imgUrl = URL.createObjectURL(file)
      await new Promise<void>((resolve) => {
        img.onload = () => resolve()
        img.src = imgUrl
      })

      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')!
      const sw = Math.round(img.width * 0.3)
      const sh = Math.round(img.height * 0.3)
      const sx = Math.round((img.width - sw) / 2)
      const sy = Math.round((img.height - sh) / 2)
      canvas.width = sw
      canvas.height = sh
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)

      // Sample pixels and average
      const imageData = ctx.getImageData(0, 0, sw, sh)
      const pixels = imageData.data
      let totalR = 0, totalG = 0, totalB = 0
      const count = pixels.length / 4
      for (let i = 0; i < pixels.length; i += 4) {
        totalR += pixels[i]
        totalG += pixels[i + 1]
        totalB += pixels[i + 2]
      }
      const avgR = totalR / count / 255
      const avgG = totalG / count / 255
      const avgB = totalB / count / 255

      // RGB → CMYK
      const k = 1 - Math.max(avgR, avgG, avgB)
      if (k >= 1) {
        setMatchC(0); setMatchM(0); setMatchY(0); setMatchK(100)
      } else {
        setMatchC(Math.round(((1 - avgR - k) / (1 - k)) * 100))
        setMatchM(Math.round(((1 - avgG - k) / (1 - k)) * 100))
        setMatchY(Math.round(((1 - avgB - k) / (1 - k)) * 100))
        setMatchK(Math.round(k * 100))
      }

      URL.revokeObjectURL(imgUrl)
    } catch (err) {
      console.error('Failed to extract color:', err)
    } finally {
      setExtracting(false)
    }
  }

  // ── Copy recipe ──
  const copyRecipe = (chems: Chemical[]) => {
    const text = chems.map((c) => `${c.name}: ${c.quantity ?? '-'} ${c.unit}`).join('\n')
    navigator.clipboard.writeText(text)
  }

  // ── Sort toggle ──
  const toggleSort = (field: 'date' | 'shade' | 'cost') => {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortField(field); setSortDir('desc') }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <BackButton />
        <div>
          <h1 className="text-2xl font-bold">Color Lab</h1>
          <p className="text-sm text-gray-400 mt-1">Analytics, color matching, and recipe suggestions</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        <TabBtn active={activeTab === 'analytics'} onClick={() => setActiveTab('analytics')}>
          Analytics
        </TabBtn>
        <TabBtn active={activeTab === 'match'} onClick={() => setActiveTab('match')}>
          Find Similar
        </TabBtn>
        <TabBtn active={activeTab === 'suggest'} onClick={() => setActiveTab('suggest')}>
          Suggestions
        </TabBtn>
        <TabBtn active={activeTab === 'predict'} onClick={() => setActiveTab('predict')}>
          Predict Color
        </TabBtn>
      </div>

      {/* ════════════════════ ANALYTICS TAB ════════════════════ */}
      {activeTab === 'analytics' && (
        <div className="space-y-6">
          {/* Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="bg-gray-800 rounded-xl p-4">
              <p className="text-xs text-gray-400 uppercase tracking-wider">Confirmed Slips</p>
              <p className="text-2xl font-bold mt-1">{stats.total}</p>
            </div>
            <div className="bg-gray-800 rounded-xl p-4">
              <p className="text-xs text-gray-400 uppercase tracking-wider">Unique Shades</p>
              <p className="text-2xl font-bold mt-1">{stats.uniqueShades}</p>
            </div>
            <div className="bg-gray-800 rounded-xl p-4 col-span-2 md:col-span-1">
              <p className="text-xs text-gray-400 uppercase tracking-wider">Color Distribution</p>
              <div className="flex flex-wrap gap-1 mt-2 max-h-20 overflow-y-auto">
                {entries.slice(0, 60).map((e) => (
                  <ColorSwatch key={e.id} hex={e.colorHex || cmykToHex(e.colorC, e.colorM, e.colorY, e.colorK)} size={20} />
                ))}
              </div>
            </div>
          </div>

          {/* Search + Sort */}
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              placeholder="Search shade, lot, slip..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm placeholder-gray-500"
            />
            <div className="flex gap-2">
              {(['date', 'shade', 'cost'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => toggleSort(f)}
                  className={`px-3 py-2 text-xs rounded-lg border transition ${
                    sortField === f
                      ? 'bg-indigo-600 border-indigo-500 text-white'
                      : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'
                  }`}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}{' '}
                  {sortField === f && (sortDir === 'asc' ? '\u2191' : '\u2193')}
                </button>
              ))}
            </div>
          </div>

          {/* Entry List */}
          {filteredEntries.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              {entries.length === 0
                ? 'No confirmed dyeing slips with CMYK data yet. Confirm slips with photos to build your color database.'
                : 'No results match your search.'}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredEntries.map((e) => {
                const hex = e.colorHex || cmykToHex(e.colorC, e.colorM, e.colorY, e.colorK)
                return (
                  <div key={e.id} className="bg-gray-800 rounded-xl p-4 flex gap-4 items-start">
                    <ColorSwatch hex={hex} size={48} className="rounded-lg mt-1" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm truncate">
                          {e.shadeName || `Slip #${e.slipNo}`}
                        </span>
                        <span className="text-xs text-gray-500">#{e.slipNo}</span>
                        <span className="text-xs text-gray-500">{e.lotNo}</span>
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        C:{e.colorC} M:{e.colorM} Y:{e.colorY} K:{e.colorK}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {formatDate(e.dyeingDoneAt)} &middot; Cost: {formatCurrency(e.totalCost)}
                      </div>
                      {e.shadeChemicals.length > 0 && (
                        <div className="text-xs text-gray-500 mt-1 truncate">
                          {e.shadeChemicals.map((c) => `${c.name} ${c.quantity ?? ''}${c.unit}`).join(', ')}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ════════════════════ COLOR MATCH TAB ════════════════════ */}
      {activeTab === 'match' && (
        <div className="space-y-6">
          <div className="bg-gray-800 rounded-xl p-5 space-y-4">
            <h2 className="font-semibold">Find Similar Colors</h2>

            {/* Color picker + preview */}
            <div className="flex flex-col sm:flex-row gap-6">
              <div className="flex-1 space-y-3">
                <CMYKSlider label="C" value={matchC} onChange={setMatchC} color="cyan" />
                <CMYKSlider label="M" value={matchM} onChange={setMatchM} color="magenta" />
                <CMYKSlider label="Y" value={matchY} onChange={setMatchY} color="yellow" />
                <CMYKSlider label="K" value={matchK} onChange={setMatchK} color="black" />
              </div>

              <div className="flex flex-col items-center gap-2">
                <div
                  className="w-24 h-24 rounded-xl border-2 border-gray-600"
                  style={{ backgroundColor: targetHex }}
                />
                <span className="text-xs text-gray-400 font-mono">{targetHex}</span>
              </div>
            </div>

            {/* Image upload */}
            <div className="flex items-center gap-3 pt-2 border-t border-gray-700">
              <span className="text-xs text-gray-400">Or upload a sample:</span>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) handleImageUpload(f)
                  e.target.value = ''
                }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={extracting}
                className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 rounded-lg transition disabled:opacity-50"
              >
                {extracting ? 'Extracting...' : 'Upload Image'}
              </button>
            </div>
          </div>

          {/* Results */}
          {matchResults.length === 0 ? (
            <div className="text-center py-8 text-gray-500">No color data available yet.</div>
          ) : (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-400">Top 10 Matches</h3>
              {matchResults.map((e) => {
                const hex = e.colorHex || cmykToHex(e.colorC, e.colorM, e.colorY, e.colorK)
                const dLabel = deltaLabel(e.deltaE)
                return (
                  <div key={e.id} className="bg-gray-800 rounded-xl p-4 space-y-2">
                    <div className="flex items-start gap-4">
                      {/* Side-by-side swatches */}
                      <div className="flex gap-1 flex-shrink-0">
                        <div className="text-center">
                          <ColorSwatch hex={targetHex} size={36} className="rounded-lg" />
                          <span className="text-[9px] text-gray-500 block mt-0.5">Target</span>
                        </div>
                        <div className="text-center">
                          <ColorSwatch hex={hex} size={36} className="rounded-lg" />
                          <span className="text-[9px] text-gray-500 block mt-0.5">Match</span>
                        </div>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm truncate">
                            {e.shadeName || `Slip #${e.slipNo}`}
                          </span>
                          <span className={`text-xs font-medium ${dLabel.color}`}>
                            {'\u0394'}E: {e.deltaE.toFixed(1)} ({dLabel.text})
                          </span>
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          C:{e.colorC} M:{e.colorM} Y:{e.colorY} K:{e.colorK}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {formatDate(e.dyeingDoneAt)} &middot; {formatCurrency(e.totalCost)}
                        </div>
                      </div>
                    </div>

                    {/* Recipe */}
                    {e.shadeChemicals.length > 0 && (
                      <div className="border-t border-gray-700 pt-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] uppercase tracking-wider text-gray-500">Recipe</span>
                          <button
                            onClick={() => copyRecipe(e.shadeChemicals)}
                            className="text-[10px] text-indigo-400 hover:text-indigo-300"
                          >
                            Copy
                          </button>
                        </div>
                        <div className="text-xs text-gray-400 mt-1 space-y-0.5">
                          {e.shadeChemicals.map((c, i) => (
                            <div key={i}>
                              {c.name}: {c.quantity ?? '-'} {c.unit}
                              {c.cost ? ` (${formatCurrency(c.cost)})` : ''}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ════════════════════ SUGGESTIONS TAB ════════════════════ */}
      {activeTab === 'suggest' && (
        <div className="space-y-6">
          <div className="bg-gray-800 rounded-xl p-5 space-y-4">
            <h2 className="font-semibold">Cost-Effective Suggestions</h2>
            <p className="text-xs text-gray-400">
              Set your target color using the sliders, then fetch suggestions for the cheapest proven recipes.
            </p>

            <div className="flex flex-col sm:flex-row gap-6">
              <div className="flex-1 space-y-3">
                <CMYKSlider label="C" value={matchC} onChange={setMatchC} color="cyan" />
                <CMYKSlider label="M" value={matchM} onChange={setMatchM} color="magenta" />
                <CMYKSlider label="Y" value={matchY} onChange={setMatchY} color="yellow" />
                <CMYKSlider label="K" value={matchK} onChange={setMatchK} color="black" />
              </div>
              <div className="flex flex-col items-center gap-2">
                <div
                  className="w-24 h-24 rounded-xl border-2 border-gray-600"
                  style={{ backgroundColor: targetHex }}
                />
                <button
                  onClick={fetchSuggestions}
                  disabled={suggestLoading}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium transition disabled:opacity-50"
                >
                  {suggestLoading ? 'Loading...' : 'Get Suggestions'}
                </button>
              </div>
            </div>
          </div>

          {suggestLowData && (
            <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-xl p-4 text-sm text-yellow-300">
              Not enough data yet ({suggestTotal} confirmed slips). Build more data by confirming dyeing slips with photos for better suggestions. Aim for at least 10.
            </div>
          )}

          {suggestions.length > 0 && (
            <div className="space-y-3">
              {suggestions.map((s, i) => (
                <div key={i} className="bg-gray-800 rounded-xl p-4 space-y-2">
                  <div className="flex items-start gap-4">
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <span className="text-lg font-bold text-gray-500 w-6">{i + 1}</span>
                      <ColorSwatch
                        hex={cmykToHex(s.avgCMYK.C, s.avgCMYK.M, s.avgCMYK.Y, s.avgCMYK.K)}
                        size={40}
                        className="rounded-lg"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{s.shadeName}</span>
                        <span className="text-xs text-green-400 font-medium">{formatCurrency(s.avgCost)}</span>
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {'\u0394'}E: {s.avgDeltaE} &middot; Dyed {s.timesUsed} time{s.timesUsed > 1 ? 's' : ''}
                      </div>
                      {s.savings > 0 && (
                        <div className="text-xs text-green-400 mt-0.5">
                          Saves {formatCurrency(s.savings)} vs most expensive match
                        </div>
                      )}
                    </div>
                  </div>

                  {s.recipe.length > 0 && (
                    <div className="border-t border-gray-700 pt-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase tracking-wider text-gray-500">Recipe</span>
                        <button
                          onClick={() => copyRecipe(s.recipe)}
                          className="text-[10px] text-indigo-400 hover:text-indigo-300"
                        >
                          Copy
                        </button>
                      </div>
                      <div className="text-xs text-gray-400 mt-1 space-y-0.5">
                        {s.recipe.map((c, j) => (
                          <div key={j}>
                            {c.name}: {c.quantity ?? '-'} {c.unit}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {!suggestLoading && suggestions.length === 0 && suggestTotal > 0 && (
            <div className="text-center py-8 text-gray-500">
              No suggestions found for this color. Try adjusting the CMYK values.
            </div>
          )}
        </div>
      )}

      {/* ════════════════════ PREDICT TAB ════════════════════ */}
      {activeTab === 'predict' && (
        <div className="space-y-6">
          <div className="bg-gray-800 rounded-xl p-5 space-y-4">
            <h2 className="font-semibold">Predict Color from Chemicals</h2>
            <p className="text-xs text-gray-400">
              Enter chemicals and quantities to predict the approximate color based on historical data.
            </p>

            {/* Chemical inputs */}
            <div className="space-y-2">
              {predictChems.map((pc, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input
                    list="chem-names"
                    type="text"
                    placeholder="Chemical name"
                    value={pc.name}
                    onChange={(e) => {
                      const copy = [...predictChems]
                      copy[i] = { ...copy[i], name: e.target.value }
                      setPredictChems(copy)
                    }}
                    className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm"
                  />
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Qty (kg)"
                    value={pc.quantity || ''}
                    onChange={(e) => {
                      const copy = [...predictChems]
                      copy[i] = { ...copy[i], quantity: parseFloat(e.target.value) || 0 }
                      setPredictChems(copy)
                    }}
                    className="w-24 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm"
                  />
                  {predictChems.length > 1 && (
                    <button
                      onClick={() => setPredictChems(predictChems.filter((_, j) => j !== i))}
                      className="text-red-400 hover:text-red-300 text-lg px-1"
                    >
                      &times;
                    </button>
                  )}
                </div>
              ))}
              <datalist id="chem-names">
                {allChemNames.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>

              <div className="flex gap-2">
                <button
                  onClick={() => setPredictChems([...predictChems, { name: '', quantity: 0 }])}
                  className="text-xs text-indigo-400 hover:text-indigo-300"
                >
                  + Add Chemical
                </button>
              </div>
            </div>

            <button
              onClick={fetchPrediction}
              disabled={predictLoading || !predictChems.some((c) => c.name.trim())}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium transition disabled:opacity-50"
            >
              {predictLoading ? 'Predicting...' : 'Predict Color'}
            </button>
          </div>

          {/* Prediction result */}
          {prediction && (
            <div className="bg-gray-800 rounded-xl p-5 space-y-4">
              <h3 className="font-semibold text-sm">Predicted Color</h3>
              <div className="flex items-center gap-6">
                <div
                  className="w-24 h-24 rounded-xl border-2 border-gray-600"
                  style={{ backgroundColor: prediction.colorHex }}
                />
                <div>
                  <div className="text-sm font-mono">
                    C:{prediction.colorC} M:{prediction.colorM} Y:{prediction.colorY} K:{prediction.colorK}
                  </div>
                  <div className="text-xs text-gray-400 font-mono mt-1">{prediction.colorHex}</div>
                  <div className="mt-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">Confidence:</span>
                      <div className="w-32 h-2 bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            predictConfidence > 70 ? 'bg-green-500' : predictConfidence > 40 ? 'bg-yellow-500' : 'bg-red-500'
                          }`}
                          style={{ width: `${predictConfidence}%` }}
                        />
                      </div>
                      <span className="text-xs font-medium">{predictConfidence}%</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      Based on {predictMatches} similar recipe{predictMatches !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
              </div>

              {/* Reference matches */}
              {predictTopMatches.length > 0 && (
                <div className="border-t border-gray-700 pt-3">
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">Similar Historical Results</p>
                  <div className="flex flex-wrap gap-2">
                    {predictTopMatches.map((m: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 bg-gray-900 rounded-lg px-3 py-2">
                        <ColorSwatch hex={m.colorHex || cmykToHex(m.colorC, m.colorM, m.colorY, m.colorK)} size={20} />
                        <span className="text-xs">{m.shadeName}</span>
                        <span className="text-[10px] text-gray-500">({(m.score * 100).toFixed(0)}%)</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {!prediction && !predictLoading && predictMatches === 0 && predictChems.some((c) => c.name.trim()) && (
            <div className="text-center py-8 text-gray-500 text-sm">
              Click &ldquo;Predict Color&rdquo; to see results based on your chemical recipe.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
