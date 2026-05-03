// Backfill InvChallanLine.gstRate from item.alias.gstRate, then recompute
// amount / gstAmount / totalWithGst (using each parent's ratesIncludeGst,
// which defaults to false). Updates parent challan totals too.
//
// Run dry first:  node scripts/backfill-challan-line-gst.mjs
// Apply changes:  node scripts/backfill-challan-line-gst.mjs --apply

import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

// Pull DB URL from .env.production.local
try {
  const env = readFileSync('.env.production.local', 'utf8')
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (!m) continue
    let val = m[2].trim()
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1)
    val = val.replace(/\\n$/, '')
    process.env[m[1]] = val
  }
} catch {}

const APPLY = process.argv.includes('--apply')
const prisma = new PrismaClient()

function round2(n) { return Math.round(n * 100) / 100 }

function computeLineMath({ qty, rate, gstRate, discountAmount }, ratesIncludeGst) {
  if (rate == null || !Number.isFinite(Number(rate))) {
    return { grossAmount: null, amount: null, gstAmount: null, totalWithGst: null }
  }
  const q = Number(qty || 0), r = Number(rate)
  const disc = Number(discountAmount ?? 0), gst = Number(gstRate ?? 0)
  const gross = q * r
  if (ratesIncludeGst && gst > 0) {
    const incl = gross - disc
    const taxable = incl / (1 + gst / 100)
    return {
      grossAmount: round2(gross),
      amount: round2(taxable),
      gstAmount: round2(incl - taxable),
      totalWithGst: round2(incl),
    }
  }
  const taxable = gross - disc
  const gstAmt = (taxable * gst) / 100
  return {
    grossAmount: round2(gross),
    amount: round2(taxable),
    gstAmount: round2(gstAmt),
    totalWithGst: round2(taxable + gstAmt),
  }
}

async function main() {
  const challans = await prisma.invChallan.findMany({
    select: {
      id: true,
      ratesIncludeGst: true,
      lines: {
        select: {
          id: true, qty: true, rate: true, discountAmount: true, gstRate: true,
          item: { select: { alias: { select: { gstRate: true } } } },
        },
      },
    },
  })
  console.log(`Inspecting ${challans.length} challans, ${challans.reduce((s, c) => s + c.lines.length, 0)} lines`)

  let lineUpdates = 0, challanUpdates = 0
  for (const c of challans) {
    let totalQty = 0, totalAmount = 0, totalGstAmount = 0, totalWithGst = 0
    const ops = []
    for (const l of c.lines) {
      const aliasGst = l.item?.alias?.gstRate != null ? Number(l.item.alias.gstRate) : 0
      const finalGst = l.gstRate != null ? Number(l.gstRate) : aliasGst
      const m = computeLineMath({
        qty: Number(l.qty),
        rate: l.rate != null ? Number(l.rate) : null,
        gstRate: finalGst,
        discountAmount: l.discountAmount != null ? Number(l.discountAmount) : null,
      }, c.ratesIncludeGst)
      totalQty += Number(l.qty || 0)
      totalAmount += m.amount ?? 0
      totalGstAmount += m.gstAmount ?? 0
      totalWithGst += m.totalWithGst ?? 0
      ops.push({
        where: { id: l.id },
        data: {
          gstRate: finalGst,
          grossAmount: m.grossAmount,
          amount: m.amount,
          gstAmount: m.gstAmount,
          totalWithGst: m.totalWithGst,
        },
      })
    }
    if (APPLY) {
      await prisma.$transaction([
        ...ops.map(o => prisma.invChallanLine.update(o)),
        prisma.invChallan.update({
          where: { id: c.id },
          data: {
            totalQty: round2(totalQty),
            totalAmount: round2(totalAmount),
            totalGstAmount: round2(totalGstAmount),
            totalWithGst: round2(totalWithGst),
          },
        }),
      ])
      challanUpdates++
    }
    lineUpdates += ops.length
  }
  console.log(APPLY
    ? `Updated ${lineUpdates} lines across ${challanUpdates} challans.`
    : `Would update ${lineUpdates} lines across ${challans.length} challans. Re-run with --apply.`)
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
