'use client'

import { useState, useRef, useCallback } from 'react'
import { BluetoothPrinter } from '@/lib/bluetooth-printer'

interface SlipLot {
  lotNo: string
  than: number
}

interface SlipChemical {
  name: string
  quantity: number | null
  unit: string
  processTag: string | null
}

interface SlipAddition {
  roundNo: number
  type: string
  defectType: string | null
  reason: string | null
  machineName: string | null
  operatorName: string | null
  chemicals: { name: string; quantity: number | null; unit: string }[]
}

interface SlipData {
  slipNo: number
  date: string
  partyName: string | null
  shadeName: string | null
  machineName: string | null
  operatorName: string | null
  lots: SlipLot[]
  totalThan: number
  chemicals: SlipChemical[]
  isReDyed: boolean
  totalRounds: number
  additions: SlipAddition[]
  roundParam: string | number // 1, 2, 'all'
}

type PrintState = 'idle' | 'connecting' | 'printing' | 'done' | 'error'

function getPrintSettings() {
  try {
    const raw = localStorage.getItem('print-settings')
    if (!raw) return { headerSize: 'normal' as const, lotSize: 'normal' as const, chemSize: 'normal' as const }
    const s = JSON.parse(raw)
    return {
      headerSize: (s.headerFontSize >= 20 ? 'large' : 'normal') as 'large' | 'normal',
      lotSize: (s.lotFontSize >= 16 ? 'double-height' : 'normal') as 'double-height' | 'normal',
      chemSize: (s.chemFontSize >= 16 ? 'double-height' : 'normal') as 'double-height' | 'normal',
    }
  } catch {
    return { headerSize: 'normal' as const, lotSize: 'normal' as const, chemSize: 'normal' as const }
  }
}

