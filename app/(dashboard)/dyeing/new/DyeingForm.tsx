'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'

// ─── Types ────────────────────────────────────────────────────────────────────

type StockStatus = 'idle' | 'loading' | 'ok' | 'no_stock' | 'not_found'

interface ChemicalMaster { id: number; name: string; unit: string; currentPrice: number | null }

interface DyeingProcessItem { chemicalId: number; quantity: number; quantityHigh?: number | null; chemical: { id: number; name: string; unit: string } }
interface DyeingProcess { id: number; name: string; description?: string; threshold?: number; items: DyeingProcessItem[] }

interface ChemicalRow {
  name: string
  chemicalId: number | null
  quantity: string
  unit: string
  rate: string
  cost: number | null
  matched: boolean
  processTag: string | null
}

interface MachineOption { id: number; number: number; name: string; isActive: boolean }
interface OperatorOption { id: number; name: string; mobileNo: string | null; isActive: boolean }
interface ShadeWithRecipe { id: number; name: string; description?: string | null; recipeItems: { chemicalId: number; quantity: number; chemical: { id: number; name: string; unit: string } }[] }

// ─── Image Zoom Modal ─────────────────────────────────────────────────────────

function ZoomModal({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-2"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-white text-3xl leading-none z-10"
      >&times;</button>
      <img
        src={src}
        alt="Dyeing slip"
        className="max-w-full max-h-full object-contain rounded-lg"
        onClick={e => e.stopPropagation()}
        style={{ touchAction: 'pinch-zoom' }}
      />
    </div>
  )
}

// ─── Main Form ────────────────────────────────────────────────────────────────

// ─── Queue Types ──────────────────────────────────────────────────────────────

type QueueStatus = 'pending' | 'active' | 'saved' | 'skipped'

interface QueueItem {
  id: number
  preview: string
  base64: string
  type: string
  status: QueueStatus
  _draftItemId?: number
}

