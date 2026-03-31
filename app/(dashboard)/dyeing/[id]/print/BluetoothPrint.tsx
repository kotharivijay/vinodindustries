'use client'

import { useState, useCallback } from 'react'

interface SlipLot { lotNo: string; than: number }
interface SlipChemical { name: string; quantity: number | null; unit: string; processTag: string | null }
interface SlipAddition {
  roundNo: number; type: string; defectType: string | null; reason: string | null
  machineName: string | null; operatorName: string | null
  chemicals: { name: string; quantity: number | null; unit: string }[]
}
interface SlipData {
  slipNo: number; date: string; partyName: string | null; shadeName: string | null
  machineName: string | null; operatorName: string | null
  lots: SlipLot[]; totalThan: number; chemicals: SlipChemical[]
  isReDyed: boolean; totalRounds: number; additions: SlipAddition[]
  roundParam: string | number
}

// Build plain text receipt
function buildReceipt(data: SlipData, width = 32): string {
  const lines: string[] = []
  const div = (ch = '-') => ch.repeat(width)
  const kv = (k: string, v: string) => {
    const pad = width - k.length - v.length
    return k + ' '.repeat(Math.max(1, pad)) + v
  }
  const center = (t: string) => {
    const pad = Math.max(0, Math.floor((width - t.length) / 2))
    return ' '.repeat(pad) + t
  }

  const showRound = data.roundParam
  const showingSpecific = typeof showRound === 'number' && showRound > 1
  const specificAdd = showingSpecific ? data.additions.find(a => a.roundNo === showRound) : null

  lines.push(div('='))
  lines.push(center('KOTHARI SYNTHETIC'))
  lines.push(center('INDUSTRIES'))
  const subtitle = showingSpecific ? `Re-Dye Slip (Round ${showRound})` : showRound === 'all' ? 'Dyeing Report (All Rounds)' : 'Dyeing Slip'
  lines.push(center(subtitle))
  if (data.isReDyed && !showingSpecific && showRound !== 'all') lines.push(center(`RE-DYED (${data.totalRounds} rounds)`))
  lines.push(div('='))

  lines.push(kv(`Slip: ${data.slipNo}`, `Date: ${data.date}`))
  if (data.partyName) lines.push(`Party: ${data.partyName}`)
  if (data.shadeName) lines.push(`Shade: ${data.shadeName}`)

  const machine = showingSpecific && specificAdd?.machineName ? specificAdd.machineName : data.machineName
  const operator = showingSpecific && specificAdd?.operatorName ? specificAdd.operatorName : data.operatorName
  if (machine || operator) {
    const parts: string[] = []
    if (machine) parts.push(`M: ${machine}`)
    if (operator) parts.push(`Op: ${operator}`)
    lines.push(parts.join('  '))
  }

  if (showingSpecific && specificAdd?.defectType) {
    lines.push(`Defect: ${specificAdd.defectType}`)
    if (specificAdd.reason) lines.push(`Reason: ${specificAdd.reason}`)
  }

  lines.push(div())

  // Lots
  lines.push('LOTS:')
  for (const l of data.lots) lines.push(kv(`  ${l.lotNo}`, `${l.than} than`))
  if (data.lots.length > 1) lines.push(kv('  Total:', `${data.totalThan} than`))
  lines.push(div())

  // Group chemicals
  const grouped: Record<string, SlipChemical[]> = {}
  for (const c of data.chemicals) {
    const tag = c.processTag || '_other'
    if (!grouped[tag]) grouped[tag] = []
    grouped[tag].push(c)
  }
  const tagOrder = Object.keys(grouped).sort((a, b) => {
    if (a === 'shade') return -1; if (b === 'shade') return 1
    if (a === '_other') return 1; if (b === '_other') return -1
    return a.localeCompare(b)
  })

  const chemLine = (c: { name: string; quantity: number | null; unit: string }) => {
    const qty = c.quantity != null ? `${c.quantity} ${c.unit}` : '---'
    return kv(`  ${c.name}`, qty)
  }

  if (showRound === 1 || showRound === 'all') {
    if (showRound === 'all') lines.push('ROUND 1 (Original)')
    for (const tag of tagOrder) {
      const label = tag === 'shade' ? 'SHADE CHEMICALS' : tag === '_other' ? 'OTHER' : tag.toUpperCase()
      lines.push(label)
      grouped[tag].forEach(c => lines.push(chemLine(c)))
      lines.push(div())
    }
  }

  if (showingSpecific && specificAdd) {
    lines.push(`RE-DYE (Round ${showRound})`)
    specificAdd.chemicals.forEach(c => lines.push(chemLine(c)))
    lines.push(div())
  }

  if (showRound === 'all') {
    for (const a of data.additions) {
      const label = a.type === 're-dye' ? 'Re-Dye' : 'Addition'
      lines.push(`ROUND ${a.roundNo} (${label})${a.defectType ? ` - ${a.defectType}` : ''}`)
      if (a.reason) lines.push(`Reason: ${a.reason}`)
      a.chemicals.forEach(c => lines.push(chemLine(c)))
      lines.push(div())
    }
  }

  lines.push(div('='))
  lines.push('')
  lines.push('Operator: ____________')
  lines.push('')
  lines.push('Supervisor: ____________')
  lines.push('')
  lines.push('')

  return lines.join('\n')
}