export default function BluetoothPrint({ data }: { data: SlipData }) {
  const [state, setState] = useState<PrintState>('idle')
  const [error, setError] = useState('')
  const [lastPrinter, setLastPrinter] = useState(() => {
    try { return localStorage.getItem('bt-printer-name') || '' } catch { return '' }
  })
  const printerRef = useRef<BluetoothPrinter | null>(null)

  const printSlip = useCallback(async () => {
    setState('connecting')
    setError('')

    try {
      const printer = new BluetoothPrinter()
      printerRef.current = printer
      await printer.connect()

      const name = printer.getDeviceName()
      if (name) {
        setLastPrinter(name)
        try { localStorage.setItem('bt-printer-name', name) } catch {}
      }

      setState('printing')
      const settings = getPrintSettings()
      const W = 32 // 58mm receipt width

      await printer.init()

      // Header
      await printer.printCentered('================================', false, 'normal')
      await printer.printCentered('KOTHARI SYNTHETIC INDUSTRIES', true, settings.headerSize)
      const showRound = data.roundParam
      const showingSpecificRound = typeof showRound === 'number' && showRound > 1
      const subtitle = showingSpecificRound
        ? `Re-Dye Slip (Round ${showRound})`
        : showRound === 'all'
          ? 'Dyeing Report (All Rounds)'
          : 'Dyeing Slip'
      await printer.printCentered(subtitle)
      if (data.isReDyed && !showingSpecificRound && showRound !== 'all') {
        await printer.printCentered(`RE-DYED (${data.totalRounds} rounds)`)
      }
      await printer.printCentered('================================', false, 'normal')

      // Slip info
      await printer.printKeyValue(`Slip: ${data.slipNo}`, `Date: ${data.date}`, W)
      if (data.partyName) await printer.printText(`Party: ${data.partyName}`)
      if (data.shadeName) await printer.printText(`Shade: ${data.shadeName}`)

      // Machine & Operator - find from specific addition if needed
      const specificAddition = showingSpecificRound
        ? data.additions.find(a => a.roundNo === showRound)
        : null
      const machine = showingSpecificRound && specificAddition?.machineName
        ? specificAddition.machineName
        : data.machineName
      const operator = showingSpecificRound && specificAddition?.operatorName
        ? specificAddition.operatorName
        : data.operatorName
      if (machine || operator) {
        const parts: string[] = []
        if (machine) parts.push(`M: ${machine}`)
        if (operator) parts.push(`Op: ${operator}`)
        await printer.printText(parts.join('  '))
      }

      if (showingSpecificRound && specificAddition?.defectType) {
        await printer.printText(`Defect: ${specificAddition.defectType}`)
        if (specificAddition.reason) await printer.printText(`Reason: ${specificAddition.reason}`)
      }

      await printer.printDivider('-', W)

      // Lots
      await printer.printLine('LOTS:', true, settings.lotSize)
      for (const l of data.lots) {
        await printer.printKeyValue(`  ${l.lotNo}`, `${l.than} than`, W)
      }
      if (data.lots.length > 1) {
        await printer.printKeyValue('  Total:', `${data.totalThan} than`, W)
      }
      await printer.printDivider('-', W)

      // Group chemicals by processTag
      const grouped: Record<string, SlipChemical[]> = {}
      for (const c of data.chemicals) {
        const tag = c.processTag || '_other'
        if (!grouped[tag]) grouped[tag] = []
        grouped[tag].push(c)
      }
      const tagOrder = Object.keys(grouped).sort((a, b) => {
        if (a === 'shade') return -1
        if (b === 'shade') return 1
        if (a === '_other') return 1
        if (b === '_other') return -1
        return a.localeCompare(b)
      })

      // Print chemicals based on round param
      const printChemTable = async (chems: { name: string; quantity: number | null; unit: string }[]) => {
        for (const c of chems) {
          const qty = c.quantity != null ? `${c.quantity} ${c.unit}` : '---'
          await printer.printKeyValue(`  ${c.name}`, qty, W)
        }
      }

      // Round 1 or all
      if (showRound === 1 || showRound === 'all') {
        if (showRound === 'all') {
          await printer.printLine('ROUND 1 (Original)', true, 'normal')
        }
        for (const tag of tagOrder) {
          const label = tag === 'shade' ? 'SHADE CHEMICALS' : tag === '_other' ? 'OTHER CHEMICALS' : tag.toUpperCase()
          await printer.printLine(label, true, 'normal')
          await printChemTable(grouped[tag])
          await printer.printDivider('-', W)
        }
        if (data.chemicals.length === 0) {
          await printer.printText('No chemicals recorded.')
        }
      }

      // Specific round > 1
      if (showingSpecificRound && specificAddition) {
        await printer.printLine(`RE-DYE CHEMICALS (Round ${showRound})`, true, 'normal')
        if (specificAddition.chemicals.length > 0) {
          await printChemTable(specificAddition.chemicals)
        } else {
          await printer.printText('No chemicals for this round.')
        }
        await printer.printDivider('-', W)
      }

      // All rounds - additions
      if (showRound === 'all') {
        for (const a of data.additions) {
          const typeLabel = a.type === 're-dye' ? 'Re-Dye' : 'Addition'
          await printer.printLine(`ROUND ${a.roundNo} (${typeLabel})${a.defectType ? ` - ${a.defectType}` : ''}`, true, 'normal')
          if (a.reason) await printer.printText(`Reason: ${a.reason}`)
          if (a.machineName || a.operatorName) {
            const parts: string[] = []
            if (a.machineName) parts.push(`M: ${a.machineName}`)
            if (a.operatorName) parts.push(`Op: ${a.operatorName}`)
            await printer.printText(parts.join('  '))
          }
          if (a.chemicals.length > 0) {
            await printChemTable(a.chemicals)
          } else {
            await printer.printText('No chemicals.')
          }
          await printer.printDivider('-', W)
        }
      }

      // Total chemicals count
      let totalChemCount = 0
      if (showRound === 1 || showRound === 'all') totalChemCount += data.chemicals.length
      if (showingSpecificRound && specificAddition) totalChemCount += specificAddition.chemicals.length
      if (showRound === 'all') {
        for (const a of data.additions) totalChemCount += a.chemicals.length
      }
      await printer.printCentered('================================', false, 'normal')
      await printer.printText(`Total: ${totalChemCount} chemicals`)

      // Signature lines
      await printer.feedLines(2)
      await printer.printText('Operator: ____________')
      await printer.printText('')
      await printer.printText('Supervisor: ____________')

      // Feed and cut
      await printer.cut()
      await printer.disconnect()

      setState('done')
      setTimeout(() => setState('idle'), 3000)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      if (msg.includes('cancelled') || msg.includes('canceled') || msg.includes('User cancelled')) {
        setState('idle')
        return
      }
      setError(msg)
      setState('error')
      if (printerRef.current) {
        try { await printerRef.current.disconnect() } catch {}
      }
    }
  }, [data])

  return (
    <div className="inline-flex flex-col items-center">
      {state === 'idle' && (
        <button
          onClick={printSlip}
          className="bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-2"
        >
          <span>Bluetooth Print</span>
        </button>
      )}
      {state === 'connecting' && (
        <button disabled className="bg-blue-500 text-white px-6 py-2 rounded-lg text-sm font-medium opacity-75 cursor-wait">
          Connecting...
        </button>
      )}
      {state === 'printing' && (
        <button disabled className="bg-blue-500 text-white px-6 py-2 rounded-lg text-sm font-medium opacity-75 cursor-wait">
          Printing...
        </button>
      )}
      {state === 'done' && (
        <button disabled className="bg-green-600 text-white px-6 py-2 rounded-lg text-sm font-medium">
          Printed!
        </button>
      )}
      {state === 'error' && (
        <div className="flex flex-col items-center gap-2">
          <button
            onClick={printSlip}
            className="bg-red-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-red-700"
          >
            Retry Bluetooth Print
          </button>
          <span className="text-xs text-red-500 max-w-[200px] text-center">{error}</span>
        </div>
      )}
      {lastPrinter && state === 'idle' && (
        <span className="text-[10px] text-gray-400 mt-1">Last: {lastPrinter}</span>
      )}
    </div>
  )
}
