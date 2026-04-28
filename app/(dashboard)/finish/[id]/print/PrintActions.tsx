'use client'

import { useState, useCallback, useRef } from 'react'

interface SlipInfo {
  slipNo: number
  shadeName: string | null
  shadeDesc: string | null
  lots: { lotNo: string; than: number }[]
}

interface FoldGroup {
  foldNo: string
  slips: SlipInfo[]
}

interface PrintData {
  slipNo: number
  date: string
  partyName: string | null
  qualityName: string | null
  foldGroups: FoldGroup[]
  lotSummary: { lotNo: string; than: number }[]
  totalThan: number
  totalMeter: number | null
  chemicals: { name: string; quantity: number | null; unit: string }[]
  notes: string | null
}

// ── WhatsApp formatted text ──────────────────────────────────────────

function buildWhatsAppText(data: PrintData): string {
  const lines: string[] = []
  lines.push('🏭 *KOTHARI SYNTHETIC INDUSTRIES*')
  lines.push('✨ *Finish Program*')
  lines.push('━━━━━━━━━━━━━━━━━━')
  lines.push(`📅 Date: ${data.date}`)
  if (data.partyName) lines.push(`👤 Party: ${data.partyName}`)
  if (data.qualityName) lines.push(`🏷️ Quality: ${data.qualityName}`)
  lines.push('')
  lines.push(`*Finish Prg No: ${data.slipNo}*`)

  // Lot Summary — same block that appears at the top of the print page
  if (data.lotSummary && data.lotSummary.length > 0) {
    lines.push('')
    lines.push('📋 *Lot Summary*')
    const longest = data.lotSummary.reduce((m, l) => Math.max(m, l.lotNo.length), 0)
    for (const l of data.lotSummary) {
      lines.push(`  ${l.lotNo.padEnd(longest)}  ${l.than}`)
    }
    lines.push(`  ${'Total'.padEnd(longest)}  ${data.totalThan}`)
  }

  for (const fg of data.foldGroups) {
    lines.push('')
    lines.push(`📁 *Fold No: ${fg.foldNo}*`)
    for (const slip of fg.slips) {
      const shade = [slip.shadeName, slip.shadeDesc].filter(Boolean).join(' — ')
      lines.push(`• Slip ${slip.slipNo}${shade ? ` — ${shade}` : ''}`)
      for (const lot of slip.lots) {
        lines.push(`  ${lot.lotNo} (${lot.than} than)`)
      }
    }
  }

  lines.push('')
  lines.push(`📊 *Total: ${data.totalThan} than*`)
  if (data.totalMeter) lines.push(`📏 *Total Meter: ${data.totalMeter}*`)

  if (data.chemicals.length > 0) {
    lines.push('')
    lines.push('🧪 *Chemicals (per 100 Litres)*')
    data.chemicals.forEach((c, i) => {
      const qty = c.quantity != null ? Number(c.quantity).toFixed(1) : '—'
      lines.push(`${i + 1}. ${c.name} — ${qty} ${c.unit}`)
    })
  }

  if (data.notes) {
    lines.push('')
    lines.push(`📝 Notes: ${data.notes}`)
  }

  return lines.join('\n')
}

// ── Bluetooth receipt text ───────────────────────────────────────────

function buildReceipt(data: PrintData, width = 32): string {
  const lines: string[] = []
  const div = (ch = '-') => ch.repeat(width)
  const center = (t: string) => {
    const pad = Math.max(0, Math.floor((width - t.length) / 2))
    return ' '.repeat(pad) + t
  }
  const kv = (k: string, v: string) => {
    const pad = width - k.length - v.length
    return k + ' '.repeat(Math.max(1, pad)) + v
  }

  lines.push(div('='))
  lines.push(center('KOTHARI SYNTHETIC'))
  lines.push(center('INDUSTRIES'))
  lines.push(center('Finish Program'))
  lines.push(div('='))

  lines.push(kv('Prg No:', String(data.slipNo)))
  lines.push(kv('Date:', data.date))
  if (data.partyName) lines.push(kv('Party:', data.partyName.substring(0, width - 8)))
  if (data.qualityName) lines.push(kv('Quality:', data.qualityName.substring(0, width - 10)))
  lines.push(div())

  if (data.lotSummary && data.lotSummary.length > 0) {
    lines.push('LOT SUMMARY')
    lines.push(div())
    for (const l of data.lotSummary) {
      lines.push(kv(`  ${l.lotNo}`, `${l.than}T`))
    }
    lines.push(kv('  Total', `${data.totalThan}T`))
    lines.push(div())
  }

  for (const fg of data.foldGroups) {
    lines.push(`Fold: ${fg.foldNo}`)
    for (const slip of fg.slips) {
      const shade = slip.shadeName || ''
      lines.push(`  Slip ${slip.slipNo} ${shade}`)
      for (const lot of slip.lots) {
        lines.push(kv(`    ${lot.lotNo}`, `${lot.than}T`))
      }
    }
    lines.push('')
  }

  lines.push(div())
  lines.push(kv('Total Than:', String(data.totalThan)))
  if (data.totalMeter) lines.push(kv('Total Meter:', String(data.totalMeter)))
  lines.push(div())

  if (data.chemicals.length > 0) {
    lines.push('CHEMICALS (per 100L)')
    lines.push(div())
    for (const c of data.chemicals) {
      const qty = c.quantity != null ? Number(c.quantity).toFixed(1) : '---'
      lines.push(kv(`  ${c.name}`, `${qty} ${c.unit}`))
    }
    lines.push(div())
  }

  if (data.notes) {
    lines.push(`Note: ${data.notes}`)
    lines.push(div())
  }

  lines.push('')
  lines.push(center('--- End ---'))
  lines.push('')
  lines.push('')
  lines.push('')

  return lines.join('\n')
}