type PrintState = 'idle' | 'printing' | 'done' | 'error'

export default function BluetoothPrint({ data }: { data: SlipData }) {
  const [state, setState] = useState<PrintState>('idle')
  const [error, setError] = useState('')

  // Method 1: RawBT intent (most reliable for Android)
  const printViaRawBT = useCallback(() => {
    setState('printing')
    try {
      const receipt = buildReceipt(data)
      const encoded = btoa(unescape(encodeURIComponent(receipt)))
      window.location.href = `rawbt:base64,${encoded}`
      setState('done')
      setTimeout(() => setState('idle'), 3000)
    } catch (err: any) {
      setError(err.message || 'Failed')
      setState('error')
    }
  }, [data])

  // Method 2: Share API (send to any print app)
  const printViaShare = useCallback(async () => {
    setState('printing')
    try {
      const receipt = buildReceipt(data)
      if (navigator.share) {
        await navigator.share({
          title: `Dyeing Slip ${data.slipNo}`,
          text: receipt,
        })
        setState('done')
        setTimeout(() => setState('idle'), 3000)
      } else {
        // Fallback: copy to clipboard
        await navigator.clipboard.writeText(receipt)
        setState('done')
        setTimeout(() => setState('idle'), 3000)
      }
    } catch (err: any) {
      if (err.name === 'AbortError') { setState('idle'); return }
      setError(err.message || 'Failed')
      setState('error')
    }
  }, [data])

  // Method 3: Web Bluetooth
  const [btAvailable, setBtAvailable] = useState<boolean | null>(null)

  // Check on mount
  useState(() => {
    if (typeof navigator !== 'undefined' && 'bluetooth' in navigator) {
      navigator.bluetooth.getAvailability().then(setBtAvailable).catch(() => setBtAvailable(false))
    } else {
      setBtAvailable(false)
    }
  })

  const printViaBluetooth = useCallback(async () => {
    setState('printing')
    setError('')
    try {
      const { BluetoothPrinter } = await import('@/lib/bluetooth-printer')
      const printer = new BluetoothPrinter()
      await printer.connect()

      const receipt = buildReceipt(data)
      await printer.init()

      const encoder = new TextEncoder()
      const lines = receipt.split('\n')
      for (const line of lines) {
        await printer.sendCommand(encoder.encode(line + '\n'))
        await new Promise(r => setTimeout(r, 10))
      }

      await printer.feedLines(3)
      await printer.cut()
      await printer.disconnect()

      setState('done')
      setTimeout(() => setState('idle'), 3000)
    } catch (err: any) {
      if (err.message?.includes('cancel')) { setState('idle'); return }
      setError(err.message || 'Bluetooth error')
      setState('error')
    }
  }, [data])

  if (state === 'done') {
    return (
      <div className="inline-flex flex-col items-center">
        <span className="bg-green-600 text-white px-6 py-2 rounded-lg text-sm font-medium">✅ Sent!</span>
      </div>
    )
  }

  if (state === 'printing') {
    return (
      <div className="inline-flex flex-col items-center">
        <span className="bg-blue-500 text-white px-6 py-2 rounded-lg text-sm font-medium opacity-75">Sending...</span>
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div className="inline-flex flex-col items-center gap-2">
        <button onClick={printViaRawBT} className="bg-red-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-red-700">
          Retry
        </button>
        <span className="text-xs text-red-500 max-w-[200px] text-center">{error}</span>
      </div>
    )
  }

  return (
    <div className="inline-flex flex-col items-center gap-2">
      {/* Primary: Bluetooth Direct */}
      {btAvailable !== false && (
        <button
          onClick={printViaBluetooth}
          className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-2"
        >
          <span>📡</span>
          <span>Bluetooth Print</span>
        </button>
      )}

      {/* Fallback: RawBT */}
      <button
        onClick={printViaRawBT}
        className="bg-green-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-green-700 flex items-center gap-2"
      >
        <span>🖨️</span>
        <span>RawBT Print</span>
      </button>

      {/* Share/Copy */}
      <button
        onClick={printViaShare}
        className="text-[10px] text-gray-400 hover:text-gray-300 underline"
      >
        {typeof navigator !== 'undefined' && 'share' in navigator ? 'Share' : 'Copy Text'}
      </button>

      {btAvailable === false && (
        <span className="text-[9px] text-red-400">Bluetooth not available on this browser</span>
      )}
    </div>
  )
}
