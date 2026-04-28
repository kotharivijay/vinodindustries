import { fmtDate, neg } from './tally-helpers'

const KSI_STATE = process.env.KSI_STATE || 'Rajasthan'
const KSI_TALLY = process.env.KSI_TALLY_COMPANY || 'Kothari Synthetic Industries -( from 2023)'

interface InvoiceLineForBuild {
  lineNo: number
  qty: number
  unit: string
  rate: number
  amount: number          // net (post-discount)
  description: string
  gstRate: number
  item: { displayName: string }
  alias: { tallyStockItem: string; gstRate: number; category: string; godownOverride?: string | null }
}

interface InvoiceForBuild {
  id: number
  supplierInvoiceNo: string
  supplierInvoiceDate: Date | string
  freightAmount: number
  totalDiscountAmount: number
  linkedChallanSeries: string[]
}

interface PartyForBuild {
  tallyLedger: string
  state: string | null
  gstin: string | null
  gstRegistrationType: string
}

interface CfgForBuild {
  purchaseLedgerMap: Record<string, string>
  godownMap: Record<string, string>
  gstLedgers: { IGST: Record<string, string>; CGST: Record<string, string>; SGST: Record<string, string> }
  roundOffLedger: string
  freightLedger: string
  discountLedger: string
}

export function buildPurchaseVoucherJSON(
  invoice: InvoiceForBuild,
  party: PartyForBuild,
  cfg: CfgForBuild,
  lines: InvoiceLineForBuild[],
): any {
  const isUnreg = ['Unregistered', 'Composition'].includes(party.gstRegistrationType)
  const isIntra = !isUnreg && (party.state || '').toLowerCase() === KSI_STATE.toLowerCase()

  // ── Inventory entries ────────────────────────────────────────────
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
      gstovrdnineligibleitc: '\u0004 Not Applicable',
      gstovrdnisrevchargeappl: '\u0004 Not Applicable',
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
            { gstratedutyhead: 'CGST', gstratevaluationtype: '\u0004 Not Applicable' },
            { gstratedutyhead: 'SGST/UTGST', gstratevaluationtype: '\u0004 Not Applicable' },
            { gstratedutyhead: 'IGST', gstratevaluationtype: '\u0004 Not Applicable' },
            { gstratedutyhead: 'Cess', gstratevaluationtype: '\u0004 Not Applicable' },
            { gstratedutyhead: 'State Cess', gstratevaluationtype: '\u0004 Not Applicable' },
          ]
        : [
            { gstratedutyhead: 'CGST', gstratevaluationtype: 'Based on Value', gstrate: ` ${half}` },
            { gstratedutyhead: 'SGST/UTGST', gstratevaluationtype: 'Based on Value', gstrate: ` ${half}` },
            { gstratedutyhead: 'IGST', gstratevaluationtype: 'Based on Value', gstrate: ` ${rate}` },
            { gstratedutyhead: 'Cess', gstratevaluationtype: '\u0004 Not Applicable' },
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

  // ── Ledger entries ──────────────────────────────────────────────
  const ledgerentries: any[] = [
    { ledgername: party.tallyLedger, isdeemedpositive: false, ispartyledger: true, amount: '0.00' },
  ]

  if (!isUnreg) {
    const linesByRate: Record<string, number> = {}
    for (const l of lines) {
      const r = String(Number(l.alias.gstRate))
      linesByRate[r] = (linesByRate[r] || 0) + l.amount
    }
    for (const [rate, taxable] of Object.entries(linesByRate)) {
      const totalGst = +(taxable * (parseFloat(rate) / 100)).toFixed(2)
      if (isIntra) {
        const half = +(totalGst / 2).toFixed(2)
        const halfRate = String(parseFloat(rate) / 2)
        ledgerentries.push({
          ledgername: cfg.gstLedgers.CGST[halfRate],
          isdeemedpositive: true, ispartyledger: false,
          amount: neg(half), vatexpamount: neg(half),
        })
        ledgerentries.push({
          ledgername: cfg.gstLedgers.SGST[halfRate],
          isdeemedpositive: true, ispartyledger: false,
          amount: neg(half), vatexpamount: neg(half),
        })
      } else {
        ledgerentries.push({
          ledgername: cfg.gstLedgers.IGST[rate],
          isdeemedpositive: true, ispartyledger: false,
          amount: neg(totalGst), vatexpamount: neg(totalGst),
        })
      }
    }
  }

  if (invoice.freightAmount > 0) {
    ledgerentries.push({
      ledgername: cfg.freightLedger,
      appropriatefor: 'GST', gstappropriateto: 'Goods and Services',
      excisealloctype: 'Based on Value',
      isdeemedpositive: true, ispartyledger: false,
      amount: neg(invoice.freightAmount), vatexpamount: neg(invoice.freightAmount),
    })
  }
  if (invoice.totalDiscountAmount > 0) {
    ledgerentries.push({
      ledgername: cfg.discountLedger,
      appropriatefor: 'GST', gstappropriateto: 'Goods and Services',
      excisealloctype: 'Based on Value',
      isdeemedpositive: true, ispartyledger: false,
      amount: invoice.totalDiscountAmount.toFixed(2),
      vatexpamount: invoice.totalDiscountAmount.toFixed(2),
    })
  }

  // ── Round-off ───────────────────────────────────────────────────
  const taxableSum = lines.reduce((s, l) => s + l.amount, 0)
  let dr = taxableSum
  for (const e of ledgerentries) {
    if (e.ispartyledger) continue
    const a = parseFloat(String(e.amount))
    if (a < 0) dr += -a; else dr -= a
  }
  const exactFinal = +dr.toFixed(2)
  const roundedFinal = Math.round(exactFinal)
  const shortfall = +(exactFinal - roundedFinal).toFixed(2)
  if (Math.abs(shortfall) > 0.001) {
    const roundAmt = shortfall > 0 ? shortfall.toFixed(2) : neg(Math.abs(shortfall))
    ledgerentries.push({
      ledgername: cfg.roundOffLedger,
      isdeemedpositive: shortfall < 0, ispartyledger: false,
      amount: roundAmt, vatexpamount: roundAmt,
    })
  }
  ledgerentries[0].amount = roundedFinal.toFixed(2)

  // ── Voucher header ──────────────────────────────────────────────
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

/**
 * POST the JSON to the Tally tunnel. Defensive parser handles Tally
 * Prime's slightly malformed JSON for vchnumber etc.
 */
export async function postPurchaseVoucher(payload: any) {
  const TUNNEL = process.env.TALLY_TUNNEL_URL
  if (!TUNNEL) throw new Error('TALLY_TUNNEL_URL not configured')

  const headers: Record<string, string> = {
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
  let parsed: any = null
  try { parsed = JSON.parse(text) }
  catch {
    const created = (text.match(/"created"\s*:\s*(\d+)/) || [])[1]
    const lastvchid = (text.match(/"lastvchid"\s*:\s*"([^"]+)"/) || [])[1]
    const vchkey = (text.match(/"vchkey"\s*:\s*"([^"]+)"/) || [])[1]
    parsed = { fallback: true, created, lastvchid, vchkey, raw: text }
  }
  return { http: res.status, body: text, parsed }
}
