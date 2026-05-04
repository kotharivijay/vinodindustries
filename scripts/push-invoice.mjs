// Push invoice id (default 1) to Tally with full request/response logging.
// Self-contained — replicates lib/inv/tally-push.ts in JS to avoid TS toolchain.
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
const db = prisma

const KSI_STATE = process.env.KSI_STATE || 'Rajasthan'
const KSI_TALLY = process.env.KSI_TALLY_COMPANY || 'Kothari Synthetic Industries -( from 2023)'

const fmtDate = input => {
  const s = typeof input === 'string' ? input.trim() : input.toISOString().slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10).replace(/-/g, '')
  const m = s.match(/^(\d{2})-(\d{2})-(\d{2,4})$/)
  if (m) {
    const dd = m[1], mm = m[2]
    const yy = m[3].length === 2 ? '20' + m[3] : m[3]
    return `${yy}${mm}${dd}`
  }
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}
const neg = n => `-${n.toFixed(2)}`

function buildPayload(invoice, party, cfg, lines) {
  const isUnreg = ['Unregistered', 'Composition'].includes(party.gstRegistrationType)
  const isIntra = !isUnreg && (party.state || '').toLowerCase() === KSI_STATE.toLowerCase()

  const allinventoryentries = lines.map(l => {
    const godown = l.alias.godownOverride ?? cfg.godownMap[l.alias.category]
    const purchaseLedger = cfg.purchaseLedgerMap[l.alias.category]
    if (!godown) throw new Error(`No godown for category ${l.alias.category}`)
    if (!purchaseLedger) throw new Error(`No purchase ledger for category ${l.alias.category}`)

    const rate = Number(l.alias.gstRate)
    const half = (rate / 2).toFixed(2)
    const desc = (l.description || l.item.displayName).slice(0, 240)

    return {
      stockitemname: l.alias.tallyStockItem,
      gstovrdntaxability: isUnreg ? 'Exempt' : 'Taxable',
      gstovrdnineligibleitc: ' Not Applicable',
      gstovrdnisrevchargeappl: ' Not Applicable',
      gstsourcetype: 'Stock Item',
      gstitemsource: l.alias.tallyStockItem,
      hsnsourcetype: 'Stock Item',
      hsnitemsource: l.alias.tallyStockItem,
      gstovrdntypeofsupply: 'Goods',
      gstrateinferapplicability: 'As per Masters/Company',
      gsthsninferapplicability: 'As per Masters/Company',
      isdeemedpositive: true,
      rate: `${l.rate.toFixed(2)}/${l.unit}`,
      amount: neg(l.amount),
      actualqty: ` ${l.qty.toFixed(2)} ${l.unit}`,
      billedqty: ` ${l.qty.toFixed(2)} ${l.unit}`,
      ratedetails: isUnreg
        ? [
            { gstratedutyhead: 'CGST', gstratevaluationtype: ' Not Applicable' },
            { gstratedutyhead: 'SGST/UTGST', gstratevaluationtype: ' Not Applicable' },
            { gstratedutyhead: 'IGST', gstratevaluationtype: ' Not Applicable' },
            { gstratedutyhead: 'Cess', gstratevaluationtype: ' Not Applicable' },
            { gstratedutyhead: 'State Cess', gstratevaluationtype: ' Not Applicable' },
          ]
        : [
            { gstratedutyhead: 'CGST', gstratevaluationtype: 'Based on Value', gstrate: ` ${half}` },
            { gstratedutyhead: 'SGST/UTGST', gstratevaluationtype: 'Based on Value', gstrate: ` ${half}` },
            { gstratedutyhead: 'IGST', gstratevaluationtype: 'Based on Value', gstrate: ` ${rate}` },
            { gstratedutyhead: 'Cess', gstratevaluationtype: ' Not Applicable' },
            { gstratedutyhead: 'State Cess', gstratevaluationtype: 'Based on Value' },
          ],
      basicuserdescription: [desc],
      batchallocations: [{
        godownname: godown,
        destinationgodownname: godown,
        batchname: invoice.supplierInvoiceNo,
        amount: neg(l.amount),
        actualqty: ` ${l.qty.toFixed(2)} ${l.unit}`,
        billedqty: ` ${l.qty.toFixed(2)} ${l.unit}`,
      }],
      accountingallocations: [{
        ledgername: purchaseLedger,
        isdeemedpositive: true,
        ispartyledger: false,
        amount: neg(l.amount),
      }],
    }
  })

  // Same model as lib/inv/invoice-totals.ts (locked 2026-05-04)
  const linesByRate = {}
  for (const l of lines) {
    const r = String(Number(l.alias.gstRate))
    linesByRate[r] = (linesByRate[r] || 0) + l.amount
  }
  let majorityRate = 0, maxSubtotal = -1
  for (const [r, sub] of Object.entries(linesByRate)) {
    const numR = parseFloat(r)
    if (sub > maxSubtotal || (sub === maxSubtotal && numR > majorityRate)) {
      maxSubtotal = sub; majorityRate = numR
    }
  }
  const gstByRate = {}
  for (const [r, sub] of Object.entries(linesByRate)) {
    const numR = parseFloat(r)
    let base = sub
    if (numR === majorityRate) base += invoice.freightAmount - invoice.totalDiscountAmount
    gstByRate[r] = isUnreg ? 0 : +(base * (numR / 100)).toFixed(2)
  }
  const totalGst = +Object.values(gstByRate).reduce((s, x) => s + x, 0).toFixed(2)
  const taxable = +Object.values(linesByRate).reduce((s, x) => s + x, 0).toFixed(2)
  const totalBeforeRound = +(taxable + invoice.freightAmount - invoice.totalDiscountAmount + totalGst).toFixed(2)
  const finalTotal = Math.round(totalBeforeRound)
  const roundOff = +(finalTotal - totalBeforeRound).toFixed(2)

  const ledgerentries = [
    { ledgername: party.tallyLedger, isdeemedpositive: false, ispartyledger: true, amount: finalTotal.toFixed(2) },
  ]

  if (!isUnreg) {
    for (const [rate, gstAmt] of Object.entries(gstByRate)) {
      if (gstAmt === 0) continue
      if (isIntra) {
        const half = +(gstAmt / 2).toFixed(2)
        const otherHalf = +(gstAmt - half).toFixed(2)
        const halfRate = String(parseFloat(rate) / 2)
        ledgerentries.push({
          ledgername: cfg.gstLedgers.CGST[halfRate],
          isdeemedpositive: true, ispartyledger: false,
          amount: neg(half), vatexpamount: neg(half),
        })
        ledgerentries.push({
          ledgername: cfg.gstLedgers.SGST[halfRate],
          isdeemedpositive: true, ispartyledger: false,
          amount: neg(otherHalf), vatexpamount: neg(otherHalf),
        })
      } else {
        ledgerentries.push({
          ledgername: cfg.gstLedgers.IGST[rate],
          isdeemedpositive: true, ispartyledger: false,
          amount: neg(gstAmt), vatexpamount: neg(gstAmt),
        })
      }
    }
  }

  if (invoice.freightAmount > 0) {
    ledgerentries.push({
      ledgername: cfg.freightLedger,
      isdeemedpositive: true, ispartyledger: false,
      amount: neg(invoice.freightAmount),
    })
  }
  if (invoice.totalDiscountAmount > 0) {
    ledgerentries.push({
      ledgername: cfg.discountLedger,
      isdeemedpositive: true, ispartyledger: false,
      amount: invoice.totalDiscountAmount.toFixed(2),
    })
  }

  if (Math.abs(roundOff) > 0.001) {
    const roundAmt = roundOff > 0 ? neg(roundOff) : Math.abs(roundOff).toFixed(2)
    ledgerentries.push({
      ledgername: cfg.roundOffLedger,
      isdeemedpositive: roundOff < 0, ispartyledger: false,
      amount: roundAmt, vatexpamount: roundAmt,
    })
  }

  return {
    static_variables: [
      { name: 'svVchImportFormat', value: 'jsonex' },
      { name: 'svCurrentCompany', value: KSI_TALLY },
    ],
    tallymessage: [{
      metadata: {
        type: 'Voucher',
        remoteid: `INV-KSI-${invoice.id}`,
        vchtype: 'Purchase',
        action: 'Create',
        objview: 'Invoice Voucher View',
      },
      date: fmtDate(invoice.supplierInvoiceDate),
      referencedate: fmtDate(invoice.supplierInvoiceDate),
      vouchertypename: 'Purchase',
      partyname: party.tallyLedger,
      partyledgername: party.tallyLedger,
      partymailingname: party.tallyLedger,
      consigneemailingname: KSI_TALLY,
      vouchernumber: invoice.supplierInvoiceNo,
      reference: invoice.supplierInvoiceNo,
      basicbuyername: KSI_TALLY,
      basicbasepartyname: party.tallyLedger,
      countryofresidence: 'India',
      consigneecountryname: 'India',
      consigneestatename: KSI_STATE,
      cmpgststate: KSI_STATE,
      consigneegstregistrationtype: 'Regular',
      cmpgstregistrationtype: 'Regular',
      numberingstyle: 'Manual',
      persistedview: 'Invoice Voucher View',
      vchentrymode: 'Item Invoice',
      isinvoice: true,
      effectivedate: fmtDate(invoice.supplierInvoiceDate),
      ...(party.gstin ? { partygstin: party.gstin } : { partygstin: '' }),
      ...(party.state ? { statename: party.state } : {}),
      placeofsupply: party.state || KSI_STATE,
      gstregistrationtype: party.gstRegistrationType,
      narration: `App push. Series: ${invoice.linkedChallanSeries.join(', ')}.`,
      allinventoryentries,
      ledgerentries,
      diffactualqty: false, ismstfromsync: false, isdeleted: false,
      asoriginal: false, audited: false, forjobcosting: false, isoptional: false,
      issystem: false, isfetchedonly: false,
    }],
  }
}

