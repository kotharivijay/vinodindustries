'use client'

import { useState, useCallback, useRef, useEffect } from 'react'

interface SlipLot { lotNo: string; than: number; marka?: string | null }
interface SlipChemical { name: string; quantity: number | null; unit: string; processTag: string | null }
interface SlipAddition {
  roundNo: number; type: string; defectType: string | null; reason: string | null
  machineName: string | null; operatorName: string | null
  chemicals: { name: string; quantity: number | null; unit: string }[]
}
interface SlipData {
  slipNo: number; date: string; partyName: string | null; shadeName: string | null
  shadeDescription?: string | null; qualityName?: string | null
  machineName: string | null; operatorName: string | null; marka?: string | null
  isPcJob?: boolean
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
  const subtitle = showingSpecific ? `Re-Dye Slip (Round ${showRound})` : showRound === 'all' ? 'Dyeing Report (All Rounds)' : data.isPcJob ? 'PC Dyeing Slip' : 'Dyeing Slip'
  lines.push(center(subtitle))
  if (data.isReDyed && !showingSpecific && showRound !== 'all') lines.push(center(`RE-DYED (${data.totalRounds} rounds)`))
  lines.push(div('='))

  lines.push(kv(`Slip: ${data.slipNo}`, `Date: ${data.date}`))
  if (data.partyName) lines.push(`Party: ${data.partyName}`)
  if (data.qualityName) lines.push(`Quality: ${data.qualityName}`)
  if (data.marka) lines.push(`Marka: ${data.marka}`)
  if (data.shadeName) lines.push(`Shade: ${data.shadeName}${data.shadeDescription ? ` - ${data.shadeDescription}` : ''}`)

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

// Build hydro slip (no chemicals/shade/process — just lots)
function buildHydroReceipt(data: SlipData, width = 32): string {
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

  lines.push(div('='))
  lines.push(center('KOTHARI SYNTHETIC'))
  lines.push(center('INDUSTRIES'))
  lines.push(center('HYDRO SLIP'))
  lines.push(div('='))

  lines.push(kv(`Slip: ${data.slipNo}`, `${data.date}`))
  if (data.partyName) lines.push(`Party: ${data.partyName}`)
  if (data.qualityName) lines.push(`Quality: ${data.qualityName}`)
  if (data.marka) lines.push(`Marka: ${data.marka}`)
  if (data.shadeName) lines.push(`Shade: ${data.shadeName}${data.shadeDescription ? ` - ${data.shadeDescription}` : ''}`)
  if (data.machineName) lines.push(`Machine: ${data.machineName}`)
  lines.push(div())

  // Lots
  lines.push('LOTS:')
  for (const l of data.lots) lines.push(kv(`  ${l.lotNo}`, `${l.than} than`))
  if (data.lots.length > 1) lines.push(kv('  Total:', `${data.totalThan} than`))

  lines.push(div('='))
  lines.push('')
  lines.push('Operator: ____________')
  lines.push('')
  lines.push('')

  return lines.join('\n')
}

type PrintState = 'idle' | 'printing' | 'done' | 'error'

export default function BluetoothPrint({ data, autoMode }: { data: SlipData; autoMode?: string }) {
  const [state, setState] = useState<PrintState>('idle')
  const [error, setError] = useState('')
  const [hydroMode, setHydroMode] = useState(false)
  const autoTriggered = useRef(false)

  // Method 1: RawBT intent (most reliable for Android)
  const printViaRawBT = useCallback((hydro = false) => {
    setState('printing')
    try {
      const receipt = hydro ? buildHydroReceipt(data) : buildReceipt(data)
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
  const printViaShare = useCallback(async (hydro = false) => {
    setState('printing')
    try {
      const receipt = hydro ? buildHydroReceipt(data) : buildReceipt(data)
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
      printer.startBatch()

      // Read all print settings
      let headerSize = 18, lotSize = 14, chemSize = 12, labelSize = 13
      let boldChemName = true, boldQuantity = true, boldLotNo = true
      let dotLeaders = true, paperW = 80
      try {
        const raw = localStorage.getItem('print-settings')
        if (raw) {
          const ps = JSON.parse(raw)
          headerSize = ps.headerFontSize || 18
          lotSize = ps.lotFontSize || 14
          chemSize = ps.chemFontSize || 12
          labelSize = ps.labelFontSize || 13
          if (ps.boldChemName !== undefined) boldChemName = ps.boldChemName
          if (ps.boldQuantity !== undefined) boldQuantity = ps.boldQuantity
          if (ps.boldLotNo !== undefined) boldLotNo = ps.boldLotNo
          if (ps.dotLeaders !== undefined) dotLeaders = ps.dotLeaders
          if (ps.paperWidth) paperW = ps.paperWidth
        }
      } catch {}

      // Map px to ESC/POS: >= 28 = large (4x), >= 20 = double, < 20 = normal
      const toEscSize = (px: number): 'normal' | 'double-height' | 'large' =>
        px >= 28 ? 'large' : px >= 20 ? 'double-height' : 'normal'

      const W = paperW === 58 ? 32 : 48
      const dot = dotLeaders ? '.' : ' '

      // Header — reverse (white on black)
      await printer.printReverseCentered(' KOTHARI SYNTHETIC INDUSTRIES ', true, toEscSize(headerSize))
      const showRound = data.roundParam
      const showingSpecific = typeof showRound === 'number' && showRound > 1
      const specificAdd = showingSpecific ? data.additions.find(a => a.roundNo === showRound) : null
      const subtitle = showingSpecific ? `Re-Dye (Round ${showRound})` : showRound === 'all' ? 'All Rounds' : data.isPcJob ? 'PC Dyeing Slip' : 'Dyeing Slip'
      await printer.printCentered(subtitle, true, 'normal')
      if (data.isReDyed && !showingSpecific && showRound !== 'all') {
        await printer.printCentered(`RE-DYED (${data.totalRounds}x)`, true, 'normal')
      }
      await printer.printDivider('=', W)

      // Info
      await printer.printKeyValue(`Slip: ${data.slipNo}`, `${data.date}`, W)
      if (data.partyName) await printer.printText(`Party: ${data.partyName}`)
      if (data.qualityName) await printer.printText(`Quality: ${data.qualityName}`)
      if (data.marka) await printer.printText(`Marka: ${data.marka}`)
      if (data.shadeName) await printer.printText(`Shade: ${data.shadeName}${data.shadeDescription ? ` - ${data.shadeDescription}` : ''}`)
      const machine = showingSpecific && specificAdd?.machineName ? specificAdd.machineName : data.machineName
      const operator = showingSpecific && specificAdd?.operatorName ? specificAdd.operatorName : data.operatorName
      if (machine || operator) {
        const parts: string[] = []
        if (machine) parts.push(`M:${machine}`)
        if (operator) parts.push(`Op:${operator}`)
        await printer.printText(parts.join(' '))
      }
      await printer.printDivider('-', W)

      // Lots
      const lotEsc = toEscSize(lotSize)
      const lotW = lotEsc === 'large' ? Math.floor(W / 2) : W
      await printer.printReverse(' LOTS ', true, 'normal')
      for (const l of data.lots) {
        const lotLabel = l.marka ? `${l.lotNo} [${l.marka}]` : l.lotNo
        const thanStr = `${l.than} than`
        const lotPad = Math.max(1, lotW - 2 - lotLabel.length - thanStr.length)
        await printer.printLine(`  ${lotLabel}${' '.repeat(lotPad)}${thanStr}`, boldLotNo, lotEsc)
      }
      if (data.lots.length > 1) {
        await printer.underlineOn(true)
        const totalStr = `${data.totalThan} than`
        const totalPad = Math.max(1, lotW - 2 - 6 - totalStr.length)
        await printer.printLine(`  Total:${' '.repeat(totalPad)}${totalStr}`, true, lotEsc)
        await printer.underlineOff()
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

      // Use Font B for chemicals (smaller, fits more per line — 56 chars on 80mm)
      const chemW = 56

      const printChem = async (c: { name: string; quantity: number | null; unit: string }, isDye: boolean) => {
        let qty = '---'
        if (c.quantity != null) {
          if (isDye) {
            qty = String(Math.round(c.quantity * 1000)).padStart(4, '0') + ' gm'
          } else {
            qty = c.quantity.toFixed(1) + ' kg'
          }
        }

        const maxName = chemW - 2 - qty.length - 1
        const nameStr = c.name.length > maxName ? c.name.slice(0, maxName) : c.name
        const pad = Math.max(1, chemW - 2 - nameStr.length - qty.length)
        const line = '  ' + nameStr + dot.repeat(pad) + qty

        await printer.setFontB()
        await printer.printLine(line, boldChemName || boldQuantity, 'normal')
        await printer.setFontA()
      }

      // Round 1
      if (showRound === 1 || showRound === 'all') {
        if (showRound === 'all') await printer.printReverse(' ROUND 1 (Original) ', true, 'normal')
        for (const tag of tagOrder) {
          const isDye = tag === 'shade'
          const label = isDye ? ' DYES (grams) ' : tag === '_other' ? ' OTHER (kg) ' : ` ${tag.toUpperCase()} (kg) `
          await printer.printReverse(label, true, 'normal')
          for (const c of grouped[tag]) await printChem(c, isDye)
          await printer.printDivider('-', W)
        }
      }

      // Specific round
      if (showingSpecific && specificAdd) {
        await printer.printReverse(` RE-DYE (Round ${showRound}) `, true, 'normal')
        for (const c of specificAdd.chemicals) await printChem(c, true)
        await printer.printDivider('-', W)
      }

      // All rounds additions
      if (showRound === 'all') {
        for (const a of data.additions) {
          const lbl = a.type === 're-dye' ? 'Re-Dye' : 'Addition'
          await printer.printLine(`ROUND ${a.roundNo} (${lbl})`, true, toEscSize(chemSize))
          for (const c of a.chemicals) await printChem(c, false)
          await printer.printDivider('-', W)
        }
      }

      await printer.printDivider('=', W)
      await printer.feedLines(1)
      await printer.printText('Operator: ____________')
      await printer.printText('')
      await printer.printText('Supervisor: ____________')
      await printer.feedLines(1)

      // QR Code — link to first lot's tracking page
      if (data.lots.length > 0) {
        const lotUrl = `https://vinodindustries.vercel.app/lot/${encodeURIComponent(data.lots[0].lotNo)}`
        await printer.printCentered('', false, 'normal')
        await printer.printQRCode(lotUrl, 5)
        await printer.setFontB()
        await printer.printCentered(`Scan: ${data.lots[0].lotNo}`, false, 'normal')
        await printer.setFontA()
      }

      await printer.feedLines(1)
      await printer.cut()

      // Flush all batched data in one fast transfer
      await printer.flushBatch()
      await printer.disconnect()

      setState('done')
      setHydroMode(false)
      setTimeout(() => setState('idle'), 3000)
    } catch (err: any) {
      if (err.message?.includes('cancel')) { setState('idle'); return }
      try { localStorage.removeItem('bt-printer-id') } catch {}
      printerRef.current = null
      setError(err.message || 'Bluetooth error')
      setState('error')
    }
  }, [data])

  // Hydro Bluetooth print — lots only, no chemicals
  const printHydroViaBluetooth = useCallback(async () => {
    setState('printing')
    setHydroMode(true)
    setError('')
    try {
      const { BluetoothPrinter } = await import('@/lib/bluetooth-printer')
      if (!printerRef.current) printerRef.current = new BluetoothPrinter()
      const printer = printerRef.current

      const savedId = (() => { try { return localStorage.getItem('bt-printer-id') || undefined } catch { return undefined } })()
      await printer.smartConnect(savedId)
      const deviceId = printer.getDeviceId()
      const deviceName = printer.getDeviceName()
      if (deviceId) try { localStorage.setItem('bt-printer-id', deviceId) } catch {}
      if (deviceName) try { localStorage.setItem('bt-printer-name', deviceName) } catch {}

      await printer.init()
      printer.startBatch()

      let lotSize = 14
      let boldLotNo = true
      let paperW = 80
      try {
        const raw = localStorage.getItem('print-settings')
        if (raw) {
          const ps = JSON.parse(raw)
          lotSize = ps.lotFontSize || 14
          if (ps.boldLotNo !== undefined) boldLotNo = ps.boldLotNo
          if (ps.paperWidth) paperW = ps.paperWidth
        }
      } catch {}

      const toEscSize = (px: number): 'normal' | 'double-height' | 'large' =>
        px >= 28 ? 'large' : px >= 20 ? 'double-height' : 'normal'
      const W = paperW === 58 ? 32 : 48

      await printer.printCentered('================================', false, 'normal')
      await printer.printCentered('KOTHARI SYNTHETIC', true, 'double-height')
      await printer.printCentered('INDUSTRIES', true, 'double-height')
      await printer.printCentered('HYDRO SLIP', true, 'normal')
      await printer.printCentered('================================', false, 'normal')

      await printer.printKeyValue(`Slip: ${data.slipNo}`, `${data.date}`, W)
      if (data.partyName) await printer.printText(`Party: ${data.partyName}`)
      if (data.qualityName) await printer.printText(`Quality: ${data.qualityName}`)
      if (data.marka) await printer.printText(`Marka: ${data.marka}`)
      if (data.shadeName) await printer.printText(`Shade: ${data.shadeName}${data.shadeDescription ? ` - ${data.shadeDescription}` : ''}`)
      if (data.machineName) await printer.printText(`Machine: ${data.machineName}`)
      await printer.printDivider('-', W)

      const lotEsc = toEscSize(lotSize)
      const lotW = lotEsc === 'large' ? Math.floor(W / 2) : W
      await printer.printLine('LOTS:', true, lotEsc)
      for (const l of data.lots) {
        const lotLabel = l.marka ? `${l.lotNo} [${l.marka}]` : l.lotNo
        const thanStr = `${l.than} than`
        const lotPad = Math.max(1, lotW - 2 - lotLabel.length - thanStr.length)
        await printer.printLine(`  ${lotLabel}${' '.repeat(lotPad)}${thanStr}`, boldLotNo, lotEsc)
      }
      if (data.lots.length > 1) {
        const totalStr = `${data.totalThan} than`
        const totalPad = Math.max(1, lotW - 2 - 6 - totalStr.length)
        await printer.printLine(`  Total:${' '.repeat(totalPad)}${totalStr}`, boldLotNo, lotEsc)
      }

      await printer.printCentered('================================')
      await printer.feedLines(1)
      await printer.cut()

      await printer.flushBatch()
      await printer.disconnect()

      setState('done')
      setHydroMode(false)
      setTimeout(() => setState('idle'), 3000)
    } catch (err: any) {
      if (err.message?.includes('cancel')) { setState('idle'); setHydroMode(false); return }
      try { localStorage.removeItem('bt-printer-id') } catch {}
      printerRef.current = null
      setError(err.message || 'Bluetooth error')
      setState('error')
      setHydroMode(false)
    }
  }, [data])

  // Auto-trigger BT or Hydro print when ?auto=bt or ?auto=hydro
  useEffect(() => {
    if (!autoMode || autoTriggered.current || btAvailable === false) return
    autoTriggered.current = true
    if (autoMode === 'hydro') {
      setTimeout(() => printHydroViaBluetooth(), 500)
    } else if (autoMode === 'bt') {
      setTimeout(() => printViaBluetooth(), 500)
    }
  }, [autoMode, btAvailable, printHydroViaBluetooth, printViaBluetooth])

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
        <button onClick={() => printViaRawBT(false)} className="bg-red-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-red-700">
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

      {/* Hydro Print: Bluetooth */}
      {btAvailable !== false && (
        <button
          onClick={printHydroViaBluetooth}
          className="bg-cyan-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-cyan-700 flex items-center gap-2"
        >
          <span>💧</span>
          <span>Hydro Print</span>
        </button>
      )}

      {/* Share/Copy fallback */}
      <button
        onClick={() => printViaShare(false)}
        className="text-[10px] text-gray-400 hover:text-gray-300 underline"
      >
        {typeof navigator !== 'undefined' && 'share' in navigator ? 'Share Text' : 'Copy Text'}
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
