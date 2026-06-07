// Bluetooth print helper for Batch Maker slips.
// Layout uses ASCII '[ ]' checkboxes on every lot line so Sanker can tick
// each one off with a pen as he physically pulls the lots from the rack.

interface SavedSlip {
  slipNo: string
  date: string
  batchMakerName: string
  batches: {
    foldNoSnapshot: string
    batchNoSnapshot: number
    shadeNameSnapshot: string | null
    markaSnapshot: string | null
    totalThanSnapshot: number
    totalWeightSnapshot: number | string
    foldBatch: {
      lots: { lotNo: string; than: number }[]
    }
  }[]
}

export function buildBatchMakerReceipt(slip: SavedSlip, width = 32): string {
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

  const dateLabel = new Date(slip.date).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short',
  })

  lines.push(div('='))
  lines.push(center('KOTHARI SYNTHETIC'))
  lines.push(center('INDUSTRIES'))
  lines.push(center('Batch Making Slip'))
  lines.push(div('='))

  lines.push(kv(`Slip: ${slip.slipNo}`, `Date: ${dateLabel}`))
  lines.push(`Maker: ${slip.batchMakerName}`)
  lines.push(div())

  let totalThan = 0
  let totalWeight = 0
  for (const b of slip.batches) {
    lines.push(`Fold ${b.foldNoSnapshot} · B${b.batchNoSnapshot}`)
    if (b.shadeNameSnapshot) lines.push(`  Shade: ${b.shadeNameSnapshot}`)
    if (b.markaSnapshot) lines.push(`  Marka: ${b.markaSnapshot}`)
    for (const l of b.foldBatch.lots) {
      // [ ] LOTNO          N than  — pen-tickable
      const left = `  [ ] ${l.lotNo}`
      const right = `${l.than} than`
      const pad = Math.max(1, width - left.length - right.length)
      lines.push(left + ' '.repeat(pad) + right)
    }
    const w = Number(b.totalWeightSnapshot)
    lines.push(`  Total: ${b.totalThanSnapshot} than · ${w.toFixed(1)} kg`)
    lines.push(div())
    totalThan += b.totalThanSnapshot
    totalWeight += Number(b.totalWeightSnapshot)
  }

  lines.push(
    center(`TOTAL: ${slip.batches.length} batches · ${totalWeight.toFixed(1)} kg`),
  )
  lines.push(center(`(${totalThan} than)`))
  lines.push(div('='))
  lines.push('')
  lines.push('')

  return lines.join('\n')
}

export async function printBatchMakerSlip(
  slip: SavedSlip,
  build: (s: SavedSlip) => string,
) {
  const { BluetoothPrinter } = await import('@/lib/bluetooth-printer')
  const printer = new BluetoothPrinter()
  const savedId = (() => {
    try { return localStorage.getItem('bt-printer-id') || undefined } catch { return undefined }
  })()
  await printer.smartConnect(savedId)
  const deviceId = printer.getDeviceId()
  if (deviceId) try { localStorage.setItem('bt-printer-id', deviceId) } catch {}

  const receipt = build(slip)
  await printer.init()
  printer.startBatch()
  // Plain-text path — receipt already has its own dividers and padding.
  // Splitting and printing line-by-line keeps the encoder behavior identical
  // to the existing dyeing slip print.
  for (const line of receipt.split('\n')) {
    await printer.printText(line)
  }
  await printer.feedLines(3)
  await printer.flushBatch()
}
