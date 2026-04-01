'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface FoldLot {
  lotNo: string
  than: number
  quality: string
  party: string
  foldAvailable: number
}

interface FoldBatch {
  shadeId: number | null
  shadeName: string
  lots: string[] // selected lotNos
}

interface ShadeOption {
  id: number
  name: string
  description?: string
}

export default function AIChatBubble() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [listening, setListening] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const recognitionRef = useRef<any>(null)

  // Fold creation mode
  const [foldMode, setFoldMode] = useState(false)
  const [foldLots, setFoldLots] = useState<FoldLot[]>([])
  const [foldBatches, setFoldBatches] = useState<FoldBatch[]>([{ shadeId: null, shadeName: '', lots: [] }])
  const [foldNo, setFoldNo] = useState('')
  const [foldShades, setFoldShades] = useState<ShadeOption[]>([])
  const [creatingFold, setCreatingFold] = useState(false)

  // Shade search per batch
  const [shadeSearch, setShadeSearch] = useState<Record<number, string>>({})
  const [shadeDropdownOpen, setShadeDropdownOpen] = useState<number | null>(null)

  // New shade inline creation
  const [newShadeOpen, setNewShadeOpen] = useState<number | null>(null)
  const [newShadeName, setNewShadeName] = useState('')
  const [newShadeDesc, setNewShadeDesc] = useState('')
  const [shadeExists, setShadeExists] = useState<ShadeOption | null>(null)
  const [creatingShade, setCreatingShade] = useState(false)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus()
    }
  }, [open])

  // Close shade dropdown on outside click
  useEffect(() => {
    const handler = () => setShadeDropdownOpen(null)
    if (shadeDropdownOpen !== null) {
      setTimeout(() => document.addEventListener('click', handler), 0)
      return () => document.removeEventListener('click', handler)
    }
  }, [shadeDropdownOpen])

  const sendMessage = async (voiceText?: string) => {
    const trimmed = (voiceText || input).trim()
    if (!trimmed || loading) return

    const userMsg: Message = { role: 'user', content: trimmed }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setLoading(true)

    try {
      const history = newMessages.slice(-10).map(m => ({ role: m.role, content: m.content }))

      const res = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed, history: history.slice(0, -1) }),
      })

      const data = await res.json()
      const reply = data.reply || data.error || 'Sorry, something went wrong.'
      setMessages(prev => [...prev, { role: 'assistant', content: reply }])

      // Handle fold creation action
      if (data.action === 'fold_create' && data.lots?.length > 0) {
        setFoldLots(data.lots)
        setFoldBatches([{ shadeId: null, shadeName: '', lots: [] }])
        setShadeSearch({})
        setShadeDropdownOpen(null)
        setNewShadeOpen(null)

        // Fetch shades list
        try {
          const shadesRes = await fetch('/api/shades')
          const shadesData = await shadesRes.json()
          setFoldShades(shadesData.map((s: any) => ({ id: s.id, name: s.name, description: s.description })))
        } catch { setFoldShades([]) }

        // Auto-generate fold number
        try {
          const foldRes = await fetch('/api/fold')
          const foldData = await foldRes.json()
          const maxNo = foldData.reduce((max: number, f: any) => {
            const num = parseInt(f.foldNo.replace(/\D/g, '')) || 0
            return num > max ? num : max
          }, 0)
          setFoldNo(String(maxNo + 1))
        } catch { setFoldNo('1') }

        setFoldMode(true)
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Network error. Please try again.' }])
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // Voice input
  const hasSpeech = typeof window !== 'undefined' && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)

  function startListening() {
    if (!hasSpeech) return
    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition
    const recognition = new SpeechRecognition()
    recognition.lang = 'hi-IN'
    recognition.continuous = false
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    recognition.onstart = () => setListening(true)

    recognition.onresult = (e: any) => {
      const transcript = e.results[0][0].transcript
      setInput(transcript)
      if (e.results[0].isFinal) {
        setListening(false)
        setTimeout(() => sendMessage(transcript), 200)
      }
    }

    recognition.onerror = () => setListening(false)
    recognition.onend = () => setListening(false)

    recognitionRef.current = recognition
    recognition.start()
  }

  function stopListening() {
    if (recognitionRef.current) {
      recognitionRef.current.stop()
      recognitionRef.current = null
    }
    setListening(false)
  }

  // ─── Fold helpers ─────────────────────────────────────────────────────

  const allSelectedLots = foldBatches.flatMap(b => b.lots)

  const getAvailableLotsForBatch = (batchIdx: number): FoldLot[] => {
    const otherSelected = foldBatches
      .filter((_, i) => i !== batchIdx)
      .flatMap(b => b.lots)
    return foldLots.filter(l => !otherSelected.includes(l.lotNo))
  }

  const toggleLot = (batchIdx: number, lotNo: string) => {
    setFoldBatches(prev => {
      const updated = [...prev]
      const batch = { ...updated[batchIdx] }
      batch.lots = batch.lots.includes(lotNo)
        ? batch.lots.filter(l => l !== lotNo)
        : [...batch.lots, lotNo]
      updated[batchIdx] = batch
      return updated
    })
  }

  const selectAllForBatch = (batchIdx: number) => {
    const available = getAvailableLotsForBatch(batchIdx)
    setFoldBatches(prev => {
      const updated = [...prev]
      updated[batchIdx] = { ...updated[batchIdx], lots: available.map(l => l.lotNo) }
      return updated
    })
  }

  const clearBatchLots = (batchIdx: number) => {
    setFoldBatches(prev => {
      const updated = [...prev]
      updated[batchIdx] = { ...updated[batchIdx], lots: [] }
      return updated
    })
  }

  const addBatch = () => {
    setFoldBatches(prev => [...prev, { shadeId: null, shadeName: '', lots: [] }])
  }

  const removeBatch = (batchIdx: number) => {
    if (foldBatches.length <= 1) return
    setFoldBatches(prev => prev.filter((_, i) => i !== batchIdx))
  }

  const selectShade = (batchIdx: number, shade: ShadeOption) => {
    setFoldBatches(prev => {
      const updated = [...prev]
      updated[batchIdx] = { ...updated[batchIdx], shadeId: shade.id, shadeName: shade.name }
      return updated
    })
    setShadeDropdownOpen(null)
    setShadeSearch(prev => ({ ...prev, [batchIdx]: '' }))
  }

  const getFilteredShades = (batchIdx: number): ShadeOption[] => {
    const q = (shadeSearch[batchIdx] || '').toLowerCase()
    if (!q) return foldShades
    return foldShades.filter(s => s.name.toLowerCase().includes(q) || s.description?.toLowerCase().includes(q))
  }

  const handleNewShadeNameChange = (name: string) => {
    setNewShadeName(name)
    const existing = foldShades.find(s => s.name.toLowerCase() === name.trim().toLowerCase())
    setShadeExists(existing || null)
  }

  const saveNewShade = async (batchIdx: number) => {
    if (!newShadeName.trim()) return
    setCreatingShade(true)
    try {
      const res = await fetch('/api/shades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newShadeName.trim(), description: newShadeDesc.trim() || undefined }),
      })
      const shade = await res.json()
      if (shade.error) { alert(shade.error); return }
      const opt: ShadeOption = { id: shade.id, name: shade.name, description: shade.description }
      setFoldShades(prev => [...prev, opt].sort((a, b) => a.name.localeCompare(b.name)))
      selectShade(batchIdx, opt)
      setNewShadeOpen(null)
      setNewShadeName('')
      setNewShadeDesc('')
      setShadeExists(null)
    } catch {
      alert('Failed to create shade')
    } finally {
      setCreatingShade(false)
    }
  }

  const applyExistingShade = (batchIdx: number) => {
    if (shadeExists) {
      selectShade(batchIdx, shadeExists)
      setNewShadeOpen(null)
      setNewShadeName('')
      setNewShadeDesc('')
      setShadeExists(null)
    }
  }

  const cancelFold = () => {
    setFoldMode(false)
    setFoldLots([])
    setFoldBatches([{ shadeId: null, shadeName: '', lots: [] }])
    setFoldNo('')
    setMessages(prev => [...prev, { role: 'assistant', content: 'Fold creation cancelled.' }])
  }

  const handleCreateFold = async () => {
    // Validate
    const validBatches = foldBatches.filter(b => (b.shadeId || b.shadeName) && b.lots.length > 0)
    if (validBatches.length === 0) {
      alert('Select at least one shade and one lot per batch.')
      return
    }
    if (!foldNo.trim()) {
      alert('Enter a fold number.')
      return
    }

    setCreatingFold(true)
    try {
      const payload = {
        foldNo: foldNo.trim(),
        date: new Date().toISOString().slice(0, 10),
        batches: validBatches.map(b => ({
          shadeId: b.shadeId,
          shadeName: b.shadeName,
          lots: b.lots.map(lotNo => {
            const lot = foldLots.find(l => l.lotNo === lotNo)
            return { lotNo, than: lot?.foldAvailable ?? 0 }
          }),
        })),
      }

      const res = await fetch('/api/fold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()

      if (data.error) {
        setMessages(prev => [...prev, { role: 'assistant', content: `Error creating fold: ${data.error}` }])
      } else {
        const totalThan = validBatches.reduce((s, b) => s + b.lots.reduce((s2, lotNo) => {
          const lot = foldLots.find(l => l.lotNo === lotNo)
          return s2 + (lot?.foldAvailable ?? 0)
        }, 0), 0)
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `Fold ${foldNo} created successfully!\n${validBatches.length} batch(es), ${allSelectedLots.length} lots, ${totalThan} than total.`,
        }])
      }

      setFoldMode(false)
      setFoldLots([])
      setFoldBatches([{ shadeId: null, shadeName: '', lots: [] }])
      setFoldNo('')
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Network error creating fold. Please try again.' }])
    } finally {
      setCreatingFold(false)
    }
  }

  // ─── Summary stats ────────────────────────────────────────────────────

  const totalSelectedLots = allSelectedLots.length
  const totalSelectedThan = allSelectedLots.reduce((s, lotNo) => {
    const lot = foldLots.find(l => l.lotNo === lotNo)
    return s + (lot?.foldAvailable ?? 0)
  }, 0)
  const validBatchCount = foldBatches.filter(b => (b.shadeId || b.shadeName) && b.lots.length > 0).length

  // ─── Render ───────────────────────────────────────────────────────────

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-purple-600 rounded-full shadow-lg flex items-center justify-center text-2xl hover:bg-purple-700 hover:scale-105 transition-all duration-200"
        aria-label="Open AI Chat"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
        </svg>
      </button>
    )
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[calc(100vw-2rem)] max-w-sm sm:w-96 h-[75vh] max-h-[520px] bg-gray-800 rounded-2xl shadow-2xl border border-gray-700 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-800 border-b border-gray-700 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714a2.25 2.25 0 00.659 1.591L19 14.5M14.25 3.104c.251.023.501.05.75.082M19 14.5l-2.47 2.47a2.25 2.25 0 01-1.591.659H9.061a2.25 2.25 0 01-1.591-.659L5 14.5m14 0V17a2 2 0 01-2 2H7a2 2 0 01-2-2v-2.5" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-100">KSI Assistant</h3>
            <p className="text-xs text-gray-400">
              {foldMode ? 'Creating fold program...' : 'Ask about stock, dyeing, outstanding...'}
            </p>
          </div>
        </div>
        <button
          onClick={() => { if (foldMode) cancelFold(); else setOpen(false) }}
          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition"
          aria-label={foldMode ? 'Cancel fold' : 'Close chat'}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Fold creation UI */}
      {foldMode ? (
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
          {foldBatches.map((batch, batchIdx) => {
            const availableLots = getAvailableLotsForBatch(batchIdx)
            const batchThan = batch.lots.reduce((s, lotNo) => {
              const lot = foldLots.find(l => l.lotNo === lotNo)
              return s + (lot?.foldAvailable ?? 0)
            }, 0)
            const filtered = getFilteredShades(batchIdx)

            return (
              <div key={batchIdx} className="border border-gray-600 rounded-xl p-3 space-y-2">
                {/* Batch header */}
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-purple-400 uppercase tracking-wider">Batch {batchIdx + 1}</span>
                  {foldBatches.length > 1 && (
                    <button onClick={() => removeBatch(batchIdx)} className="text-xs text-red-400 hover:text-red-300">Remove</button>
                  )}
                </div>

                {/* Shade selector */}
                <div className="relative">
                  {batch.shadeId ? (
                    <div className="flex items-center justify-between bg-gray-700 rounded-lg px-3 py-2">
                      <span className="text-sm text-gray-100">{batch.shadeName}</span>
                      <button
                        onClick={() => {
                          setFoldBatches(prev => {
                            const u = [...prev]
                            u[batchIdx] = { ...u[batchIdx], shadeId: null, shadeName: '' }
                            return u
                          })
                        }}
                        className="text-xs text-gray-400 hover:text-gray-200"
                      >Change</button>
                    </div>
                  ) : newShadeOpen === batchIdx ? (
                    <div className="space-y-2 bg-gray-700 rounded-lg p-2">
                      <input
                        type="text"
                        value={newShadeName}
                        onChange={e => handleNewShadeNameChange(e.target.value)}
                        placeholder="Shade name"
                        className="w-full bg-gray-800 text-gray-100 text-sm rounded-lg px-3 py-2 outline-none border border-gray-600 focus:border-purple-500"
                      />
                      <input
                        type="text"
                        value={newShadeDesc}
                        onChange={e => setNewShadeDesc(e.target.value)}
                        placeholder="Description (optional)"
                        className="w-full bg-gray-800 text-gray-100 text-sm rounded-lg px-3 py-2 outline-none border border-gray-600 focus:border-purple-500"
                      />
                      {shadeExists ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-yellow-400 flex-1">Shade already exists</span>
                          <button
                            onClick={() => applyExistingShade(batchIdx)}
                            className="text-xs bg-yellow-600 hover:bg-yellow-700 text-white px-2 py-1 rounded"
                          >Use Existing</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => saveNewShade(batchIdx)}
                          disabled={!newShadeName.trim() || creatingShade}
                          className="text-xs bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white px-3 py-1.5 rounded"
                        >
                          {creatingShade ? 'Saving...' : 'Save Shade'}
                        </button>
                      )}
                      <button
                        onClick={() => { setNewShadeOpen(null); setNewShadeName(''); setNewShadeDesc(''); setShadeExists(null) }}
                        className="text-xs text-gray-400 hover:text-gray-200 ml-2"
                      >Cancel</button>
                    </div>
                  ) : (
                    <div>
                      <div
                        className="flex items-center bg-gray-700 rounded-lg px-3 py-2 cursor-pointer"
                        onClick={e => { e.stopPropagation(); setShadeDropdownOpen(shadeDropdownOpen === batchIdx ? null : batchIdx) }}
                      >
                        <input
                          type="text"
                          value={shadeSearch[batchIdx] || ''}
                          onChange={e => { e.stopPropagation(); setShadeSearch(prev => ({ ...prev, [batchIdx]: e.target.value })); setShadeDropdownOpen(batchIdx) }}
                          onClick={e => { e.stopPropagation(); setShadeDropdownOpen(batchIdx) }}
                          placeholder="Search shade..."
                          className="flex-1 bg-transparent text-sm text-gray-100 outline-none placeholder-gray-400"
                        />
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                      </div>
                      {shadeDropdownOpen === batchIdx && (
                        <div className="absolute z-10 mt-1 w-full bg-gray-700 border border-gray-600 rounded-lg max-h-40 overflow-y-auto shadow-lg" onClick={e => e.stopPropagation()}>
                          {filtered.map(s => (
                            <button
                              key={s.id}
                              onClick={() => selectShade(batchIdx, s)}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-gray-600 text-gray-100"
                            >
                              <span className="font-medium">{s.name}</span>
                              {s.description && <span className="text-xs text-gray-400 ml-1">({s.description})</span>}
                            </button>
                          ))}
                          {filtered.length === 0 && (
                            <div className="px-3 py-2 text-xs text-gray-400">No shades found</div>
                          )}
                          <button
                            onClick={() => { setNewShadeOpen(batchIdx); setShadeDropdownOpen(null); setNewShadeName(shadeSearch[batchIdx] || ''); handleNewShadeNameChange(shadeSearch[batchIdx] || '') }}
                            className="w-full text-left px-3 py-2 text-sm text-purple-400 hover:bg-gray-600 border-t border-gray-600"
                          >
                            + Create New Shade
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Lot cards */}
                <div className="space-y-1.5">
                  {availableLots.map(lot => {
                    const selected = batch.lots.includes(lot.lotNo)
                    return (
                      <button
                        key={lot.lotNo}
                        onClick={() => toggleLot(batchIdx, lot.lotNo)}
                        className={`w-full text-left p-3 rounded-xl border transition ${
                          selected ? 'border-purple-500 bg-purple-900/20' : 'border-gray-600 bg-gray-800 hover:border-gray-500'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="font-bold text-gray-100">{lot.lotNo}</span>
                            <span className="text-xs text-gray-400 ml-2">{lot.quality}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-gray-200">{lot.foldAvailable} than</span>
                            {selected && <span className="text-purple-400">&#10003;</span>}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                  {availableLots.length === 0 && (
                    <p className="text-xs text-gray-500 text-center py-2">No lots available for this batch</p>
                  )}
                </div>

                {/* Batch actions */}
                {availableLots.length > 0 && (
                  <div className="flex items-center justify-between">
                    <div className="flex gap-2">
                      <button onClick={() => selectAllForBatch(batchIdx)} className="text-xs text-purple-400 hover:text-purple-300">Select All</button>
                      <button onClick={() => clearBatchLots(batchIdx)} className="text-xs text-gray-400 hover:text-gray-300">Clear</button>
                    </div>
                    <span className="text-xs text-gray-400">
                      {batch.lots.length} lots &middot; {batchThan} than
                    </span>
                  </div>
                )}
              </div>
            )
          })}

          {/* Add batch button */}
          <button
            onClick={addBatch}
            className="w-full py-2 text-sm text-purple-400 hover:text-purple-300 border border-dashed border-gray-600 rounded-xl hover:border-gray-500 transition"
          >
            + Add Batch {foldBatches.length + 1}
          </button>

          {/* Summary */}
          <div className="border border-gray-600 rounded-xl p-3 space-y-2 bg-gray-900/50">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Fold No:</span>
              <input
                type="text"
                value={foldNo}
                onChange={e => setFoldNo(e.target.value)}
                className="flex-1 bg-gray-800 text-gray-100 text-sm rounded-lg px-3 py-1.5 outline-none border border-gray-600 focus:border-purple-500"
              />
            </div>
            <div className="text-xs text-gray-400">
              {validBatchCount} batch(es) &middot; {totalSelectedLots} lots &middot; {totalSelectedThan} than
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleCreateFold}
                disabled={validBatchCount === 0 || creatingFold || !foldNo.trim()}
                className="flex-1 py-2 text-sm font-medium bg-purple-600 hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl transition"
              >
                {creatingFold ? 'Creating...' : 'Create Fold'}
              </button>
              <button
                onClick={cancelFold}
                className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 border border-gray-600 rounded-xl hover:border-gray-500 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* Messages */
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {messages.length === 0 && (
            <div className="text-center text-gray-500 text-sm mt-8">
              <p className="mb-3">Hello! I can help you with:</p>
              <div className="space-y-1 text-xs text-gray-400">
                <p>&bull; Stock / lot information</p>
                <p>&bull; Dyeing slips & production</p>
                <p>&bull; Outstanding balances</p>
                <p>&bull; Shade recipes</p>
                <p>&bull; Grey inward & despatch</p>
                <p>&bull; Create fold programs</p>
              </div>
              <p className="mt-3 text-gray-500">Hindi ya English mein poochiye!</p>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words ${
                  msg.role === 'user'
                    ? 'bg-purple-600 text-white rounded-br-md'
                    : 'bg-gray-700 text-gray-100 rounded-bl-md'
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-gray-700 rounded-2xl rounded-bl-md px-4 py-3">
                <div className="flex gap-1.5">
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Input — hidden during fold mode */}
      {!foldMode && (
        <div className="px-3 py-3 border-t border-gray-700 bg-gray-800 flex-shrink-0">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={listening ? 'Listening...' : 'Type or speak...'}
              disabled={loading}
              className={`flex-1 bg-gray-700 text-gray-100 text-sm rounded-xl px-4 py-2.5 outline-none placeholder-gray-400 focus:ring-2 focus:ring-purple-500 border disabled:opacity-50 ${listening ? 'border-red-500 ring-2 ring-red-500/50' : 'border-gray-600'}`}
            />
            {hasSpeech && (
              <button
                onClick={listening ? stopListening : startListening}
                disabled={loading}
                className={`w-10 h-10 rounded-xl flex items-center justify-center transition flex-shrink-0 ${
                  listening
                    ? 'bg-red-600 hover:bg-red-700 animate-pulse'
                    : 'bg-gray-600 hover:bg-gray-500'
                } disabled:opacity-40`}
                aria-label={listening ? 'Stop listening' : 'Voice input'}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 1a4 4 0 00-4 4v7a4 4 0 008 0V5a4 4 0 00-4-4z" />
                  <path d="M19 10v2a7 7 0 01-14 0v-2a1 1 0 112 0v2a5 5 0 0010 0v-2a1 1 0 112 0z" />
                  <path d="M11 19.93V22a1 1 0 102 0v-2.07A7.01 7.01 0 0019 13v-1a1 1 0 10-2 0v1a5 5 0 01-10 0v-1a1 1 0 10-2 0v1a7.01 7.01 0 006 6.93z" />
                </svg>
              </button>
            )}
            <button
              onClick={() => sendMessage()}
              disabled={loading || !input.trim()}
              className="w-10 h-10 bg-purple-600 rounded-xl flex items-center justify-center hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed transition flex-shrink-0"
              aria-label="Send message"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
