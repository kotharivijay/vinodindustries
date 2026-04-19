'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import useSWR from 'swr'
import BackButton from '../BackButton'

const fetcher = (url: string) => fetch(url).then(r => r.json())

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}h ${m}m`
}

export default function CameraPage() {
  const [imgSrc, setImgSrc] = useState<string | null>(null)
  const [prevImgData, setPrevImgData] = useState<ImageData | null>(null)
  const [liveStatus, setLiveStatus] = useState<'loading' | 'running' | 'stopped' | 'idle' | 'error'>('loading')
  const [movement, setMovement] = useState(0)
  const [lastUpdate, setLastUpdate] = useState('')
  const [refreshRate, setRefreshRate] = useState(3)
  const [fullscreen, setFullscreen] = useState(false)
  const [checking, setChecking] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Server status + activity log
  const { data: statusData, mutate: mutateStatus } = useSWR('/api/camera/status', fetcher, {
    refreshInterval: 30000,
    revalidateOnFocus: false,
  })
  const machineStatus = statusData?.[0]

  const fetchSnapshot = useCallback(async () => {
    try {
      const res = await fetch(`/api/camera?channel=7&t=${Date.now()}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)

      const img = new Image()
      img.onload = () => {
        const canvas = canvasRef.current
        if (canvas) {
          canvas.width = img.width
          canvas.height = img.height
          const ctx = canvas.getContext('2d')
          if (ctx) {
            ctx.drawImage(img, 0, 0)
            const currentData = ctx.getImageData(0, 0, canvas.width, canvas.height)

            if (prevImgData && prevImgData.width === currentData.width) {
              let diffCount = 0
              const totalPixels = currentData.data.length / 4
              const sampleStep = 4
              for (let i = 0; i < currentData.data.length; i += 4 * sampleStep) {
                const dr = Math.abs(currentData.data[i] - prevImgData.data[i])
                const dg = Math.abs(currentData.data[i + 1] - prevImgData.data[i + 1])
                const db = Math.abs(currentData.data[i + 2] - prevImgData.data[i + 2])
                if (dr + dg + db > 30) diffCount++
              }
              const diffPercent = (diffCount / (totalPixels / sampleStep)) * 100
              setMovement(Math.round(diffPercent * 10) / 10)
              if (diffPercent > 5) setLiveStatus('running')
              else if (diffPercent > 1) setLiveStatus('idle')
              else setLiveStatus('stopped')
            } else {
              setLiveStatus('running')
            }
            setPrevImgData(currentData)
          }
        }
        if (imgSrc) URL.revokeObjectURL(imgSrc)
        setImgSrc(url)
        setLastUpdate(new Date().toLocaleTimeString('en-IN'))
      }
      img.src = url
    } catch {
      setLiveStatus('error')
    }
  }, [prevImgData, imgSrc])

  useEffect(() => {
    fetchSnapshot()
    intervalRef.current = setInterval(fetchSnapshot, refreshRate * 1000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [refreshRate]) // eslint-disable-line react-hooks/exhaustive-deps

  // Manual server-side check
  async function runCheck() {
    setChecking(true)
    try {
      await fetch('/api/camera/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 7, name: 'Farmatex Machine' }),
      })
      mutateStatus()
    } catch {}
    setChecking(false)
  }

  const statusConfig: Record<string, { color: string; bg: string; text: string; icon: string }> = {
    loading: { color: 'text-gray-500', bg: 'bg-gray-500', text: 'Loading', icon: '⏳' },
    running: { color: 'text-green-500', bg: 'bg-green-500', text: 'Running', icon: '🟢' },
    idle: { color: 'text-yellow-500', bg: 'bg-yellow-500', text: 'Idle', icon: '🟡' },
    stopped: { color: 'text-red-500', bg: 'bg-red-500', text: 'Stopped', icon: '🔴' },
    error: { color: 'text-red-700', bg: 'bg-red-700', text: 'Error', icon: '❌' },
    unknown: { color: 'text-gray-500', bg: 'bg-gray-500', text: 'Unknown', icon: '❓' },
  }

  const st = statusConfig[liveStatus] || statusConfig.unknown
  const serverSt = statusConfig[machineStatus?.status || 'unknown'] || statusConfig.unknown

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <BackButton />
          <div>
            <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Machine Camera</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Farmatex Machine · Channel 7</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold text-white ${st.bg}`}>
            {st.icon} {st.text}
          </span>
          <span className="text-[10px] text-gray-400">{lastUpdate}</span>
        </div>
      </div>

      {/* Status cards */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-3 text-center">
          <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase">Live Status</p>
          <p className={`text-lg font-bold mt-0.5 ${st.color}`}>{st.icon} {st.text}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-3 text-center">
          <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase">Movement</p>
          <p className="text-lg font-bold text-gray-800 dark:text-gray-100 mt-0.5">{movement}%</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-3 text-center">
          <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase">Uptime Today</p>
          <p className="text-lg font-bold text-emerald-600 mt-0.5">{machineStatus?.today?.uptimePercent || 0}%</p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 mb-4">
        <select value={refreshRate} onChange={e => setRefreshRate(parseInt(e.target.value))}
          className="text-xs border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200">
          <option value={2}>2s refresh</option>
          <option value={3}>3s refresh</option>
          <option value={5}>5s refresh</option>
          <option value={10}>10s refresh</option>
        </select>
        <button onClick={runCheck} disabled={checking}
          className="text-xs bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 rounded-lg font-medium disabled:opacity-50">
          {checking ? 'Checking...' : '🔍 Server Check'}
        </button>
        {machineStatus && (
          <span className="text-[10px] text-gray-400 ml-auto">
            Server: {serverSt.icon} {serverSt.text} · {movement}%
          </span>
        )}
      </div>

      {/* Live view */}
      <div className={`relative bg-black rounded-xl overflow-hidden cursor-pointer ${fullscreen ? 'fixed inset-0 z-50 rounded-none' : ''}`}
        onClick={() => setFullscreen(!fullscreen)}>
        {imgSrc ? (
          <img src={imgSrc} alt="Farmatex Machine" className="w-full h-auto" />
        ) : (
          <div className="w-full aspect-video flex items-center justify-center text-gray-500">Loading...</div>
        )}
        <div className="absolute top-3 left-3 flex items-center gap-2">
          <span className={`w-3 h-3 rounded-full ${st.bg} animate-pulse`} />
          <span className="text-xs text-white bg-black/60 px-2 py-0.5 rounded">Farmatex Machine</span>
        </div>
        <div className="absolute top-3 right-3 text-xs text-white bg-black/60 px-2 py-0.5 rounded">{lastUpdate}</div>
        <div className="absolute bottom-3 left-3 text-xs text-white bg-black/60 px-2 py-0.5 rounded">Motion: {movement}%</div>
        {fullscreen && (
          <button onClick={e => { e.stopPropagation(); setFullscreen(false) }}
            className="absolute bottom-3 right-3 text-white bg-black/60 px-3 py-1.5 rounded text-xs">✕ Close</button>
        )}
      </div>

      {/* Motion bar */}
      <div className="mt-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Motion Level</span>
          <span className="text-xs text-gray-500">{movement}%</span>
        </div>
        <div className="w-full h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all duration-500 ${movement > 5 ? 'bg-green-500' : movement > 1 ? 'bg-yellow-500' : 'bg-red-500'}`}
            style={{ width: `${Math.min(100, movement * 2)}%` }} />
        </div>
        <div className="flex justify-between mt-1 text-[9px] text-gray-400">
          <span>🔴 Stopped</span><span>🟡 Idle</span><span>🟢 Running</span>
        </div>
      </div>

      {/* Today's Activity Timeline */}
      {machineStatus?.today?.logs?.length > 0 && (
        <div className="mt-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100">Today&apos;s Activity</h3>
            <span className="text-[10px] text-gray-400">{machineStatus.today.eventCount} events</span>
          </div>
          <div className="space-y-2">
            {machineStatus.today.logs.map((log: any, i: number) => (
              <div key={i} className="flex items-center gap-3 text-xs">
                <span className="text-gray-400 w-16">{new Date(log.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
                <span className={`w-2 h-2 rounded-full ${log.event === 'started' ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className={`font-medium ${log.event === 'started' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                  {log.event === 'started' ? 'Started' : 'Stopped'}
                </span>
                {log.duration && (
                  <span className="text-gray-400">({formatDuration(log.duration)})</span>
                )}
              </div>
            ))}
          </div>

          {/* Summary */}
          <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-[10px] text-gray-500 uppercase">Running</p>
              <p className="text-sm font-bold text-green-600">{formatDuration(machineStatus.today.runningSeconds)}</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-500 uppercase">Stopped</p>
              <p className="text-sm font-bold text-red-600">{formatDuration(machineStatus.today.stoppedSeconds)}</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-500 uppercase">Uptime</p>
              <p className="text-sm font-bold text-emerald-600">{machineStatus.today.uptimePercent}%</p>
            </div>
          </div>
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />
    </div>
  )
}