export default function PrintActions({ data }: { data: PrintData }) {
  // ── WhatsApp share ─────────────────────────────────────────────────
  function shareWhatsApp() {
    const text = buildWhatsAppText(data)
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`
    window.open(url, '_blank')
  }

  // ── Bluetooth print ────────────────────────────────────────────────
  const [btState, setBtState] = useState<'idle' | 'printing' | 'done' | 'error'>('idle')
  const [btError, setBtError] = useState('')
  const printerRef = useRef<any>(null)

  const printBluetooth = useCallback(async () => {
    setBtState('printing')
    setBtError('')
    try {
      const { BluetoothPrinter } = await import('@/lib/bluetooth-printer')
      if (!printerRef.current) {
        printerRef.current = new BluetoothPrinter()
      }
      const printer = printerRef.current
      const savedId = typeof localStorage !== 'undefined' ? localStorage.getItem('bt-printer-id') || undefined : undefined
      await printer.smartConnect(savedId)
      if (printer.deviceId) localStorage.setItem('bt-printer-id', printer.deviceId)
      await printer.init()

      const W = 32

      // Header
      await printer.printCentered('================================', false, 'normal')
      await printer.printCentered('KOTHARI SYNTHETIC', true, 'double-height')
      await printer.printCentered('INDUSTRIES', true, 'double-height')
      await printer.printCentered('Finish Program', true, 'normal')
      await printer.printCentered('================================', false, 'normal')

      // Info
      await printer.printKeyValue(`Prg: ${data.slipNo}`, data.date, W)
      if (data.partyName) await printer.printText(`Party: ${data.partyName}`)
      if (data.qualityName) await printer.printText(`Quality: ${data.qualityName}`)
      await printer.printDivider('-', W)

      // Lot Summary — printed before the fold/slip detail
      if (data.lotSummary && data.lotSummary.length > 0) {
        await printer.printLine('LOT SUMMARY', true, 'normal')
        await printer.printDivider('-', W)
        for (const l of data.lotSummary) {
          const valStr = `${l.than}T`
          const pad = Math.max(1, W - 2 - l.lotNo.length - valStr.length)
          await printer.printLine(`  ${l.lotNo}${' '.repeat(pad)}${valStr}`, false, 'normal')
        }
        const tValStr = `${data.totalThan}T`
        const tPad = Math.max(1, W - 2 - 'Total'.length - tValStr.length)
        await printer.printLine(`  Total${' '.repeat(tPad)}${tValStr}`, true, 'normal')
        await printer.printDivider('-', W)
      }

      // Fold → Slip → Lots
      for (const fg of data.foldGroups) {
        await printer.printLine(`Fold: ${fg.foldNo}`, true, 'normal')
        for (const slip of fg.slips) {
          const shade = slip.shadeName || ''
          await printer.printText(`  Slip ${slip.slipNo} ${shade}`)
          for (const lot of slip.lots) {
            const lotPad = Math.max(1, W - 6 - lot.lotNo.length - String(lot.than).length - 1)
            await printer.printLine(`    ${lot.lotNo}${' '.repeat(lotPad)}${lot.than}T`, false, 'normal')
          }
        }
      }

      await printer.printDivider('-', W)
      const totalStr = `Total: ${data.totalThan} than`
      await printer.printLine(totalStr, true, 'normal')
      if (data.totalMeter) await printer.printText(`Meter: ${data.totalMeter}`)
      await printer.printDivider('-', W)

      // Chemicals
      if (data.chemicals.length > 0) {
        await printer.printLine('CHEMICALS (per 100L)', true, 'normal')
        await printer.printDivider('-', W)
        for (const c of data.chemicals) {
          const qty = c.quantity != null ? Number(c.quantity).toFixed(1) : '---'
          const valStr = `${qty} ${c.unit}`
          const pad = Math.max(1, W - 2 - c.name.length - valStr.length)
          await printer.printLine(`  ${c.name}${' '.repeat(pad)}${valStr}`, false, 'normal')
        }
        await printer.printDivider('-', W)
      }

      if (data.notes) await printer.printText(`Note: ${data.notes}`)

      await printer.printCentered('================================')
      await printer.feedLines(1)
      await printer.cut()
      await printer.disconnect()

      setBtState('done')
      setTimeout(() => setBtState('idle'), 3000)
    } catch (err: any) {
      setBtError(err?.message || 'Bluetooth print failed')
      setBtState('error')
      setTimeout(() => setBtState('idle'), 5000)
    }
  }, [data])

  return (
    <>
      <button
        onClick={() => window.print()}
        className="bg-purple-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-purple-700"
      >
        🖨️ Print
      </button>

      <button
        onClick={printBluetooth}
        disabled={btState === 'printing'}
        className="bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
      >
        {btState === 'printing' ? 'Printing...' : btState === 'done' ? '✓ Printed' : btState === 'error' ? 'Retry' : '🖨️ Bluetooth Print'}
      </button>

      <button
        onClick={shareWhatsApp}
        className="bg-green-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-green-700 flex items-center gap-2"
      >
        📱 Share WhatsApp
      </button>

      {btError && <p className="text-xs text-red-500 w-full text-center mt-1">{btError}</p>}
    </>
  )
}