async function postToTally(payload) {
  const TUNNEL = process.env.TALLY_TUNNEL_URL
  if (!TUNNEL) throw new Error('TALLY_TUNNEL_URL not configured')

  const headers = {
    'Content-Type': 'application/json',
    version: '1',
    tallyrequest: 'Import',
    type: 'Data',
    id: 'Vouchers',
  }
  if (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET) {
    headers['CF-Access-Client-Id'] = process.env.CF_ACCESS_CLIENT_ID
    headers['CF-Access-Client-Secret'] = process.env.CF_ACCESS_CLIENT_SECRET
  }

  const res = await fetch(TUNNEL, { method: 'POST', headers, body: JSON.stringify(payload) })
  const text = await res.text()
  let parsed = null
  try { parsed = JSON.parse(text) }
  catch {
    const grab = k =>
      (text.match(new RegExp(`"${k}"\\s*:\\s*"([^"]+)"`)) || [])[1] ??
      (text.match(new RegExp(`"${k}"\\s*:\\s*([^,\\s}]+)`)) || [])[1]
    parsed = {
      fallback: true,
      created: grab('created'),
      lastvchid: grab('lastvchid'),
      vchkey: grab('vchkey'),
      vchnumber: grab('vchnumber'),
      errors: grab('errors'),
      exceptions: grab('exceptions'),
      raw: text.slice(0, 4000),
    }
  }
  return { http: res.status, body: text, parsed }
}