export default function DyeingForm() {
  const router = useRouter()

  // Queue state
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [activeIdx, setActiveIdx] = useState<number>(-1)
  const queueIdRef = useRef(0)

  // Draft queue state (cloud save)
  const [draftBatchId, setDraftBatchId] = useState<number | null>(null)
  const [showResume, setShowResume] = useState(false)
  const [pendingDraftCount, setPendingDraftCount] = useState(0)
  const [uploadingDrafts, setUploadingDrafts] = useState(false)

  // Image state
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [imageBase64, setImageBase64] = useState<string | null>(null)
  const [imageType, setImageType] = useState<string>('image/jpeg')
  const [showZoom, setShowZoom] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)

  // Voice note state
  const [voiceText, setVoiceText] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [speechSupported, setSpeechSupported] = useState(false)
  const recognitionRef = useRef<any>(null)

  // Voice command mode
  const [commandMode, setCommandMode] = useState(false)
  const [cmdToast, setCmdToast] = useState<string | null>(null)
  const cmdRecognitionRef = useRef<any>(null)
  const cmdDebounceRef = useRef<Record<string, number>>({})
  const cmdToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const commandModeRef = useRef(false) // stable ref for callbacks

  // Floating bubble drag state
  const [bubblePos, setBubblePos] = useState<{ x: number; y: number } | null>(null)
  const bubbleDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number; dragging: boolean } | null>(null)

  // Extraction state
  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState('')
  const [extracted, setExtracted] = useState(false)

  // Marka entries (lot + than pairs)
  interface MarkaEntry { lotNo: string; than: string; stockStatus: StockStatus; stockInfo: { stock: number; greyThan: number; despatchThan: number } | null }
  const [markaEntries, setMarkaEntries] = useState<MarkaEntry[]>([{ lotNo: '', than: '', stockStatus: 'idle', stockInfo: null }])

  // Available lots for searchable dropdown
  const [availableLots, setAvailableLots] = useState<{ lotNo: string; greyThan: number; despatchThan: number; stock: number; quality: string }[]>([])
  const [lotDropIdx, setLotDropIdx] = useState<number | null>(null)
  const [lotSearch, setLotSearch] = useState('')

  // Form state
  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0],
    slipNo: '',
    lotNo: '',
    than: '',
    notes: '',
  })

  // Chemicals state
  const [chemicals, setChemicals] = useState<ChemicalRow[]>([])
  const [masterChemicals, setMasterChemicals] = useState<ChemicalMaster[]>([])
  const [masterShadeNames, setMasterShadeNames] = useState<string[]>([])
  const [ocrNames, setOcrNames] = useState<string[]>([])  // original OCR names for alias learning
  const [processes, setProcesses] = useState<DyeingProcess[]>([])
  const [showPresets, setShowPresets] = useState(false)

  // Chemical Tags (voice note shortcuts stored in localStorage)
  const [tags, setTags] = useState<{ tag: string; chemical: string }[]>([])
  const [showTagPanel, setShowTagPanel] = useState(false)
  const [newTag, setNewTag] = useState('')
  const [newTagChem, setNewTagChem] = useState('')
  const [cloudSaved, setCloudSaved] = useState(false)

  // Machine & Operator
  const [machines, setMachines] = useState<MachineOption[]>([])
  const [operators, setOperators] = useState<OperatorOption[]>([])
  const [selectedMachineId, setSelectedMachineId] = useState<number | null>(null)
  const [selectedOperatorId, setSelectedOperatorId] = useState<number | null>(null)

  // Shade reference saved on the slip
  const [shadeName, setShadeName] = useState('')
  const [shadesWithRecipe, setShadesWithRecipe] = useState<ShadeWithRecipe[]>([])
  const [selectedShadeId, setSelectedShadeId] = useState<number | null>(null)
  const [shadeDropOpen, setShadeDropOpen] = useState(false)
  const [shadeSearch, setShadeSearch] = useState('')

  // Process buttons - track which processes are added
  const [addedProcesses, setAddedProcesses] = useState<Set<number>>(new Set())
  const [processPopup, setProcessPopup] = useState<{ process: DyeingProcess; batchWeight?: number; items: { chemicalId: number; name: string; unit: string; quantity: string }[] } | null>(null)

  // Save to Shade Master
  const [showSaveShade, setShowSaveShade] = useState(false)
  const [shadeNameInput, setShadeNameInput] = useState('')
  const [shadeDescInput, setShadeDescInput] = useState('')
  const [lotWeights, setLotWeights] = useState<{ lotNo: string; weightPerThan: number; kgPerMtr: number; grayMtr: number; quality: string }[]>([])
  const [loadingWeights, setLoadingWeights] = useState(false)
  const [savingShade, setSavingShade] = useState(false)
  const [shadeError, setShadeError] = useState('')
  const [shadeSaved, setShadeSaved] = useState(false)

  // Lot stock check
  const [stockStatus, setStockStatus] = useState<StockStatus>('idle')
  const [stockInfo, setStockInfo] = useState<{ stock: number; greyThan: number; despatchThan: number } | null>(null)

  // Chemical dropdown state
  const [chemDropIdx, setChemDropIdx] = useState<number | null>(null)
  const [chemSearch, setChemSearch] = useState('')

  // Save state
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Load chemical master + processes + tags on mount
  useEffect(() => {
    fetch('/api/chemicals')
      .then(r => r.json())
      .then(d => setMasterChemicals(Array.isArray(d) ? d : []))
      .catch(() => {})
    fetch('/api/shades')
      .then(r => r.json())
      .then(d => {
        const arr = Array.isArray(d) ? d : []
        setMasterShadeNames(arr.map((s: any) => s.name))
        setShadesWithRecipe(arr)
      })
      .catch(() => {})
    fetch('/api/dyeing/machines')
      .then(r => r.json())
      .then(d => setMachines(Array.isArray(d) ? d.filter((m: any) => m.isActive) : []))
      .catch(() => {})
    fetch('/api/dyeing/operators?active=true')
      .then(r => r.json())
      .then(d => setOperators(Array.isArray(d) ? d : []))
      .catch(() => {})
    fetch('/api/dyeing/processes')
      .then(r => r.json())
      .then(d => setProcesses(Array.isArray(d) ? d : []))
      .catch(() => {})
    try {
      const stored = localStorage.getItem('vi_chem_tags')
      if (stored) setTags(JSON.parse(stored))
    } catch {}
  }, [])

  // Save tags to localStorage on change
  useEffect(() => {
    try { localStorage.setItem('vi_chem_tags', JSON.stringify(tags)) } catch {}
  }, [tags])

  // Load available lots on mount
  useEffect(() => {
    fetch('/api/grey/lots').then(r => r.json()).then(d => setAvailableLots(Array.isArray(d) ? d : [])).catch(() => {})
  }, [])

  // Check speech recognition support
  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    setSpeechSupported(!!SR)
  }, [])

  // Load bubble position from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('vi_bubble_pos')
      if (saved) setBubblePos(JSON.parse(saved))
      else setBubblePos({ x: window.innerWidth - 80, y: window.innerHeight - 160 })
    } catch {
      setBubblePos({ x: window.innerWidth - 80, y: window.innerHeight - 160 })
    }
  }, [])

  // Cleanup command mode on unmount
  useEffect(() => {
    return () => {
      commandModeRef.current = false
      try { cmdRecognitionRef.current?.stop() } catch {}
      if (cmdToastTimerRef.current) clearTimeout(cmdToastTimerRef.current)
    }
  }, [])

  // Check for existing draft batch on mount
  useEffect(() => {
    fetch('/api/dyeing/drafts')
      .then(r => r.json())
      .then(batch => {
        if (batch?.id && batch.items?.length) {
          const pending = batch.items.filter((i: any) => i.status === 'pending').length
          if (pending > 0) {
            setDraftBatchId(batch.id)
            setPendingDraftCount(pending)
            setShowResume(true)
          }
        }
      })
      .catch(() => {})
  }, [])

  // ─── Image Handling ────────────────────────────────────────────────────────

  function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return
    const fileArr = Array.from(files)
    e.target.value = '' // reset input

    // Read all files first
    const readAll = fileArr.map(file => new Promise<{ preview: string; base64: string; type: string }>(resolve => {
      const type = file.type || 'image/jpeg'
      const reader = new FileReader()
      reader.onload = ev => {
        const result = ev.target?.result as string
        resolve({ preview: result, base64: result.split(',')[1], type })
      }
      reader.readAsDataURL(file)
    }))

    Promise.all(readAll).then(results => {
      // Single file + no existing queue → simple mode (no queue panel)
      if (results.length === 1 && queue.length === 0) {
        const r = results[0]
        setImagePreview(r.preview)
        setImageBase64(r.base64)
        setImageType(r.type)
        setExtracted(false)
        setExtractError('')
        return
      }

      // Multiple files OR adding to existing queue → queue mode
      const newItems: QueueItem[] = results.map(r => {
        queueIdRef.current += 1
        return { id: queueIdRef.current, preview: r.preview, base64: r.base64, type: r.type, status: 'pending' as QueueStatus }
      })

      setQueue(prev => {
        const combined = [...prev, ...newItems]
        const hasActive = combined.some(q => q.status === 'active')
        if (!hasActive) {
          const firstPending = combined.findIndex(q => q.status === 'pending')
          if (firstPending >= 0) {
            combined[firstPending].status = 'active'
            // Load first item outside of setState
            const item = combined[firstPending]
            setTimeout(() => {
              setImagePreview(item.preview)
              setImageBase64(item.base64)
              setImageType(item.type)
              setExtracted(false)
              setExtractError('')
              setVoiceText('')
              setOcrNames([])
              setChemicals([])
              setShadeName('')
              setMarkaEntries([{ lotNo: '', than: '', stockStatus: 'idle', stockInfo: null }])
              setForm({ date: new Date().toISOString().split('T')[0], slipNo: '', lotNo: '', than: '', notes: '' })
              setStockStatus('idle')
              setStockInfo(null)
              setError('')
              setActiveIdx(firstPending)
            }, 0)
          }
        }
        return combined
      })

      // Upload to cloud as draft
      setUploadingDrafts(true)
      fetch('/api/dyeing/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          images: results.map(r => ({ base64: r.base64, mediaType: r.type })),
        }),
      })
        .then(r => r.json())
        .then(batch => {
          if (batch?.id) {
            setDraftBatchId(batch.id)
            setCloudSaved(true)
            // Map draft item IDs to queue items
            setQueue(prev => prev.map((q, idx) => {
              const draftItem = batch.items?.[idx]
              return draftItem ? { ...q, _draftItemId: draftItem.id } : q
            }))
          }
        })
        .catch(() => {})
        .finally(() => setUploadingDrafts(false))
    })
  }

  function loadQueueItem(item: QueueItem) {
    setImagePreview(item.preview)
    setImageBase64(item.base64)
    setImageType(item.type)
    setExtracted(false)
    setExtractError('')
    setVoiceText('')
    setOcrNames([])
    setChemicals([])
    setMarkaEntries([{ lotNo: '', than: '', stockStatus: 'idle', stockInfo: null }])
    setForm({ date: new Date().toISOString().split('T')[0], slipNo: '', lotNo: '', than: '', notes: '' })
    setStockStatus('idle')
    setStockInfo(null)
    setError('')
  }

  async function loadDraftItem(item: QueueItem) {
    // Reset form
    setExtracted(false)
    setExtractError('')
    setVoiceText('')
    setOcrNames([])
    setChemicals([])
    setMarkaEntries([{ lotNo: '', than: '', stockStatus: 'idle', stockInfo: null }])
    setForm({ date: new Date().toISOString().split('T')[0], slipNo: '', lotNo: '', than: '', notes: '' })
    setStockStatus('idle')
    setStockInfo(null)
    setError('')

    // If we have base64 already, use it
    if (item.base64) {
      setImagePreview(item.preview.startsWith('data:') ? item.preview : `data:${item.type};base64,${item.base64}`)
      setImageBase64(item.base64)
      setImageType(item.type)
      return
    }

    // Fetch image from DB via API
    if (item._draftItemId) {
      try {
        const res = await fetch(`/api/dyeing/drafts/${item._draftItemId}`)
        const data = await res.json()
        if (data.imageBase64) {
          const preview = `data:${data.mediaType};base64,${data.imageBase64}`
          setImagePreview(preview)
          setImageBase64(data.imageBase64)
          setImageType(data.mediaType)
          // Cache in queue item
          item.base64 = data.imageBase64
          item.preview = preview
        }
      } catch {
        setError('Failed to load draft image')
      }
    }
  }

  function jumpToQueueItem(idx: number) {
    if (queue[idx].status === 'saved' || queue[idx].status === 'skipped') return
    setQueue(prev => {
      const updated = [...prev]
      // Mark current active as pending
      const curActive = updated.findIndex(q => q.status === 'active')
      if (curActive >= 0) updated[curActive].status = 'pending'
      updated[idx].status = 'active'
      return updated
    })
    setActiveIdx(idx)
    if (queue[idx]._draftItemId && !queue[idx].base64) {
      loadDraftItem(queue[idx])
    } else {
      loadQueueItem(queue[idx])
    }
  }

  function advanceQueue() {
    setQueue(prev => {
      const updated = [...prev]
      if (activeIdx >= 0 && activeIdx < updated.length) {
        updated[activeIdx].status = 'saved'
        // Mark draft item as saved in cloud
        const draftId = updated[activeIdx]._draftItemId
        if (draftId) {
          fetch(`/api/dyeing/drafts/${draftId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'saved' }),
          }).catch(() => {})
        }
      }
      const nextIdx = updated.findIndex(q => q.status === 'pending')
      if (nextIdx >= 0) {
        updated[nextIdx].status = 'active'
        const item = updated[nextIdx]
        setTimeout(() => {
          if (item._draftItemId && !item.base64) {
            loadDraftItem(item)
          } else {
            loadQueueItem(item)
          }
          setActiveIdx(nextIdx)
        }, 0)
      } else {
        setTimeout(() => setActiveIdx(-1), 0)
      }
      return updated
    })
  }

  function skipQueueItem() {
    setQueue(prev => {
      const updated = [...prev]
      if (activeIdx >= 0) {
        updated[activeIdx].status = 'skipped'
        const draftId = updated[activeIdx]._draftItemId
        if (draftId) {
          fetch(`/api/dyeing/drafts/${draftId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'skipped' }),
          }).catch(() => {})
        }
      }
      const nextIdx = updated.findIndex(q => q.status === 'pending')
      if (nextIdx >= 0) {
        updated[nextIdx].status = 'active'
        const item = updated[nextIdx]
        setTimeout(() => {
          if (item._draftItemId && !item.base64) {
            loadDraftItem(item)
          } else {
            loadQueueItem(item)
          }
          setActiveIdx(nextIdx)
        }, 0)
      } else {
        setTimeout(() => setActiveIdx(-1), 0)
      }
      return updated
    })
  }

  async function resumeDraft() {
    setShowResume(false)
    const res = await fetch('/api/dyeing/drafts')
    const batch = await res.json()
    if (!batch?.items?.length) return

    setDraftBatchId(batch.id)

    // Convert draft items to queue items (no image data yet — fetched on demand)
    const items: QueueItem[] = batch.items.map((item: any) => {
      queueIdRef.current += 1
      return {
        id: queueIdRef.current,
        preview: '', // will be loaded from DB
        base64: '',
        type: item.mediaType,
        status: item.status === 'saved' ? 'saved' as QueueStatus : item.status === 'skipped' ? 'skipped' as QueueStatus : 'pending' as QueueStatus,
        _draftItemId: item.id,
      }
    })

    setQueue(items)

    // Load first pending item from DB
    const firstPending = items.findIndex(q => q.status === 'pending')
    if (firstPending >= 0) {
      items[firstPending].status = 'active'
      setActiveIdx(firstPending)
      await loadDraftItem(items[firstPending])
    }
  }

  async function discardDraft() {
    setShowResume(false)
    await fetch('/api/dyeing/drafts', { method: 'DELETE' })
    setDraftBatchId(null)
  }

  // ─── Voice Note ────────────────────────────────────────────────────────────

  function toggleRecording() {
    if (!speechSupported) return
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition

    if (isRecording) {
      if (recognitionRef.current) recognitionRef.current._active = false
      recognitionRef.current?.stop()
      setIsRecording(false)
      return
    }

    const recognition = new SR()
    recognition.lang = 'en-IN'
    recognition.continuous = false   // Single utterance per session — avoids overlap duplication
    recognition.interimResults = false

    recognition.onresult = (e: any) => {
      const transcript = e.results[0]?.[0]?.transcript?.trim()
      if (!transcript) return

      setVoiceText(prev => {
        if (!prev) return transcript
        // Deduplicate: check if last few words of prev overlap with start of new text
        const prevWords = prev.trim().split(/\s+/)
        const newWords = transcript.split(/\s+/)
        // Check overlap of 1-3 trailing words
        for (let overlap = Math.min(3, prevWords.length, newWords.length); overlap > 0; overlap--) {
          const tail = prevWords.slice(-overlap).join(' ').toLowerCase()
          const head = newWords.slice(0, overlap).join(' ').toLowerCase()
          if (tail === head) {
            // Remove overlapping words from new text
            return prev.trimEnd() + ' ' + newWords.slice(overlap).join(' ')
          }
        }
        return prev.trimEnd() + ' ' + transcript
      })
    }
    recognition.onend = () => {
      // Auto-restart for next utterance if user hasn't manually stopped
      if (recognitionRef.current?._active) {
        try { recognition.start() } catch { setIsRecording(false) }
      } else {
        setIsRecording(false)
      }
    }
    recognition.onerror = (e: any) => {
      if (e.error !== 'aborted' && e.error !== 'no-speech') {
        recognitionRef.current._active = false
        setIsRecording(false)
      }
    }

    recognition._active = true
    recognitionRef.current = recognition
    recognition.start()
    setIsRecording(true)
  }

  // ─── Voice Command Mode ────────────────────────────────────────────────────

  function showCmdToast(msg: string) {
    setCmdToast(msg)
    if (cmdToastTimerRef.current) clearTimeout(cmdToastTimerRef.current)
    cmdToastTimerRef.current = setTimeout(() => setCmdToast(null), 2500)
  }

  function canFire(cmd: string, cooldownMs = 1500): boolean {
    const now = Date.now()
    const last = cmdDebounceRef.current[cmd] ?? 0
    if (now - last < cooldownMs) return false
    cmdDebounceRef.current[cmd] = now
    return true
  }

  // Stable refs so recognition callbacks always see latest state
  const setShowZoomRef = useRef(setShowZoom)
  setShowZoomRef.current = setShowZoom
  const imagePreviewRef = useRef<string | null>(null)
  imagePreviewRef.current = imagePreview

  function handleVoiceCommand(transcript: string) {
    const t = transcript.toLowerCase().trim()

    // "slip" / "show" / "image" / "open" → open slip zoom
    if (/\b(slip|show|image|open|photo)\b/.test(t)) {
      if (canFire('open') && imagePreviewRef.current) {
        setShowZoomRef.current(true)
        showCmdToast('🎙 "slip" → opened image')
      }
      return
    }

    // "close" / "back" / "hide" → close zoom
    if (/\b(close|back|hide|done)\b/.test(t)) {
      if (canFire('close')) {
        setShowZoomRef.current(false)
        showCmdToast('🎙 "close" → closed image')
      }
      return
    }

    // "next" → advance queue
    if (/\bnext\b/.test(t)) {
      if (canFire('next')) {
        showCmdToast('🎙 "next" → advancing...')
        advanceQueue()
      }
      return
    }

    // "skip" → skip current
    if (/\bskip\b/.test(t)) {
      if (canFire('skip')) {
        showCmdToast('🎙 "skip" → skipping...')
        skipQueueItem()
      }
      return
    }

    // "extract" / "scan" → AI extract
    if (/\b(extract|scan|read)\b/.test(t)) {
      if (canFire('extract') && imageBase64) {
        showCmdToast('🎙 "extract" → running AI...')
        handleExtract()
      }
      return
    }
  }

  function startCommandMode() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) return

    // Stop voice note if running
    if (isRecording) {
      recognitionRef.current?._active && (recognitionRef.current._active = false)
      recognitionRef.current?.stop()
      setIsRecording(false)
    }

    const recognition = new SR()
    recognition.lang = 'en-IN'
    recognition.continuous = true
    recognition.interimResults = true

    recognition.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const transcript = e.results[i][0]?.transcript ?? ''
        if (transcript.trim()) handleVoiceCommand(transcript)
      }
    }

    recognition.onend = () => {
      // Auto-restart while command mode is still active
      if (commandModeRef.current) {
        try { recognition.start() } catch { /* already started */ }
      }
    }

    recognition.onerror = (e: any) => {
      if (e.error === 'not-allowed') {
        setCommandMode(false)
        commandModeRef.current = false
      }
    }

    cmdRecognitionRef.current = recognition
    recognition.start()
    setCommandMode(true)
    commandModeRef.current = true
    showCmdToast('🎙 Command mode ON — say "slip", "close", "next"...')
  }

  function stopCommandMode() {
    commandModeRef.current = false
    setCommandMode(false)
    try { cmdRecognitionRef.current?.stop() } catch {}
    cmdRecognitionRef.current = null
    showCmdToast('🎙 Command mode OFF')
  }

  function toggleCommandMode() {
    if (commandMode) stopCommandMode()
    else startCommandMode()
  }

  // ─── OCR / AI Extraction ──────────────────────────────────────────────────

  // Levenshtein distance for fuzzy matching
  function levenshtein(a: string, b: string): number {
    const m = a.length, n = b.length
    const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
      Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
    )
    for (let i = 1; i <= m; i++)
      for (let j = 1; j <= n; j++)
        dp[i][j] = a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    return dp[m][n]
  }

  function similarity(a: string, b: string): number {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
    const na = norm(a), nb = norm(b)
    if (!na || !nb) return 0
    const maxLen = Math.max(na.length, nb.length)
    return 1 - levenshtein(na, nb) / maxLen
  }

  function matchToMaster(name: string): { chemicalId: number | null; rate: string; matchedName: string } {
    if (!name.trim() || masterChemicals.length === 0) return { chemicalId: null, rate: '', matchedName: '' }

    const norm = (s: string) => s.toLowerCase().trim()

    // Exact match only — fuzzy matching disabled
    const exact = masterChemicals.find(c => norm(c.name) === norm(name))
    if (exact) return { chemicalId: exact.id, rate: exact.currentPrice?.toString() ?? '', matchedName: exact.name }

    return { chemicalId: null, rate: '', matchedName: '' }
  }

  function applyTags(text: string): string {
    let result = text
    for (const { tag, chemical } of tags) {
      if (!tag.trim() || !chemical.trim()) continue
      const re = new RegExp(`\\b${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')
      result = result.replace(re, chemical)
    }
    return result
  }

  async function handleExtract() {
    if (!imageBase64) return
    setExtracting(true); setExtractError('')

    const tagMap: Record<string, string> = {}
    for (const { tag, chemical } of tags) {
      if (tag.trim() && chemical.trim()) tagMap[tag.toLowerCase()] = chemical
    }

    const processedVoice = voiceText ? applyTags(voiceText) : null

    const res = await fetch('/api/dyeing/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64, mediaType: imageType, voiceNote: processedVoice || null, tags: Object.keys(tagMap).length > 0 ? tagMap : undefined }),
    })

    const data = await res.json()
    if (!res.ok) {
      setExtractError(data.error ?? 'Extraction failed')
      setExtracting(false)
      return
    }

    // Auto-fill form fields
    setForm(prev => ({
      date: data.date
        ? (() => {
            const [d, m, y] = data.date.split('/')
            return `${y}-${m?.padStart(2, '0')}-${d?.padStart(2, '0')}`
          })()
        : prev.date,
      slipNo: data.slipNo ?? prev.slipNo,
      lotNo: data.lotNo ? formatLotNo(data.lotNo) : prev.lotNo,
      than: data.than?.toString() ?? prev.than,
      notes: data.notes ?? prev.notes,
    }))

    // Populate marka entries from AI response
    if (data.marka?.length) {
      const entries = data.marka.map((m: any) => ({
        lotNo: formatLotNo(m.lotNo || ''),
        than: m.than?.toString() ?? '',
        stockStatus: 'idle' as StockStatus,
        stockInfo: null,
      }))
      setMarkaEntries(entries)
      // Check stock for each marka lot
      entries.forEach((_: any, idx: number) => {
        if (data.marka[idx].lotNo) {
          setTimeout(() => checkMarkaStock(idx), idx * 200)
        }
      })
    } else if (data.lotNo) {
      setMarkaEntries([{ lotNo: formatLotNo(data.lotNo), than: data.than?.toString() ?? '', stockStatus: 'idle', stockInfo: null }])
      checkLotStock(data.lotNo)
    }

    // Save original OCR names for alias learning
    if (data.ocrNames?.length) setOcrNames(data.ocrNames)

    // Build chemical rows — use alias matches from server, then try local exact match
    if (data.chemicals?.length) {
      const rows: ChemicalRow[] = data.chemicals.map((c: any) => {
        // If server found an alias match, use it
        let chemicalId = c._matchedId ?? null
        let rate = c._matchedRate != null ? String(c._matchedRate) : ''
        let displayName = c.name

        // If no alias match, try local exact match
        if (!chemicalId) {
          const local = matchToMaster(c.name)
          chemicalId = local.chemicalId
          rate = local.rate
          displayName = local.matchedName || c.name
        }

        const qty = c.quantity != null ? String(c.quantity) : ''
        const rateNum = parseFloat(rate)
        const qtyNum = parseFloat(qty)
        const cost = !isNaN(rateNum) && !isNaN(qtyNum) ? parseFloat((rateNum * qtyNum).toFixed(2)) : null
        return {
          name: displayName,
          chemicalId,
          quantity: qty,
          unit: c.unit || 'kg',
          rate,
          cost,
          matched: chemicalId !== null,
          processTag: null,
        }
      })
      setChemicals(rows)

      // Auto-learn tags: if OCR name differs from matched master name, save as tag
      const autoTags: { tag: string; chemical: string }[] = []
      rows.forEach((row, i) => {
        if (!row.chemicalId) return
        const ocr = (data.ocrNames?.[i] ?? '').trim()
        if (!ocr || ocr.toLowerCase() === row.name.toLowerCase()) return
        autoTags.push({ tag: ocr, chemical: row.name })
      })
      if (autoTags.length > 0) {
        setTags(prev => {
          const updated = [...prev]
          for (const at of autoTags) {
            const exists = updated.some(t => t.tag.toLowerCase() === at.tag.toLowerCase())
            if (!exists) updated.push(at)
          }
          return updated
        })
      }
    }

    setExtracted(true)
    setExtracting(false)

    // Show confidence warning
    if (data.confidence === 'low') {
      setExtractError('⚠ Low confidence — image may be unclear. Please verify all fields.')
    }
  }

  // ─── Lot Stock Check ──────────────────────────────────────────────────────

  const checkLotStock = useCallback(async (lot: string) => {
    if (!lot.trim()) return
    setStockStatus('loading')
    const res = await fetch(`/api/grey/stock?lotNo=${encodeURIComponent(lot.trim())}`)
    const data = await res.json()
    if (!data.exists) { setStockStatus('not_found'); setStockInfo(null) }
    else if (data.stock <= 0) { setStockStatus('no_stock'); setStockInfo(data) }
    else { setStockStatus('ok'); setStockInfo(data) }
  }, [])

  // Lot No format: ALPHA-NUMERIC e.g. PS-1325, AJ-325
  function formatLotNo(raw: string): string {
    let val = raw.toUpperCase().replace(/\s/g, '')
    val = val.replace(/^([A-Z]+)(\d+)$/, '$1-$2')
    return val
  }

  const lotNoValid = !form.lotNo || /^[A-Z]+-\d+$/i.test(form.lotNo)

  function handleLotChange(val: string) {
    const formatted = formatLotNo(val)
    setForm(prev => ({ ...prev, lotNo: formatted }))
    setStockStatus('idle'); setStockInfo(null)
  }

  // ─── Marka Entries ──────────────────────────────────────────────────────

  function updateMarka(i: number, field: 'lotNo' | 'than', value: string) {
    setMarkaEntries(prev => {
      const updated = [...prev]
      if (field === 'lotNo') {
        updated[i] = { ...updated[i], lotNo: formatLotNo(value), stockStatus: 'idle', stockInfo: null }
      } else {
        updated[i] = { ...updated[i], than: value }
      }
      return updated
    })
  }

  async function checkMarkaStock(i: number) {
    const lot = markaEntries[i]?.lotNo?.trim()
    if (!lot) return
    setMarkaEntries(prev => {
      const updated = [...prev]
      updated[i] = { ...updated[i], stockStatus: 'loading' }
      return updated
    })
    const res = await fetch(`/api/grey/stock?lotNo=${encodeURIComponent(lot)}`)
    const data = await res.json()
    setMarkaEntries(prev => {
      const updated = [...prev]
      if (!data.exists) updated[i] = { ...updated[i], stockStatus: 'not_found', stockInfo: null }
      else if (data.stock <= 0) updated[i] = { ...updated[i], stockStatus: 'no_stock', stockInfo: data }
      else updated[i] = { ...updated[i], stockStatus: 'ok', stockInfo: data }
      return updated
    })
  }

  function addMarkaEntry() {
    setMarkaEntries(prev => [...prev, { lotNo: '', than: '', stockStatus: 'idle', stockInfo: null }])
  }

  function removeMarkaEntry(i: number) {
    setMarkaEntries(prev => prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i))
  }

  function selectLot(markaIdx: number, lot: { lotNo: string; greyThan: number; despatchThan: number; stock: number }) {
    setMarkaEntries(prev => {
      const updated = [...prev]
      updated[markaIdx] = {
        ...updated[markaIdx],
        lotNo: lot.lotNo,
        stockStatus: lot.stock > 0 ? 'ok' : 'no_stock',
        stockInfo: { stock: lot.stock, greyThan: lot.greyThan, despatchThan: lot.despatchThan },
      }
      return updated
    })
    setLotDropIdx(null)
    setLotSearch('')
  }

  const markaLotValid = (lot: string) => !lot || /^[A-Z]+-\d+$/i.test(lot)

  // ─── Chemical Row Editing ─────────────────────────────────────────────────

  function updateChemical(i: number, field: keyof ChemicalRow, value: string) {
    setChemicals(prev => {
      const updated = [...prev]
      updated[i] = { ...updated[i], [field]: value }

      // Re-run fuzzy match when name changes
      if (field === 'name') {
        const { chemicalId, rate, matchedName } = matchToMaster(value)
        updated[i].chemicalId = chemicalId
        updated[i].matched = chemicalId !== null
        if (chemicalId !== null && rate) updated[i].rate = rate
      }

      // Recalculate cost
      const qty = parseFloat(field === 'quantity' ? value : updated[i].quantity)
      const rate = parseFloat(field === 'rate' ? value : updated[i].rate)
      updated[i].cost = !isNaN(qty) && !isNaN(rate) ? parseFloat((qty * rate).toFixed(2)) : null
      return updated
    })
  }

  function selectMasterChemical(i: number, master: ChemicalMaster) {
    setChemicals(prev => {
      const updated = [...prev]
      updated[i] = {
        ...updated[i],
        name: master.name,
        chemicalId: master.id,
        matched: true,
        rate: master.currentPrice?.toString() ?? updated[i].rate,
      }
      const qty = parseFloat(updated[i].quantity)
      const rate = parseFloat(updated[i].rate)
      updated[i].cost = !isNaN(qty) && !isNaN(rate) ? parseFloat((qty * rate).toFixed(2)) : null
      return updated
    })
    setChemDropIdx(null)
    setChemSearch('')
  }

  function addChemicalRow() {
    setChemicals(prev => [...prev, { name: '', chemicalId: null, quantity: '', unit: 'kg', rate: '', cost: null, matched: false, processTag: null }])
  }

  function removeChemical(i: number) {
    setChemicals(prev => prev.filter((_, idx) => idx !== i))
  }

  function applyPreset(process: DyeingProcess) {
    const threshold = process.threshold ?? 220
    const batchWeight = calcBatchWeight()
    const useHigh = batchWeight > threshold
    const rows: ChemicalRow[] = process.items.map(item => {
      const master = masterChemicals.find(m => m.id === item.chemicalId)
      const rate = master?.currentPrice?.toString() ?? ''
      const qty = String(useHigh && item.quantityHigh != null ? item.quantityHigh : item.quantity)
      const rateNum = parseFloat(rate)
      const qtyNum = parseFloat(qty)
      const cost = !isNaN(rateNum) && !isNaN(qtyNum) ? parseFloat((rateNum * qtyNum).toFixed(2)) : null
      return {
        name: item.chemical.name,
        chemicalId: item.chemicalId,
        quantity: qty,
        unit: item.chemical.unit || 'kg',
        rate,
        cost,
        matched: true,
        processTag: process.name,
      }
    })
    setChemicals(rows)
    setShowPresets(false)
  }

  // Apply shade recipe to chemicals
  function applyShadeRecipe(shade: ShadeWithRecipe) {
    if (chemicals.length > 0 && chemicals.some(c => c.name.trim())) {
      if (!confirm(`Replace shade chemicals with "${shade.name}" recipe?`)) return
    }
    // Remove existing "shade" tagged chemicals, keep other tagged ones
    const nonShadeChemicals = chemicals.filter(c => c.processTag !== 'shade')
    const shadeRows: ChemicalRow[] = shade.recipeItems.map(item => {
      const master = masterChemicals.find(m => m.id === item.chemicalId)
      const rate = master?.currentPrice?.toString() ?? ''
      const qty = String(item.quantity)
      const rateNum = parseFloat(rate)
      const qtyNum = parseFloat(qty)
      const cost = !isNaN(rateNum) && !isNaN(qtyNum) ? parseFloat((rateNum * qtyNum).toFixed(2)) : null
      return {
        name: item.chemical.name,
        chemicalId: item.chemicalId,
        quantity: qty,
        unit: item.chemical.unit || 'kg',
        rate,
        cost,
        matched: true,
        processTag: 'shade',
      }
    })
    setChemicals([...shadeRows, ...nonShadeChemicals])
    setShadeName(shade.name)
    setSelectedShadeId(shade.id)
    setShadeDropOpen(false)
    setShadeSearch('')
  }

  // Add process chemicals (additive, not replace)
  function addProcessChemicals(process: DyeingProcess, items: { chemicalId: number; name: string; unit: string; quantity: string }[]) {
    // Remove previously added chemicals from same process
    const withoutOld = chemicals.filter(c => c.processTag !== process.name)
    const newRows: ChemicalRow[] = items.filter(item => item.quantity.trim()).map(item => {
      const master = masterChemicals.find(m => m.id === item.chemicalId)
      const rate = master?.currentPrice?.toString() ?? ''
      const qty = item.quantity
      const rateNum = parseFloat(rate)
      const qtyNum = parseFloat(qty)
      const cost = !isNaN(rateNum) && !isNaN(qtyNum) ? parseFloat((rateNum * qtyNum).toFixed(2)) : null
      return {
        name: item.name,
        chemicalId: item.chemicalId,
        quantity: qty,
        unit: item.unit || 'kg',
        rate,
        cost,
        matched: true,
        processTag: process.name,
      }
    })
    setChemicals([...withoutOld, ...newRows])
    setAddedProcesses(prev => new Set([...prev, process.id]))
    setProcessPopup(null)
  }

  // ─── Save to Shade Master ─────────────────────────────────────────────────

  async function openSaveShade() {
    setShowSaveShade(true)
    setShadeSaved(false)
    setShadeError('')
    setShadeNameInput(shadeName.trim()) // pre-fill from slip's shade reference
    setShadeDescInput('')
    setLotWeights([])
    setLoadingWeights(true)
    const validLots = markaEntries.filter(m => m.lotNo.trim())
    if (validLots.length === 0) { setLoadingWeights(false); return }
    const lotsParam = validLots.map(m => m.lotNo.trim()).join(',')
    const res = await fetch(`/api/grey/lot-weight?lots=${encodeURIComponent(lotsParam)}`)
    const data = await res.json()
    setLotWeights(Array.isArray(data.lots) ? data.lots : [])
    setLoadingWeights(false)
  }

  function calcBatchWeight(): number {
    return markaEntries.reduce((sum, m) => {
      const lw = lotWeights.find(l => l.lotNo === m.lotNo.trim())
      return sum + (lw?.weightPerThan ?? 0) * (parseFloat(m.than) || 0)
    }, 0)
  }

  async function saveToShade() {
    if (!shadeNameInput.trim()) { setShadeError('Shade name is required'); return }
    const batchWeight = calcBatchWeight()
    if (batchWeight <= 0) { setShadeError('Cannot compute batch weight — check lot data in Grey register'); return }
    const validChemicals = chemicals.filter(c => c.chemicalId && c.name.trim() && parseFloat(c.quantity) > 0)
    if (validChemicals.length === 0) { setShadeError('No matched chemicals to save'); return }

    setSavingShade(true); setShadeError('')
    const recipeItems = validChemicals.map(c => ({
      chemicalId: c.chemicalId!,
      quantity: Math.round((parseFloat(c.quantity) / batchWeight) * 100 * 1000) / 1000,
    }))

    const res = await fetch('/api/shades', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: shadeNameInput.trim(), description: shadeDescInput.trim() || null, recipeItems }),
    })
    const data = await res.json()
    if (!res.ok) { setShadeError(data.error ?? 'Failed to save'); setSavingShade(false); return }
    setSavingShade(false)
    setShadeSaved(true)
    // Also set shade reference on the slip
    if (shadeNameInput.trim()) setShadeName(shadeNameInput.trim())
  }

  // ─── Submit ───────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    // Validate marka entries
    const validMarka = markaEntries.filter(m => m.lotNo.trim() && m.than.trim())
    if (validMarka.length === 0) { setError('At least one lot with than is required.'); return }
    const hasNotFound = validMarka.some(m => m.stockStatus === 'not_found')
    if (hasNotFound) { setError('One or more lots not found in Grey register.'); return }

    setSaving(true); setError('')

    const payload = {
      ...form,
      // Use first marka entry as primary for backward compat
      lotNo: validMarka[0].lotNo,
      than: validMarka[0].than,
      marka: validMarka.map(m => ({ lotNo: m.lotNo, than: parseFloat(m.than) || 0 })),
      chemicals: chemicals
        .filter(c => c.name.trim())
        .map(c => ({
          name: c.name.trim(),
          chemicalId: c.chemicalId,
          quantity: c.quantity ? parseFloat(c.quantity) : null,
          unit: c.unit,
          rate: c.rate ? parseFloat(c.rate) : null,
          cost: c.cost,
          processTag: c.processTag || null,
        })),
      shadeName: shadeName.trim() || null,
      machineId: selectedMachineId,
      operatorId: selectedOperatorId,
      ocrNames, // pass original OCR names for alias learning
    }

    const res = await fetch('/api/dyeing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (res.ok) {
      setSaving(false)
      // If queue has items, advance to next; otherwise redirect
      if (queue.length > 0) {
        advanceQueue()
      } else {
        router.push('/dyeing')
      }
    } else {
      const d = await res.json().catch(() => ({}))
      setError(d.error ?? 'Failed to save')
      setSaving(false)
    }
  }

  // ─── Floating Bubble Drag ─────────────────────────────────────────────────

  function onBubblePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    bubbleDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: bubblePos?.x ?? window.innerWidth - 80,
      origY: bubblePos?.y ?? window.innerHeight - 160,
      dragging: false,
    }
  }

  function onBubblePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = bubbleDragRef.current
    if (!d) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (!d.dragging && Math.abs(dx) < 5 && Math.abs(dy) < 5) return
    d.dragging = true
    const x = Math.max(28, Math.min(window.innerWidth - 28, d.origX + dx))
    const y = Math.max(28, Math.min(window.innerHeight - 28, d.origY + dy))
    setBubblePos({ x, y })
  }

  function onBubblePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const d = bubbleDragRef.current
    bubbleDragRef.current = null
    if (!d) return
    if (!d.dragging) {
      // Tap — open zoom
      if (imagePreviewRef.current) setShowZoom(true)
      return
    }
    // Save final position
    const x = Math.max(28, Math.min(window.innerWidth - 28, d.origX + (e.clientX - d.startX)))
    const y = Math.max(28, Math.min(window.innerHeight - 28, d.origY + (e.clientY - d.startY)))
    try { localStorage.setItem('vi_bubble_pos', JSON.stringify({ x, y })) } catch {}
  }

  // ─── Derived ──────────────────────────────────────────────────────────────

  const totalCost = chemicals.reduce((sum, c) => sum + (c.cost ?? 0), 0)
  const set = (field: string, value: string) => setForm(prev => ({ ...prev, [field]: value }))
  const queueDone = queue.filter(q => q.status === 'saved').length
  const queueTotal = queue.length
  const allQueueDone = queueTotal > 0 && queue.every(q => q.status === 'saved' || q.status === 'skipped')

  // ─── Render ───────────────────────────────────────────────────────────────

  const batchWeight = calcBatchWeight()
  const normalizedChemicals = chemicals.filter(c => c.chemicalId && parseFloat(c.quantity) > 0).map(c => ({
    ...c,
    normQty: batchWeight > 0 ? Math.round((parseFloat(c.quantity) / batchWeight) * 100 * 1000) / 1000 : 0,
  }))

  return (
    <div className="p-4 md:p-8 max-w-3xl">
      {showZoom && imagePreview && <ZoomModal src={imagePreview} onClose={() => setShowZoom(false)} />}

      {/* ── Floating Slip Bubble ── */}
      {bubblePos && (
        <div
          onPointerDown={onBubblePointerDown}
          onPointerMove={onBubblePointerMove}
          onPointerUp={onBubblePointerUp}
          style={{ left: bubblePos.x - 28, top: bubblePos.y - 28, touchAction: 'none' }}
          className={`fixed z-40 w-14 h-14 rounded-full shadow-2xl border-2 select-none cursor-grab active:cursor-grabbing overflow-hidden flex items-center justify-center transition-all ${
            commandMode ? 'border-teal-400 ring-4 ring-teal-200 animate-pulse' : imagePreview ? 'border-indigo-400' : 'border-gray-300'
          }`}
        >
          {imagePreview ? (
            <img src={imagePreview} alt="slip" className="w-full h-full object-cover pointer-events-none" />
          ) : (
            <div className="w-full h-full bg-gray-100 flex flex-col items-center justify-center gap-0.5">
              <span className="text-lg leading-none">📄</span>
              <span className="text-[8px] text-gray-400 font-medium leading-none">SLIP</span>
            </div>
          )}
          {/* Queue badge */}
          {queueTotal > 0 && (
            <div className="absolute -top-1 -right-1 bg-indigo-600 text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1 leading-none">
              {queueDone}/{queueTotal}
            </div>
          )}
        </div>
      )}

      {/* ── Save to Shade Master Modal ── */}
      {showSaveShade && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 shrink-0">
              <div>
                <h2 className="text-base font-bold text-white">Save to Shade Master</h2>
                <p className="text-xs text-gray-400 mt-0.5">Normalises chemical quantities to per 100 kg</p>
              </div>
              <button onClick={() => setShowSaveShade(false)} className="text-gray-400 hover:text-gray-200 text-2xl leading-none">×</button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {shadeError && <p className="text-xs text-red-400 bg-red-900/30 border border-red-700 rounded-lg px-3 py-2">{shadeError}</p>}
              {shadeSaved && (
                <div className="text-sm text-emerald-400 bg-emerald-900/30 border border-emerald-700 rounded-lg px-4 py-3 font-medium">
                  ✓ Shade &quot;{shadeNameInput}&quot; saved to Shade Master!
                </div>
              )}

              {/* Shade Name + Description */}
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="block text-xs font-medium text-white mb-1">Shade Name *</label>
                  <input type="text" value={shadeNameInput} onChange={e => setShadeNameInput(e.target.value)}
                    className="w-full bg-gray-700 border border-gray-600 text-gray-100 placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    placeholder="e.g. APC1, Navy Blue 12..." />
                </div>
                <div>
                  <label className="block text-xs font-medium text-white mb-1">Description (optional)</label>
                  <input type="text" value={shadeDescInput} onChange={e => setShadeDescInput(e.target.value)}
                    className="w-full bg-gray-700 border border-gray-600 text-gray-100 placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    placeholder="e.g. 4% shade, reactive dye..." />
                </div>
              </div>

              {/* Lot Weight Breakdown */}
              <div className="bg-gray-800 border border-gray-700 rounded-xl p-3">
                <p className="text-xs font-semibold text-white mb-2">Batch Weight Calculation</p>
                {loadingWeights ? (
                  <p className="text-xs text-gray-500 animate-pulse">Loading lot data...</p>
                ) : (
                  <>
                    <div className="space-y-1 mb-2">
                      {markaEntries.filter(m => m.lotNo.trim()).map((m, i) => {
                        const lw = lotWeights.find(l => l.lotNo === m.lotNo.trim())
                        const al = availableLots.find(l => l.lotNo === m.lotNo.trim())
                        const quality = lw?.quality || al?.quality
                        const than = parseFloat(m.than) || 0
                        const weight = (lw?.weightPerThan ?? 0) * than
                        return (
                          <div key={i} className="flex items-center justify-between text-xs">
                            <span className="font-medium text-gray-200">
                              {m.lotNo}
                              {quality && <span className="block text-[10px] text-indigo-400 font-normal">{quality}</span>}
                            </span>
                            <span className="text-gray-400">
                              {than} than × {lw?.weightPerThan ?? '?'} kg/than
                            </span>
                            <span className={`font-semibold ${weight > 0 ? 'text-gray-100' : 'text-red-400'}`}>
                              {weight > 0 ? `${weight.toFixed(1)} kg` : 'No data'}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                    <div className="flex items-center justify-between border-t border-gray-700 pt-2">
                      <span className="text-xs font-semibold text-white">Total Batch Weight</span>
                      <span className={`text-sm font-bold ${batchWeight > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {batchWeight > 0 ? `${batchWeight.toFixed(2)} kg` : 'Cannot compute'}
                      </span>
                    </div>
                  </>
                )}
              </div>

              {/* Normalized Recipe Preview */}
              {batchWeight > 0 && normalizedChemicals.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-white mb-2">
                    Normalized Recipe (per 100 kg fabric)
                  </p>
                  <div className="border border-gray-700 rounded-xl overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-800 border-b border-gray-700">
                        <tr>
                          <th className="text-left px-3 py-2 font-semibold text-gray-300">Chemical</th>
                          <th className="text-right px-3 py-2 font-semibold text-gray-300">Slip Qty</th>
                          <th className="text-right px-3 py-2 font-semibold text-emerald-400">Per 100 kg</th>
                        </tr>
                      </thead>
                      <tbody>
                        {normalizedChemicals.map((c, i) => (
                          <tr key={i} className={i % 2 === 0 ? 'bg-gray-900' : 'bg-gray-800'}>
                            <td className="px-3 py-2 font-medium text-gray-200">{c.name}</td>
                            <td className="px-3 py-2 text-right text-gray-400">{c.quantity} {c.unit}</td>
                            <td className="px-3 py-2 text-right font-semibold text-emerald-400">{c.normQty} {c.unit}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {normalizedChemicals.length < chemicals.filter(c => c.name.trim()).length && (
                    <p className="text-[10px] text-amber-400 mt-1">
                      ⚠ {chemicals.filter(c => c.name.trim()).length - normalizedChemicals.length} unmatched chemical(s) excluded (not in Chemical Master)
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex gap-3 justify-end px-5 py-4 border-t border-gray-700 shrink-0">
              <button type="button" onClick={() => setShowSaveShade(false)}
                className="px-4 py-2 border border-gray-600 rounded-lg text-sm text-gray-300 hover:bg-gray-700">
                {shadeSaved ? 'Close' : 'Cancel'}
              </button>
              {!shadeSaved && (
                <button type="button" onClick={saveToShade} disabled={savingShade || batchWeight <= 0 || loadingWeights}
                  className="px-5 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60">
                  {savingShade ? 'Saving...' : '💾 Save to Shade Master'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Voice Command Toast ── */}
      {cmdToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white text-sm font-medium px-5 py-2.5 rounded-full shadow-xl animate-fade-in whitespace-nowrap">
          {cmdToast}
        </div>
      )}

      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-gray-300 hover:text-white bg-gray-700 hover:bg-gray-600 rounded-lg px-4 py-2 text-sm font-medium transition">&larr; Back</button>
        <h1 className="text-2xl font-bold text-white">New Dyeing Slip</h1>
        {speechSupported && (
          <button
            type="button"
            onClick={toggleCommandMode}
            title={commandMode ? 'Voice commands ON — click to stop' : 'Enable voice commands'}
            className={`ml-auto flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium transition ${
              commandMode
                ? 'bg-teal-500 text-white shadow-lg ring-4 ring-teal-200 animate-pulse'
                : 'bg-teal-50 text-teal-700 border border-teal-200 hover:bg-teal-100'
            }`}
          >
            <span className="text-base">🎙</span>
            <span className="hidden sm:inline">{commandMode ? 'Listening...' : 'Voice CMD'}</span>
          </button>
        )}
      </div>

      {error && <div className="bg-red-900/30 border border-red-700 text-red-300 rounded-lg px-4 py-3 mb-4 text-sm">{error}</div>}

      {/* ── Resume Draft Dialog ── */}
      {showResume && (
        <div className="bg-amber-900/30 border border-amber-700 rounded-xl p-4 mb-4 flex items-start gap-3">
          <span className="text-2xl">📋</span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-300 mb-0.5">
              {pendingDraftCount} slip{pendingDraftCount > 1 ? 's' : ''} waiting from your last session
            </p>
            <p className="text-xs text-amber-400 mb-3">Your images were saved to cloud. You can continue right where you left off.</p>
            <div className="flex gap-2">
              <button type="button" onClick={resumeDraft}
                className="bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-amber-700 flex items-center gap-1.5">
                ▶ Resume ({pendingDraftCount} pending)
              </button>
              <button type="button" onClick={discardDraft}
                className="border border-amber-700 text-amber-400 px-3 py-2 rounded-lg text-sm hover:bg-amber-900/40">
                Discard
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Queue Panel ── */}
      {queueTotal > 0 && (
        <div className="bg-gray-800 rounded-xl shadow-sm border border-gray-700 p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-white">
              Slip Queue: {queueDone}/{queueTotal} done
            </h2>
            <div className="flex gap-2">
              {!allQueueDone && activeIdx >= 0 && (
                <button
                  type="button"
                  onClick={skipQueueItem}
                  className="text-xs text-gray-400 hover:text-gray-200 border border-gray-600 rounded-lg px-3 py-1"
                >
                  Skip
                </button>
              )}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="text-xs text-purple-400 hover:text-purple-300 font-medium"
              >
                + Add More
              </button>
            </div>
          </div>

          {/* Progress bar */}
          <div className="w-full bg-gray-700 rounded-full h-1.5 mb-3">
            <div
              className="bg-purple-500 h-1.5 rounded-full transition-all"
              style={{ width: `${queueTotal > 0 ? (queueDone / queueTotal) * 100 : 0}%` }}
            />
          </div>

          {uploadingDrafts && (
            <p className="text-xs text-purple-400 mb-2 animate-pulse">☁ Saving to cloud — you can resume later if you exit...</p>
          )}
          {!uploadingDrafts && cloudSaved && (
            <p className="text-xs text-green-400 mb-2">☁ Saved to cloud — safe to exit and resume later</p>
          )}

          {/* Thumbnails */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {queue.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                onClick={() => jumpToQueueItem(idx)}
                className={`shrink-0 w-12 h-12 rounded-lg border-2 overflow-hidden relative ${
                  item.status === 'active' ? 'border-purple-500 ring-2 ring-purple-700' :
                  item.status === 'saved' ? 'border-green-500 opacity-70' :
                  item.status === 'skipped' ? 'border-gray-600 opacity-40' :
                  'border-gray-600'
                }`}
              >
                <img src={item.preview} alt={`Slip ${idx + 1}`} className="w-full h-full object-cover" />
                <div className="absolute inset-0 flex items-center justify-center">
                  {item.status === 'saved' && <span className="text-white text-lg drop-shadow-md">&#10003;</span>}
                  {item.status === 'skipped' && <span className="text-white text-sm drop-shadow-md">&#8212;</span>}
                </div>
                <span className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[8px] text-center">{idx + 1}</span>
              </button>
            ))}
          </div>

          {/* All done message */}
          {allQueueDone && (
            <div className="mt-3 bg-green-900/30 border border-green-700 rounded-lg px-4 py-3 flex items-center justify-between">
              <span className="text-sm font-medium text-green-400">All {queueDone} slips saved!</span>
              <button
                type="button"
                onClick={() => router.push('/dyeing')}
                className="text-sm bg-green-600 text-white px-4 py-1.5 rounded-lg hover:bg-green-700 font-medium"
              >
                Done &rarr;
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Section 1: Image + AI ── */}
      <div className="bg-gray-800 rounded-xl shadow-sm border border-gray-700 p-5 mb-4">
        <h2 className="text-sm font-semibold text-white mb-3">Step 1 — Upload Slip Image (optional)</h2>

        <div className="flex gap-3 flex-wrap">
          {/* Image preview or upload button */}
          {imagePreview ? (
            <div className="relative">
              <img
                src={imagePreview}
                alt="Slip preview"
                className="h-36 w-28 object-cover rounded-lg border border-gray-200 cursor-pointer"
                onClick={() => setShowZoom(true)}
              />
              <button
                type="button"
                onClick={() => setShowZoom(true)}
                className="absolute bottom-1.5 right-1.5 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded"
              >
                Zoom
              </button>
              <button
                type="button"
                onClick={() => { setImagePreview(null); setImageBase64(null); setExtracted(false) }}
                className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs leading-none"
              >
                &times;
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => cameraRef.current?.click()}
                className="h-36 w-20 border-2 border-dashed border-gray-600 rounded-lg flex flex-col items-center justify-center gap-1 text-gray-500 hover:border-purple-500 hover:text-purple-400 transition"
              >
                <span className="text-2xl">📷</span>
                <span className="text-[10px] text-center leading-tight">Camera</span>
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="h-36 w-20 border-2 border-dashed border-gray-600 rounded-lg flex flex-col items-center justify-center gap-1 text-gray-500 hover:border-purple-500 hover:text-purple-400 transition"
              >
                <span className="text-2xl">🖼</span>
                <span className="text-[10px] text-center leading-tight">Gallery</span>
              </button>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-col justify-between gap-2 flex-1 min-w-[160px]">
            {/* Voice note */}
            <div>
              <button
                type="button"
                onClick={toggleRecording}
                disabled={!speechSupported}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition w-full justify-center ${
                  isRecording
                    ? 'bg-red-500 text-white animate-pulse'
                    : speechSupported
                    ? 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                }`}
              >
                <span>{isRecording ? '⏹ Stop' : '🎤 Voice Note'}</span>
              </button>
              {!speechSupported && <p className="text-xs text-gray-500 mt-1 text-center">Use Chrome for voice</p>}
            </div>

            {/* Voice text area */}
            {(voiceText || isRecording) && (
              <textarea
                className="border border-gray-600 bg-gray-700 text-gray-100 placeholder-gray-500 rounded-lg px-2 py-1.5 text-xs resize-none w-full focus:outline-none focus:ring-1 focus:ring-purple-500"
                rows={3}
                placeholder="Voice note transcript..."
                value={voiceText}
                onChange={e => setVoiceText(e.target.value)}
              />
            )}

            {/* ── Chemical Tags Panel ── */}
            <div className="border border-gray-700 rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setShowTagPanel(v => !v)}
                className="flex items-center gap-2 w-full px-3 py-2 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 transition"
              >
                <span className="font-medium">🏷 Chemical Tags</span>
                {tags.length > 0 && (
                  <span className="bg-indigo-900/50 text-indigo-300 px-1.5 py-0.5 rounded text-[10px] font-semibold">{tags.length}</span>
                )}
                <span className="ml-auto text-gray-500">{showTagPanel ? '▲' : '▼'}</span>
              </button>

              {showTagPanel && (
                <div className="p-3 space-y-2 bg-gray-700">
                  <p className="text-[10px] text-gray-500">Short names the AI expands in voice notes. Auto-learned from your extractions.</p>

                  {tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {tags.map((t, i) => (
                        <div key={i} className="flex items-center gap-1 bg-indigo-900/40 border border-indigo-700 rounded-full px-2 py-0.5 text-xs">
                          <span className="font-semibold text-indigo-300">{t.tag}</span>
                          <span className="text-indigo-500">→</span>
                          <span className="text-gray-300">{t.chemical}</span>
                          <button
                            type="button"
                            onClick={() => setTags(prev => prev.filter((_, idx) => idx !== i))}
                            className="text-red-400 hover:text-red-300 ml-0.5 leading-none"
                          >&times;</button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add new tag */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <input
                      type="text"
                      placeholder="Short tag (e.g. acid)"
                      value={newTag}
                      onChange={e => setNewTag(e.target.value)}
                      className="border border-gray-600 bg-gray-800 text-gray-100 placeholder-gray-500 rounded-lg px-2 py-1 text-xs w-28 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                    <span className="text-gray-500 text-xs">→</span>
                    <input
                      type="text"
                      placeholder="Full chemical name"
                      value={newTagChem}
                      onChange={e => setNewTagChem(e.target.value)}
                      list="tag-chem-list"
                      className="border border-gray-600 bg-gray-800 text-gray-100 placeholder-gray-500 rounded-lg px-2 py-1 text-xs flex-1 min-w-[120px] focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                    <datalist id="tag-chem-list">
                      {masterChemicals.map(m => <option key={m.id} value={m.name} />)}
                    </datalist>
                    <button
                      type="button"
                      onClick={() => {
                        if (!newTag.trim() || !newTagChem.trim()) return
                        setTags(prev => {
                          const updated = [...prev]
                          const existing = updated.findIndex(t => t.tag.toLowerCase() === newTag.trim().toLowerCase())
                          if (existing >= 0) {
                            updated[existing] = { tag: newTag.trim(), chemical: newTagChem.trim() }
                          } else {
                            updated.push({ tag: newTag.trim(), chemical: newTagChem.trim() })
                          }
                          return updated
                        })
                        setNewTag(''); setNewTagChem('')
                      }}
                      className="bg-indigo-600 text-white px-2.5 py-1 rounded-lg text-xs font-medium hover:bg-indigo-700"
                    >
                      + Add
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Extract button — always show when image exists */}
            {imageBase64 && (
              <button
                type="button"
                onClick={handleExtract}
                disabled={extracting}
                className={`px-4 py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 w-full ${
                  extracted
                    ? 'bg-green-100 text-green-700 hover:bg-green-200 border border-green-300'
                    : 'bg-purple-600 text-white hover:bg-purple-700'
                } disabled:opacity-60`}
              >
                {extracting ? (
                  <><span className="animate-spin">⟳</span> Extracting...</>
                ) : extracted ? (
                  '↻ Re-extract with AI'
                ) : (
                  'Extract with AI'
                )}
              </button>
            )}

            {!imageBase64 && (
              <p className="text-xs text-gray-500 text-center">Upload an image, then tap &quot;Extract with AI&quot;</p>
            )}
          </div>
        </div>

        {extractError && (
          <div className="mt-3 bg-amber-900/30 border border-amber-700 text-amber-300 rounded-lg px-3 py-2 text-xs">
            {extractError}
          </div>
        )}
      </div>

      {/* ── Section 2: Form Fields ── */}
      <form onSubmit={handleSubmit}>
        <div className="bg-gray-800 rounded-xl shadow-sm border border-gray-700 p-5 mb-4">
          <h2 className="text-sm font-semibold text-white mb-3">Step 2 — Slip Details</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Date *">
              <input type="date" className={inp} value={form.date} onChange={e => set('date', e.target.value)} required />
            </Field>
            <Field label="Slip No *">
              <input type="number" className={inp} value={form.slipNo} onChange={e => set('slipNo', e.target.value)} required placeholder="e.g. 266" />
            </Field>

            <Field label="Machine">
              <select className={inp} value={selectedMachineId ?? ''} onChange={e => setSelectedMachineId(e.target.value ? parseInt(e.target.value) : null)}>
                <option value="">-- Select Machine --</option>
                {machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </Field>

            <Field label="Operator">
              <select className={inp} value={selectedOperatorId ?? ''} onChange={e => setSelectedOperatorId(e.target.value ? parseInt(e.target.value) : null)}>
                <option value="">-- Select Operator --</option>
                {operators.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </Field>

            <Field label="Shade (Recipe)" span={2}>
              <div className="relative">
                <div
                  className={`flex items-center gap-2 border rounded-lg px-3 py-2 bg-gray-700 cursor-pointer ${shadeDropOpen ? 'ring-2 ring-purple-500 border-purple-500' : 'border-gray-600'}`}
                  onClick={() => { setShadeDropOpen(!shadeDropOpen); setShadeSearch('') }}
                >
                  <span className={`flex-1 text-sm ${shadeName ? 'font-medium text-gray-100' : 'text-gray-500'}`}>
                    {shadeName || 'Select shade to auto-fill recipe...'}
                  </span>
                  {shadeName && (
                    <button type="button" onClick={e => { e.stopPropagation(); setShadeName(''); setSelectedShadeId(null); setChemicals(prev => prev.filter(c => c.processTag !== 'shade')) }}
                      className="text-gray-400 hover:text-red-400 text-xs">Clear</button>
                  )}
                  <span className="text-gray-500 text-xs shrink-0">&#9660;</span>
                </div>
                {shadeDropOpen && (
                  <div className="absolute left-0 right-0 top-full mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-lg z-20 max-h-60 flex flex-col">
                    <input
                      type="text" autoFocus
                      className="w-full border-b border-gray-700 bg-gray-800 text-gray-100 placeholder-gray-500 px-3 py-2 text-sm focus:outline-none rounded-t-lg"
                      placeholder="Search shade..."
                      value={shadeSearch}
                      onChange={e => setShadeSearch(e.target.value)}
                      onClick={e => e.stopPropagation()}
                    />
                    <div className="overflow-y-auto max-h-48">
                      {shadesWithRecipe
                        .filter(s => !shadeSearch || s.name.toLowerCase().includes(shadeSearch.toLowerCase()))
                        .map(s => (
                          <button key={s.id} type="button"
                            className={`w-full text-left px-3 py-2 text-sm hover:bg-purple-900/30 text-gray-200 ${selectedShadeId === s.id ? 'bg-purple-900/30 font-medium' : ''}`}
                            onClick={e => { e.stopPropagation(); applyShadeRecipe(s) }}>
                            <span className="font-medium">{s.name}</span>
                            {s.description && <span className="text-xs text-gray-400 ml-1">— {s.description}</span>}
                            <span className="text-xs text-gray-500 ml-2">({s.recipeItems.length} chemicals)</span>
                          </button>
                        ))}
                      {shadesWithRecipe.filter(s => !shadeSearch || s.name.toLowerCase().includes(shadeSearch.toLowerCase())).length === 0 && (
                        <p className="px-3 py-2 text-xs text-gray-500">No shades found</p>
                      )}
                      {shadeSearch.trim() && !shadesWithRecipe.some(s => s.name.toLowerCase() === shadeSearch.toLowerCase()) && (
                        <button type="button"
                          className="w-full text-left px-3 py-2 text-sm hover:bg-amber-900/30 text-amber-400 border-t border-gray-700"
                          onClick={e => { e.stopPropagation(); setShadeName(shadeSearch.trim()); setShadeDropOpen(false); setShadeSearch('') }}>
                          Use &quot;{shadeSearch.trim()}&quot; as custom name
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </Field>

            <Field label="Notes" span={2}>
              <input type="text" className={inp} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Any remarks from slip" />
            </Field>
          </div>

          {/* ── Marka Entries (Lot + Than) ── */}
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-white">
                Marka — Lot Entries
                {markaEntries.length > 1 && <span className="ml-2 text-xs font-normal text-gray-400">{markaEntries.length} lots</span>}
              </h3>
              <button type="button" onClick={addMarkaEntry} className="text-xs text-purple-400 hover:text-purple-300 font-medium">
                + Add Lot
              </button>
            </div>

            <div className="space-y-2">
              {markaEntries.map((m, i) => {
                const selectedLotNos = markaEntries.map((e, idx) => idx !== i ? e.lotNo : '').filter(Boolean)
                const filteredLots = availableLots
                  .filter(l => !selectedLotNos.includes(l.lotNo))
                  .filter(l => !lotSearch || l.lotNo.toLowerCase().includes(lotSearch.toLowerCase()))
                return (
                <div key={i} className="border border-gray-600 rounded-xl p-3 bg-gray-700">
                  {/* Row 1: # + Lot selector + remove */}
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs text-gray-500 w-5 shrink-0">#{i + 1}</span>
                    <div className="flex-1 relative">
                      <div
                        className={`flex items-center gap-2 border rounded-lg px-3 py-2 bg-gray-800 cursor-pointer ${lotDropIdx === i ? 'ring-2 ring-purple-500 border-purple-500' : 'border-gray-600'}`}
                        onClick={() => { setLotDropIdx(lotDropIdx === i ? null : i); setLotSearch('') }}
                      >
                        <span className={`flex-1 text-sm ${m.lotNo ? 'font-medium text-gray-100' : 'text-gray-500'}`}>
                          {m.lotNo || 'Select lot...'}
                        </span>
                        {m.stockStatus === 'ok' && (
                          <span className="text-green-400 text-[10px] font-semibold bg-green-900/30 border border-green-700 px-1 py-0.5 rounded shrink-0">OK</span>
                        )}
                        {m.stockStatus === 'no_stock' && (
                          <span className="text-amber-400 text-[10px] font-semibold bg-amber-900/30 border border-amber-700 px-1 py-0.5 rounded shrink-0">Low</span>
                        )}
                        {m.stockStatus === 'not_found' && (
                          <span className="text-red-400 text-[10px] font-semibold bg-red-900/30 border border-red-700 px-1 py-0.5 rounded shrink-0">N/A</span>
                        )}
                        <span className="text-gray-500 text-xs shrink-0">&#9660;</span>
                      </div>

                      {/* Searchable lot dropdown */}
                      {lotDropIdx === i && (
                        <div className="absolute left-0 right-0 top-full mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-lg z-20 max-h-60 flex flex-col">
                          <input
                            type="text"
                            autoFocus
                            className="w-full border-b border-gray-700 bg-gray-800 text-gray-100 placeholder-gray-500 px-3 py-2 text-sm focus:outline-none rounded-t-lg"
                            placeholder="Search lot number..."
                            value={lotSearch}
                            onChange={e => setLotSearch(e.target.value)}
                            onClick={e => e.stopPropagation()}
                          />
                          <div className="overflow-y-auto max-h-48">
                            {filteredLots.map(l => (
                              <button
                                key={l.lotNo}
                                type="button"
                                className={`w-full text-left px-3 py-2 text-sm hover:bg-purple-900/30 flex items-center justify-between text-gray-200 ${m.lotNo === l.lotNo ? 'bg-purple-900/30 font-medium' : ''}`}
                                onClick={e => { e.stopPropagation(); selectLot(i, l) }}
                              >
                                <span className="font-medium">{l.lotNo}</span>
                                <span className="text-xs text-gray-500">Stock: {l.stock} than</span>
                              </button>
                            ))}
                            {filteredLots.length === 0 && !lotSearch && (
                              <p className="px-3 py-2 text-xs text-gray-500">No lots with available stock</p>
                            )}
                            {filteredLots.length === 0 && lotSearch && (
                              <button
                                type="button"
                                className="w-full text-left px-3 py-2 text-sm hover:bg-amber-900/30 text-amber-400 border-t border-gray-700 flex items-center gap-1"
                                onClick={e => {
                                  e.stopPropagation()
                                  updateMarka(i, 'lotNo', lotSearch.trim())
                                  setLotDropIdx(null)
                                  setLotSearch('')
                                  setTimeout(() => checkMarkaStock(i), 100)
                                }}
                              >
                                <span className="text-amber-500">+</span> Use &quot;{lotSearch.trim()}&quot; manually
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                    {markaEntries.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeMarkaEntry(i)}
                        className="text-red-400 hover:text-red-300 text-xl leading-none shrink-0 w-6 text-center"
                      >&times;</button>
                    )}
                  </div>

                  {/* Row 2: Stock info line */}
                  {m.stockStatus === 'loading' && <p className="text-xs text-gray-500 pl-7 mb-2">Checking stock...</p>}
                  {m.stockStatus === 'not_found' && <p className="text-xs text-red-400 pl-7 mb-2">Lot not found in Grey register</p>}
                  {m.stockStatus === 'no_stock' && m.stockInfo && (
                    <p className="text-xs text-amber-400 pl-7 mb-2">
                      Grey: {m.stockInfo.greyThan} | Despatched: {m.stockInfo.despatchThan} | Balance: <strong>{m.stockInfo.stock}</strong>
                    </p>
                  )}
                  {m.stockStatus === 'ok' && m.stockInfo && (
                    <p className="text-xs text-green-400 pl-7 mb-2">
                      Grey: {m.stockInfo.greyThan} | Despatched: {m.stockInfo.despatchThan} | Balance: <strong>{m.stockInfo.stock}</strong>
                    </p>
                  )}

                  {/* Row 3: Than input */}
                  <div className="pl-7">
                    <label className="block text-[10px] text-gray-400 mb-0.5">Than *</label>
                    <input
                      type="number"
                      className="w-full border border-gray-600 bg-gray-800 text-gray-100 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                      value={m.than}
                      onChange={e => updateMarka(i, 'than', e.target.value)}
                      required
                      placeholder="Qty"
                    />
                  </div>
                </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* ── Section 3: Chemicals ── */}
        <div className="bg-gray-800 rounded-xl shadow-sm border border-gray-700 p-5 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-white">
              Step 3 — Chemicals Used
              {chemicals.length > 0 && <span className="ml-2 text-xs font-normal text-gray-400">{chemicals.length} items</span>}
            </h2>
            <div className="flex items-center gap-2">
              {chemicals.some(c => c.chemicalId) && (
                <button type="button" onClick={openSaveShade}
                  className="text-xs text-emerald-400 hover:text-emerald-300 font-medium bg-emerald-900/30 border border-emerald-700 rounded-lg px-2.5 py-1 hover:bg-emerald-900/50 transition">
                  💾 Save to Shade
                </button>
              )}
              <button type="button" onClick={addChemicalRow} className="text-xs text-purple-400 hover:text-purple-300 font-medium">
                + Add Chemical
              </button>
            </div>
          </div>

          {/* Process Buttons */}
          {processes.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2 overflow-x-auto pb-1">
                <span className="text-xs font-medium text-gray-400 shrink-0">Processes:</span>
                {processes.map(p => {
                  const isAdded = addedProcesses.has(p.id)
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        const threshold = p.threshold ?? 220
                        const batchWeight = calcBatchWeight()
                        const useHigh = batchWeight > threshold
                        setProcessPopup({
                          process: p,
                          batchWeight,
                          items: p.items.map(item => ({
                            chemicalId: item.chemicalId,
                            name: item.chemical.name,
                            unit: item.chemical.unit || 'kg',
                            quantity: String(useHigh && item.quantityHigh != null ? item.quantityHigh : item.quantity),
                          })),
                        })
                      }}
                      title={p.description || `${p.items.length} chemicals`}
                      className={`px-3 py-1 rounded-full text-xs font-medium transition shrink-0 ${
                        isAdded
                          ? 'bg-green-900/40 text-green-300 border border-green-700'
                          : 'bg-indigo-900/40 text-indigo-300 border border-indigo-700 hover:bg-indigo-900/60'
                      }`}
                    >
                      {isAdded ? '\u2705 ' : ''}{p.name}
                      <span className={`ml-1 ${isAdded ? 'text-green-400' : 'text-indigo-400'}`}>({p.items.length})</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Process Popup */}
          {processPopup && (() => {
            const threshold = processPopup.process.threshold ?? 220
            const batchWeight = processPopup.batchWeight ?? 0
            const useHigh = batchWeight > threshold
            const hasHighPreset = processPopup.process.items.some(i => i.quantityHigh != null)
            return (
            <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center" onClick={() => setProcessPopup(null)}>
              <div className="bg-gray-900 w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[80vh] overflow-y-auto border border-gray-700" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-4 border-b border-gray-700">
                  <h3 className="text-base font-bold text-white">{processPopup.process.name}</h3>
                  <button onClick={() => setProcessPopup(null)} className="text-gray-400 hover:text-white text-2xl leading-none">&times;</button>
                </div>
                {hasHighPreset && batchWeight > 0 && (
                  <div className={`mx-4 mt-3 text-xs px-2 py-1 rounded ${useHigh ? 'bg-orange-900/30 text-orange-400' : 'bg-purple-900/30 text-purple-400'}`}>
                    {useHigh
                      ? `> ${threshold} kg preset (batch: ${batchWeight.toFixed(1)} kg)`
                      : `\u2264 ${threshold} kg preset (batch: ${batchWeight.toFixed(1)} kg)`}
                  </div>
                )}
                <div className="p-4 space-y-3">
                  {processPopup.items.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-3">
                      <span className="text-sm text-gray-200 flex-1">{item.name}</span>
                      <input
                        type="number" step="0.001"
                        className="w-24 bg-gray-700 border border-gray-600 text-gray-100 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 text-right"
                        value={item.quantity}
                        onChange={e => {
                          setProcessPopup(prev => {
                            if (!prev) return prev
                            const updated = [...prev.items]
                            updated[idx] = { ...updated[idx], quantity: e.target.value }
                            return { ...prev, items: updated }
                          })
                        }}
                      />
                      <span className="text-xs text-gray-500 w-8">{item.unit}</span>
                    </div>
                  ))}
                </div>
                <div className="p-4 border-t border-gray-700">
                  <button
                    type="button"
                    onClick={() => addProcessChemicals(processPopup.process, processPopup.items)}
                    className="w-full bg-purple-600 text-white font-semibold rounded-lg px-4 py-2.5 text-sm hover:bg-purple-700 transition"
                  >
                    Add to Slip
                  </button>
                </div>
              </div>
            </div>
            )
          })()}

          {chemicals.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-4">
              No chemicals added yet. Upload a slip image and click &quot;Extract with AI&quot;, or click &quot;+ Add Row&quot; to enter manually.
            </p>
          ) : (
            <div className="space-y-3">
              {chemicals.map((c, i) => (
                <div key={i} className="border border-gray-200 dark:border-gray-700 rounded-xl p-3 bg-gray-50 dark:bg-gray-800">
                  {/* Chemical name row */}
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs text-gray-400 dark:text-gray-500 w-5 shrink-0">#{i + 1}</span>
                    <div className="flex-1 relative">
                      <div
                        className={`flex items-center gap-2 border rounded-lg px-3 py-2 bg-white dark:bg-gray-900 cursor-pointer ${chemDropIdx === i ? 'ring-2 ring-purple-400 border-purple-400' : 'border-gray-300 dark:border-gray-600'}`}
                        onClick={() => { setChemDropIdx(chemDropIdx === i ? null : i); setChemSearch('') }}
                      >
                        <span className={`flex-1 text-sm ${c.name ? 'font-medium text-gray-800 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500'}`}>
                          {c.name || 'Select chemical...'}
                        </span>
                        {c.processTag && (
                          <span className="text-[10px] font-medium bg-gray-700 text-gray-300 px-1.5 py-0.5 rounded shrink-0">{c.processTag}</span>
                        )}
                        {c.matched && (
                          <span className="text-green-600 dark:text-green-400 text-[10px] font-semibold bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 px-1 py-0.5 rounded shrink-0">✓</span>
                        )}
                        {!c.matched && c.name && (
                          <span className="text-amber-600 dark:text-amber-400 text-[10px] font-semibold bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 px-1 py-0.5 rounded shrink-0">New</span>
                        )}
                        <span className="text-gray-400 dark:text-gray-500 text-xs shrink-0">▼</span>
                      </div>

                      {/* Searchable dropdown */}
                      {chemDropIdx === i && (
                        <div className="absolute left-0 right-0 top-full mt-1 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-20 max-h-60 flex flex-col">
                          <input
                            type="text"
                            autoFocus
                            className="w-full border-b border-gray-200 dark:border-gray-700 px-3 py-2 text-sm focus:outline-none rounded-t-lg bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
                            placeholder="Search or type new name..."
                            value={chemSearch}
                            onChange={e => setChemSearch(e.target.value)}
                            onClick={e => e.stopPropagation()}
                          />
                          <div className="overflow-y-auto max-h-48">
                            {masterChemicals
                              .filter(m => !chemSearch || m.name.toLowerCase().includes(chemSearch.toLowerCase()))
                              .map(m => (
                                <button
                                  key={m.id}
                                  type="button"
                                  className={`w-full text-left px-3 py-2 text-sm hover:bg-purple-50 dark:hover:bg-purple-900/30 flex items-center justify-between text-gray-800 dark:text-gray-200 ${c.chemicalId === m.id ? 'bg-purple-50 dark:bg-purple-900/30 font-medium' : ''}`}
                                  onClick={e => { e.stopPropagation(); selectMasterChemical(i, m) }}
                                >
                                  <span>{m.name}</span>
                                  {m.currentPrice != null && (
                                    <span className="text-xs text-gray-400 dark:text-gray-500">₹{m.currentPrice}/{m.unit}</span>
                                  )}
                                </button>
                              ))
                            }
                            {/* Option to use typed name as new chemical */}
                            {chemSearch.trim() && !masterChemicals.some(m => m.name.toLowerCase() === chemSearch.toLowerCase()) && (
                              <button
                                type="button"
                                className="w-full text-left px-3 py-2 text-sm hover:bg-amber-50 dark:hover:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-t border-gray-100 dark:border-gray-700 flex items-center gap-1"
                                onClick={e => { e.stopPropagation(); updateChemical(i, 'name', chemSearch.trim()); setChemDropIdx(null); setChemSearch('') }}
                              >
                                <span className="text-amber-500">+</span> Add &quot;{chemSearch.trim()}&quot; as new
                              </button>
                            )}
                            {masterChemicals.length === 0 && !chemSearch && (
                              <p className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500">No chemicals in master yet</p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeChemical(i)}
                      className="text-red-400 hover:text-red-600 dark:text-red-500 dark:hover:text-red-400 text-xl leading-none shrink-0 w-6 text-center"
                    >&times;</button>
                  </div>

                  {/* Qty / Unit / Rate / Cost row */}
                  <div className="grid grid-cols-2 gap-2 pl-12">
                    <div>
                      <label className="block text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">Quantity</label>
                      <input
                        type="number" step="0.001"
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
                        value={c.quantity}
                        onChange={e => updateChemical(i, 'quantity', e.target.value)}
                        placeholder="0"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">Unit</label>
                      <select
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm focus:outline-none bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
                        value={c.unit}
                        onChange={e => updateChemical(i, 'unit', e.target.value)}
                      >
                        {['kg', 'liter', 'gram', 'ml', 'piece', 'bag'].map(u => <option key={u}>{u}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">Rate (₹/{c.unit})</label>
                      <input
                        type="number" step="0.01"
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
                        value={c.rate}
                        onChange={e => updateChemical(i, 'rate', e.target.value)}
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">Cost (₹)</label>
                      <div className={`w-full border rounded-lg px-3 py-1.5 text-sm font-semibold ${c.cost != null ? 'border-purple-200 dark:border-purple-700 bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-400 dark:text-gray-500'}`}>
                        {c.cost != null ? `₹${c.cost.toFixed(2)}` : '—'}
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {/* Total cost */}
              {totalCost > 0 && (
                <div className="flex items-center justify-between bg-purple-50 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-700 rounded-xl px-4 py-3">
                  <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Total Dyeing Cost</span>
                  <span className="text-lg font-bold text-purple-700 dark:text-purple-300">₹{totalCost.toFixed(2)}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="flex gap-3 justify-end">
          <button
            type="button" onClick={() => router.back()}
            className="px-4 py-2 border border-gray-600 rounded-lg text-sm text-gray-300 hover:bg-gray-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || stockStatus === 'not_found'}
            className="px-6 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-60"
          >
            {saving ? 'Saving...' : 'Save Dyeing Slip'}
          </button>
        </div>
      </form>

      {/* Hidden file inputs */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture
        className="hidden"
        onChange={handleImageSelect}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleImageSelect}
      />
    </div>
  )
}

const inp = 'w-full bg-gray-700 border border-gray-600 text-gray-100 placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500'

function Field({ label, children, span = 1 }: { label: string; children: React.ReactNode; span?: number }) {
  return (
    <div className={span === 2 ? 'sm:col-span-2' : ''}>
      <label className="block text-xs font-medium text-white mb-1">{label}</label>
      {children}
    </div>
  )
}
