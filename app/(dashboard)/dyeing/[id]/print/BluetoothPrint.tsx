'use client'

import { useState, useCallback, useRef } from 'react'

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

  const chemLine = (c: { name: string; quantity: number | null; unit: string }, isDye: boolean) => {
    let qty = '---'
    if (c.quantity != null) {
      if (isDye) {
        // Dyes: convert kg to grams, 4-digit padded
        const grams = Math.round(c.quantity * 1000)
        qty = String(grams).padStart(4, '0') + ' gm'
      } else {
        // Auxiliary: show in kg
        qty = c.quantity.toFixed(1) + ' kg'
      }
    }
    return kv(`  ${c.name}`, qty)
  }

  if (showRound === 1 || showRound === 'all') {
    if (showRound === 'all') lines.push('ROUND 1 (Original)')
    for (const tag of tagOrder) {
      const isDye = tag === 'shade'
      const label = isDye ? 'DYES (grams)' : tag === '_other' ? 'OTHER (kg)' : tag.toUpperCase() + ' (kg)'
      lines.push(label)
      grouped[tag].forEach(c => lines.push(chemLine(c, isDye)))
      lines.push(div())
    }
  }

  if (showingSpecific && specificAdd) {
    lines.push(`RE-DYE (Round ${showRound})`)
    specificAdd.chemicals.forEach(c => lines.push(chemLine(c, true)))
    lines.push(div())
  }

  if (showRound === 'all') {
    for (const a of data.additions) {
      const label = a.type === 're-dye' ? 'Re-Dye' : 'Addition'
      lines.push(`ROUND ${a.roundNo} (${label})${a.defectType ? ` - ${a.defectType}` : ''}`)
      if (a.reason) lines.push(`Reason: ${a.reason}`)
      a.chemicals.forEach(c => lines.push(chemLine(c, false)))
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

  // Keep printer instance alive for reuse
  const printerRef = useRef<any>(null)

  const printViaBluetooth = useCallback(async () => {
    setState('printing')
    setError('')
    try {
      const { BluetoothPrinter } = await import('@/lib/bluetooth-printer')

      // Reuse existing printer or create new
      if (!printerRef.current) {
        printerRef.current = new BluetoothPrinter()
      }
      const printer = printerRef.current

      // Smart connect: try saved device first, then picker
      const savedId = (() => { try { return localStorage.getItem('bt-printer-id') || undefined } catch { return undefined } })()
      await printer.smartConnect(savedId)

      // Save device ID for next time
      const deviceId = printer.getDeviceId()
      const deviceName = printer.getDeviceName()
      if (deviceId) try { localStorage.setItem('bt-printer-id', deviceId) } catch {}
      if (deviceName) try { localStorage.setItem('bt-printer-name', deviceName) } catch {}

      await printer.init()

      // Read font size settings
      let headerSize = 18, lotSize = 14, chemSize = 12, labelSize = 13
      try {
        const raw = localStorage.getItem('print-settings')
        if (raw) {
          const s = JSON.parse(raw)
          headerSize = s.headerFontSize || 18
          lotSize = s.lotFontSize || 14
          chemSize = s.chemFontSize || 12
          labelSize = s.labelFontSize || 13
        }
      } catch {}

      // Map px to ESC/POS: >= 28 = large (4x), >= 20 = double, < 20 = normal
      const toEscSize = (px: number): 'normal' | 'double-height' | 'large' =>
        px >= 28 ? 'large' : px >= 20 ? 'double-height' : 'normal'

      const W = 32

      // Header
      await printer.printCentered('================================', false, 'normal')
      await printer.printCentered('KOTHARI SYNTHETIC', true, toEscSize(headerSize))
      await printer.printCentered('INDUSTRIES', true, toEscSize(headerSize))
      const showRound = data.roundParam
      const showingSpecific = typeof showRound === 'number' && showRound > 1
      const specificAdd = showingSpecific ? data.additions.find(a => a.roundNo === showRound) : null
      const subtitle = showingSpecific ? `Re-Dye (Round ${showRound})` : showRound === 'all' ? 'All Rounds' : 'Dyeing Slip'
      await printer.printCentered(subtitle, false, 'normal')
      if (data.isReDyed && !showingSpecific && showRound !== 'all') {
        await printer.printCentered(`RE-DYED (${data.totalRounds}x)`, true, 'normal')
      }
      await printer.printCentered('================================', false, 'normal')

      // Info
      await printer.printKeyValue(`Slip: ${data.slipNo}`, `${data.date}`, W)
      if (data.partyName) await printer.printText(`Party: ${data.partyName}`)
      if (data.shadeName) await printer.printText(`Shade: ${data.shadeName}`)
      const machine = showingSpecific && specificAdd?.machineName ? specificAdd.machineName : data.machineName
      const operator = showingSpecific && specificAdd?.operatorName ? specificAdd.operatorName : data.operatorName
      if (machine || operator) {
        const parts: string[] = []
        if (machine) parts.push(`M:${machine}`)
        if (operator) parts.push(`Op:${operator}`)
        await printer.printText(parts.join(' '))
      }
      await printer.printDivider('-', W)

      // Lots — use lot font size
      await printer.printLine('LOTS:', true, toEscSize(lotSize))
      for (const l of data.lots) {
        await printer.printLine(`  ${l.lotNo}  ${l.than} than`, true, toEscSize(lotSize))
      }
      if (data.lots.length > 1) {
        await printer.printLine(`  Total: ${data.totalThan} than`, true, toEscSize(lotSize))
      }
      await printer.printDivider('-', W)

      // Group chemicals
      const grouped: Record<string, typeof data.chemicals> = {}
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

      const printChem = async (c: { name: string; quantity: number | null; unit: string }, isDye: boolean) => {
        let qty = '---'
        if (c.quantity != null) {
          if (isDye) {
            qty = String(Math.round(c.quantity * 1000)).padStart(4, '0') + ' gm'
          } else {
            qty = c.quantity.toFixed(1) + ' kg'
          }
        }
        await printer.printLine(`  ${c.name}  ${qty}`, false, toEscSize(chemSize))
      }

      // Round 1
      if (showRound === 1 || showRound === 'all') {
        if (showRound === 'all') await printer.printLine('ROUND 1 (Original)', true, toEscSize(labelSize))
        for (const tag of tagOrder) {
          const isDye = tag === 'shade'
          const label = isDye ? 'DYES (grams)' : tag === '_other' ? 'OTHER (kg)' : tag.toUpperCase() + ' (kg)'
          await printer.printLine(label, true, toEscSize(labelSize))
          for (const c of grouped[tag]) await printChem(c, isDye)
          await printer.printDivider('-', W)
        }
      }

      // Specific round
      if (showingSpecific && specificAdd) {
        await printer.printLine(`RE-DYE (Round ${showRound})`, true, toEscSize(labelSize))
        for (const c of specificAdd.chemicals) await printChem(c, true)
        await printer.printDivider('-', W)
      }

      // All rounds additions
      if (showRound === 'all') {
        for (const a of data.additions) {
          const lbl = a.type === 're-dye' ? 'Re-Dye' : 'Addition'
          await printer.printLine(`ROUND ${a.roundNo} (${lbl})`, true, toEscSize(labelSize))
          for (const c of a.chemicals) await printChem(c, false)
          await printer.printDivider('-', W)
        }
      }

      await printer.printCentered('================================')
      await printer.printText('')
      await printer.printText('Operator: ____________')
      await printer.printText('')
      await printer.printText('Supervisor: ____________')
      await printer.feedLines(3)
      await printer.cut()
      // Don't fully disconnect — keep for next print
      await printer.disconnect()

      setState('done')
      setTimeout(() => setState('idle'), 3000)
    } catch (err: any) {
      if (err.message?.includes('cancel')) { setState('idle'); return }
      // Clear saved device on error so next time shows picker
      try { localStorage.removeItem('bt-printer-id') } catch {}
      printerRef.current = null
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

      {/* Show saved printer name + forget option */}
      {btAvailable !== false && (() => {
        try {
          const name = localStorage.getItem('bt-printer-name')
          if (!name) return null
          return (
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[9px] text-green-400">Saved: {name}</span>
              <button onClick={() => {
                try { localStorage.removeItem('bt-printer-id'); localStorage.removeItem('bt-printer-name') } catch {}
                printerRef.current = null
                window.location.reload()
              }} className="text-[9px] text-red-400 hover:text-red-300 underline">Forget</button>
            </div>
          )
        } catch { return null }
      })()}
    </div>
  )
}
