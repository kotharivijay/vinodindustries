// Sample-data probe for the new yearwise Invoice Payment Performance
// report. Pulls a handful of FY 25-26 invoices (fully settled + a few
// partials) with their receipt allocations, computes payment days, and
// dumps everything so we can mock up the report layout.
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

const FY = '25-26'
const SAMPLE_VCHS = [
  'KSI/25-26/803',   // single receipt, full clear (rcpt 370)
  'KSI/25-26/869',   // multi-receipt (rcpt 370 + rcpt 50)
  'KSI/25-26/873',   // partial (rcpt 50)
  'KSI/25-26/24',    // Magic 46" — has voucher-level discount
]

// 1) Look up some invoices in FY 25-26 — sample set if vch list misses
const targeted = await db.ksiSalesInvoice.findMany({
  where: { vchNumber: { in: SAMPLE_VCHS } },
  include: {
    allocations: {
      include: { receipt: { select: { id: true, vchNumber: true, vchType: true, date: true } } },
    },
    ledgers: { select: { ledgerName: true, amount: true } },
  },
})
const sampled = targeted.length >= 3 ? targeted : await db.ksiSalesInvoice.findMany({
  where: { fy: FY, vchType: { not: 'Credit Note' } },
  include: {
    allocations: { include: { receipt: { select: { id: true, vchNumber: true, vchType: true, date: true } } } },
    ledgers: { select: { ledgerName: true, amount: true } },
  },
  take: 6,
  orderBy: { date: 'asc' },
})

// 2) Load TallyLedger parents so we can show "agent" column.
const partyNames = Array.from(new Set(sampled.map((i) => i.partyName)))
const ledgers = await db.tallyLedger.findMany({
  where: { firmCode: 'KSI', name: { in: partyNames } },
  select: { name: true, parent: true },
})
const parentByParty = new Map(ledgers.map((l) => [l.name, l.parent]))

// 3) Load category map so we can split allocations' TDS / disc into
//    "journal" lines with the right ledger name.
const cats = await db.ksiSalesLedgerCategory.findMany({ select: { ledgerName: true, category: true } })
const categoryMap = new Map(cats.map((c) => [c.ledgerName.toLowerCase(), c.category]))

const round2 = (n) => Math.round(n * 100) / 100
const fmt = (d) => d ? new Date(d).toISOString().slice(0, 10) : '—'

console.log(`\n=== Invoice Payment Performance — sample probe (FY ${FY}) ===\n`)

for (const inv of sampled) {
  console.log(`\n── ${inv.vchType} ${inv.vchNumber} · ${fmt(inv.date)} · ${inv.partyName} ──`)
  console.log(`   agent (parent ledger): ${parentByParty.get(inv.partyName) || '—'}`)

  // Net taxable, GST, total — match the per-invoice card maths
  const partyLower = (inv.partyName || '').toLowerCase()
  let voucherDiscount = 0
  let voucherExtra = 0
  for (const l of inv.ledgers || []) {
    const lname = l.ledgerName.toLowerCase()
    let cat = categoryMap.get(lname)
    if (!cat) {
      if (/cgst|sgst|utgst|igst/.test(lname)) cat = 'tax'
      else if (/round\s*off|roundoff|rounding/.test(lname)) cat = 'roundoff'
      else if (lname === partyLower) cat = 'party'
      else cat = 'unmapped'
    }
    const abs = Math.abs(l.amount || 0)
    if (cat === 'discount') voucherDiscount += abs
    else if (cat === 'extra-charge') voucherExtra += abs
  }
  const gst = (inv.cgstAmount || 0) + (inv.sgstAmount || 0) + (inv.igstAmount || 0)
  const taxableNet = round2((inv.taxableAmount || 0) - voucherDiscount + voucherExtra)
  console.log(`   taxable (net incl. extras − disc): ₹${taxableNet}    gst: ₹${round2(gst)}    total: ₹${inv.totalAmount}`)

  // Allocations → split into receipt (cash) lines + journal (TDS/disc) lines
  const allocs = (inv.allocations || []).sort((a, b) =>
    a.receipt.date.getTime() - b.receipt.date.getTime() || a.receipt.id - b.receipt.id,
  )
  const cashLines = []
  const journalLines = []
  let consumed = 0
  let lastSettleDate = null
  for (const a of allocs) {
    const isCN = a.receipt.vchType === 'Credit Note'
    const cash = a.allocatedAmount || 0
    const tds = a.tdsAmount || 0
    const disc = a.discountAmount || 0
    const contribCash = isCN ? -cash : cash // CN reduces; here CN allocations affect the invoice differently
    if (cash > 0) cashLines.push({ date: a.receipt.date, vch: a.receipt.vchNumber, amount: cash, type: isCN ? 'CN knock-off' : 'Receipt' })
    if (tds > 0) journalLines.push({ date: a.receipt.date, ledger: 'TDS Receivable', amount: tds })
    if (disc > 0) journalLines.push({ date: a.receipt.date, ledger: 'Discount (GST)', amount: disc })
    consumed += cash + tds + disc
    if (consumed >= (inv.totalAmount - 0.5)) {
      if (!lastSettleDate || a.receipt.date > lastSettleDate) lastSettleDate = a.receipt.date
    }
  }
  // If consumed equals or exceeds invoice total after the last allocation,
  // lastSettleDate is the closing date.
  if (consumed >= (inv.totalAmount - 0.5) && !lastSettleDate && allocs.length > 0) {
    lastSettleDate = allocs[allocs.length - 1].receipt.date
  }
  const pending = round2(Math.max(0, inv.totalAmount - consumed))

  console.log(`   receipts (${cashLines.length}):`)
  for (const r of cashLines) console.log(`     ${fmt(r.date)}  ${r.type === 'CN knock-off' ? 'CN' : 'Rcpt'} ${r.vch.padEnd(8)}  ₹${r.amount}`)
  console.log(`   journals (${journalLines.length}):`)
  for (const j of journalLines) console.log(`     ${fmt(j.date)}  ${j.ledger.padEnd(18)} ₹${j.amount}`)
  console.log(`   consumed: ₹${round2(consumed)}    pending: ₹${pending}    last settle: ${fmt(lastSettleDate)}`)
  if (pending < 0.5 && lastSettleDate) {
    const days = Math.round((new Date(lastSettleDate).getTime() - new Date(inv.date).getTime()) / 86400000)
    console.log(`   ⇒ PAYMENT PERFORMANCE: ${days} days  (${fmt(inv.date)} → ${fmt(lastSettleDate)})`)
  } else if (pending >= 0.5) {
    console.log(`   ⇒ STILL OPEN — pending ₹${pending}, no performance score yet`)
  }
}

await db.$disconnect()
