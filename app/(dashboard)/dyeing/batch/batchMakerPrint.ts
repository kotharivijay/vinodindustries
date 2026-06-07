// Bluetooth print helper for Batch Maker slips.
// Layout uses ASCII '[ ]' checkboxes on every lot line so Sanker can tick
// each one off with a pen as he physically pulls the lots from the rack.

interface SavedSlipBatch {
  foldNoSnapshot: string
  batchNoSnapshot: number
  shadeNameSnapshot: string | null
  markaSnapshot: string | null
  totalThanSnapshot: number
  totalWeightSnapshot: number | string
  jetNo?: number | null
  jetSerial?: number | null
  foldBatch: {
    lots: { lotNo: string; than: number }[]
  }
}

interface SavedSlip {
  slipNo: string
  date: string
  batchMakerName: string
  batches: SavedSlipBatch[]
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
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

  // Print one batch block — checkbox lot rows + totals. Used by both the
  // jet-grouped layout and the fallback fold-grouped layout.
  function printBatch(b: SavedSlipBatch) {
    const header = b.jetSerial != null
      ? `${ordinal(b.jetSerial)} · Fold ${b.foldNoSnapshot} · B${b.batchNoSnapshot}`
      : `Fold ${b.foldNoSnapshot} · B${b.batchNoSnapshot}`
    lines.push(header)
    if (b.shadeNameSnapshot) lines.push(`  Shade: ${b.shadeNameSnapshot}`)
    if (b.markaSnapshot) lines.push(`  Marka: ${b.markaSnapshot}`)
    for (const l of b.foldBatch.lots) {
      const left = `  [ ] ${l.lotNo}`
      const right = `${l.than} than`
      const pad = Math.max(1, width - left.length - right.length)
      lines.push(left + ' '.repeat(pad) + right)
    }
    const w = Number(b.totalWeightSnapshot)
    lines.push(`  Total: ${b.totalThanSnapshot} than · ${w.toFixed(1)} kg`)
  }

  let totalThan = 0
  let totalWeight = 0

  // Jet-grouped layout when any batch was tagged. Untagged batches collect
  // under a final "Untagged" block so nothing is dropped.
  const hasJetTags = slip.batches.some(b => b.jetNo != null)
  if (hasJetTags) {
    const buckets = new Map<number | null, SavedSlipBatch[]>()
    for (const b of slip.batches) {
      const key = b.jetNo ?? null
      if (!buckets.has(key)) buckets.set(key, [])
      buckets.get(key)!.push(b)
    }
    const sortedKeys = Array.from(buckets.keys()).sort((a, b) => {
      if (a == null) return 1
      if (b == null) return -1
      return a - b
    })
    for (const jetNo of sortedKeys) {
      const group = buckets.get(jetNo)!
      group.sort((a, b) => (a.jetSerial ?? 999) - (b.jetSerial ?? 999))
      const jetLabel = jetNo == null ? 'UNTAGGED' : `JET-${jetNo}`
      const groupThan = group.reduce((s, b) => s + b.totalThanSnapshot, 0)
      const groupKg = group.reduce((s, b) => s + Number(b.totalWeightSnapshot), 0)
      lines.push(div('='))
      lines.push(center(`${jetLabel} — ${group.length} batch${group.length === 1 ? '' : 'es'}`))
      lines.push(center(`${groupThan} than · ${groupKg.toFixed(1)} kg`))
      lines.push(div('='))
      for (const b of group) {
        printBatch(b)
        totalThan += b.totalThanSnapshot
        totalWeight += Number(b.totalWeightSnapshot)
        lines.push(div())
      }
    }
  } else {
    for (const b of slip.batches) {
      printBatch(b)
      lines.push(div())
      totalThan += b.totalThanSnapshot
      totalWeight += Number(b.totalWeightSnapshot)
    }
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