async function main() {
  const id = Number(process.argv[2] || 1)
  console.log(`=== Pushing invoice id=${id} ===\n`)

  const inv = await db.invPurchaseInvoice.findUnique({
    where: { id },
    include: {
      party: true,
      lines: { include: { item: { include: { alias: true } } }, orderBy: { lineNo: 'asc' } },
      challans: { include: { challan: { select: { internalSeriesNo: true, seriesFy: true } } } },
    },
  })
  if (!inv) { console.log('Invoice not found'); return }
  const cfg = await db.invTallyConfig.findUnique({ where: { id: 1 } })

  console.log('Invoice:', inv.supplierInvoiceNo, '· party:', inv.party.displayName, '· treatment:', inv.gstTreatment, '· total:', String(inv.totalAmount))
  console.log('Linked challans:', inv.challans.map(c => `KSI/IN/${c.challan.seriesFy}/${String(c.challan.internalSeriesNo).padStart(4,'0')}`).join(', '))

  const linkedChallanSeries = inv.challans.map(c => `KSI/IN/${c.challan.seriesFy}/${String(c.challan.internalSeriesNo).padStart(4,'0')}`)

  const lines = inv.lines.filter(l => l.item).map(l => ({
    lineNo: l.lineNo,
    qty: Number(l.qty || 0),
    unit: l.unit || 'kg',
    rate: Number(l.rate || 0),
    amount: Number(l.amount),
    description: l.description || l.item.displayName,
    gstRate: Number(l.gstRate || 0),
    item: { displayName: l.item.displayName },
    alias: {
      tallyStockItem: l.item.alias.tallyStockItem,
      gstRate: Number(l.item.alias.gstRate),
      category: l.item.alias.category,
      godownOverride: l.item.alias.godownOverride,
    },
  }))

  let payload
  try {
    payload = buildPayload(
      {
        id: inv.id,
        supplierInvoiceNo: inv.supplierInvoiceNo,
        supplierInvoiceDate: inv.supplierInvoiceDate,
        freightAmount: Number(inv.freightAmount),
        totalDiscountAmount: Number(inv.totalDiscountAmount),
        linkedChallanSeries,
      },
      {
        tallyLedger: inv.party.tallyLedger,
        state: inv.party.state,
        gstin: inv.party.gstin,
        gstRegistrationType: inv.party.gstRegistrationType,
      },
      cfg,
      lines,
    )
  } catch (e) {
    console.log('BUILD ERROR:', e.message)
    return
  }
  console.log('\n--- Payload (pretty, first ~3500 chars) ---')
  const pp = JSON.stringify(payload, null, 2)
  console.log(pp.slice(0, 3500))
  if (pp.length > 3500) console.log(`... (${pp.length - 3500} more chars)`)

  console.log('\n--- POST', process.env.TALLY_TUNNEL_URL, '---')
  await db.invPurchaseInvoice.update({
    where: { id },
    data: { status: 'PushPending', pushAttempts: { increment: 1 }, tallyPayload: payload },
  })

  let result
  try { result = await postToTally(payload) }
  catch (e) {
    console.log('NETWORK ERROR:', e.message)
    await db.invPurchaseInvoice.update({ where: { id }, data: { lastPushError: e.message, status: 'PushPending' } })
    return
  }

  console.log(`HTTP ${result.http}`)
  console.log('--- Raw body (first 4000 chars) ---')
  console.log(result.body.slice(0, 4000))
  console.log('\n--- Parsed ---')
  console.log(JSON.stringify(result.parsed, null, 2).slice(0, 4000))

  const created = Number(result.parsed?.created ?? result.parsed?.RESPONSE?.CREATED ?? 0)
  const vchkey = result.parsed?.vchkey || result.parsed?.lastvchid || null

  if (created > 0) {
    await db.invPurchaseInvoice.update({
      where: { id },
      data: { status: 'PushedToTally', tallyPushedAt: new Date(), tallyVoucherGuid: vchkey, tallyResponse: result.parsed, lastPushError: null },
    })
    console.log(`\n✅ Pushed. created=${created}  vchkey=${vchkey}`)
  } else {
    const errMsg = typeof result.body === 'string' ? result.body.slice(0, 500) : 'Push failed'
    await db.invPurchaseInvoice.update({
      where: { id },
      data: { status: 'PushPending', lastPushError: errMsg, tallyResponse: result.parsed },
    })
    console.log(`\n❌ Not created. lastPushError stored.`)
  }
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
