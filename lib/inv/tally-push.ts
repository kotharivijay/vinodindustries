import { fmtDate, neg } from './tally-helpers'
import { computeInvoiceTotals } from './invoice-totals'

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
  // Supplier charged GST on freight (detected at entry from the bill total).
  // true → fold at majority rate, "(GST)" freight ledger before Input GST;
  // false → GST-free, plain freight ledger at the end of the voucher.
  freightTaxable: boolean
  // Header-level discount ONLY. Line-level discounts are already netted out of
  // each line's `amount`; passing them here would subtract them twice.
  headerDiscountAmount: number
  // GST-free extras (hamali/cartage). Added on top of totals.total, no GST fold.
  otherCharges: number
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
  // GST-free freight ledger — required when freightTaxable=false and freight > 0.
  freightNoGstLedger?: string
  discountLedger: string
  otherChargesLedger?: string
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

    // Line rate is authoritative — it's what invoice creation computed GST
    // from. The alias master can go stale (e.g. coal 5% → 18% in 2025) and
    // must not silently override the invoice.
    const rate = Number(l.gstRate)
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

  // ── Centralized totals (lines + freight/header-discount at majority rate) ──
  // Line amounts are already net of line discounts, so only the header
  // discount participates here — same as invoice creation. Rates come from
  // the invoice lines, not the alias master.
  const totals = computeInvoiceTotals(
    lines.map(l => ({ amount: l.amount, gstRate: Number(l.gstRate) })),
    invoice.freightAmount,
    invoice.headerDiscountAmount,
    isIntra,
    isUnreg,
    invoice.freightTaxable,
  )

  // ── Ledger entries ──────────────────────────────────────────────
  const ledgerentries: any[] = [
    { ledgername: party.tallyLedger, isdeemedpositive: false, ispartyledger: true, amount: '0.00' },
  ]

  // Discount and taxable freight come BEFORE the Input GST ledgers — the
  // GST entries below already include their majority-rate fold, and Tally's
  // voucher/tax-analysis expects the charges above the taxes they feed into.
  // No `appropriatefor` tag, so Tally won't re-apportion GST itself.
  // GST-free freight instead goes at the END (after round-off).
  if (invoice.freightAmount > 0 && invoice.freightTaxable) {
    ledgerentries.push({
      ledgername: cfg.freightLedger,
      isdeemedpositive: true, ispartyledger: false,
      amount: neg(invoice.freightAmount),
    })
  }
  if (invoice.headerDiscountAmount > 0) {
    ledgerentries.push({
      ledgername: cfg.discountLedger,
      isdeemedpositive: true, ispartyledger: false,
      amount: invoice.headerDiscountAmount.toFixed(2),
    })
  }
  // GST-free extra charges — debit like freight, but never in any GST base.
  if (invoice.otherCharges > 0) {
    if (!cfg.otherChargesLedger) throw new Error('otherCharges > 0 but otherChargesLedger not configured')
    ledgerentries.push({
      ledgername: cfg.otherChargesLedger,
      isdeemedpositive: true, ispartyledger: false,
      amount: neg(invoice.otherCharges),
    })
  }

  // Per-rate GST ledgers LAST (before round-off) — amounts already include
  // the freight/discount fold for the majority rate (see computeInvoiceTotals).
  // Grouped by ledgername to avoid sending duplicate ledger lines.
  if (!isUnreg) {
    const groupedGst: Record<string, number> = {}
    if (isIntra) {
      // Per-line-rounded head amounts (see computeInvoiceTotals) so
      // CGST = SGST exactly, matching Tally's own expected-tax computation.
      for (const [rate, half] of Object.entries(totals.gstHalfByRate)) {
        if (half === 0) continue
        const halfRate = String(parseFloat(rate) / 2)
        const cgstLedger = cfg.gstLedgers.CGST[halfRate]
        const sgstLedger = cfg.gstLedgers.SGST[halfRate]
        if (!cgstLedger) throw new Error(`CGST ledger for ${halfRate}% not configured`)
        if (!sgstLedger) throw new Error(`SGST ledger for ${halfRate}% not configured`)
        groupedGst[cgstLedger] = +((groupedGst[cgstLedger] || 0) + half).toFixed(2)
        groupedGst[sgstLedger] = +((groupedGst[sgstLedger] || 0) + half).toFixed(2)
      }
    } else {
      for (const [rate, gstAmt] of Object.entries(totals.gstByRate)) {
        if (gstAmt === 0) continue
        const igstLedger = cfg.gstLedgers.IGST[rate]
        if (!igstLedger) throw new Error(`IGST ledger for ${rate}% not configured`)
        groupedGst[igstLedger] = +((groupedGst[igstLedger] || 0) + gstAmt).toFixed(2)
      }
    }
    for (const [ledgername, amt] of Object.entries(groupedGst)) {
      ledgerentries.push({
        ledgername,
        isdeemedpositive: true, ispartyledger: false,
        amount: neg(amt), vatexpamount: neg(amt),
      })
    }
  }

  // ── Round-off ───────────────────────────────────────────────────
  // Rounding UP (roundOff > 0) is an extra expense → debit: deemedpositive
  // with a negative amount, same convention as the GST/freight entries.
  // Rounding DOWN is income → credit: positive amount, not deemedpositive.
  if (Math.abs(totals.roundOff) > 0.001) {
    const roundAmt = totals.roundOff > 0 ? neg(totals.roundOff) : Math.abs(totals.roundOff).toFixed(2)
    ledgerentries.push({
      ledgername: cfg.roundOffLedger,
      isdeemedpositive: totals.roundOff > 0, ispartyledger: false,
      amount: roundAmt, vatexpamount: roundAmt,
    })
  }
  // GST-free freight LAST — shown at the end of the voucher
  // (Input GST → Round Off → Freight), like the manually-corrected vouchers.
  if (invoice.freightAmount > 0 && !invoice.freightTaxable) {
    if (!cfg.freightNoGstLedger) throw new Error('Freight is GST-free but freightNoGstLedger not configured')
    ledgerentries.push({
      ledgername: cfg.freightNoGstLedger,
      isdeemedpositive: true, ispartyledger: false,
      amount: neg(invoice.freightAmount),
    })
  }
  // Party total mirrors invoice creation: rounded GST total + GST-free extras.
  ledgerentries[0].amount = (totals.total + invoice.otherCharges).toFixed(2)

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
    // Tally Prime emits unquoted numbers and bareword vchnumber, so JSON.parse fails.
    // Each field can be quoted-string OR unquoted token — accept both.
    const grab = (k: string) =>
      (text.match(new RegExp(`"${k}"\\s*:\\s*"([^"]+)"`)) || [])[1] ??
      (text.match(new RegExp(`"${k}"\\s*:\\s*([^,\\s}]+)`)) || [])[1]
    const created = grab('created')
    const altered = grab('altered')
    const lastvchid = grab('lastvchid')
    const vchkey = grab('vchkey')
    const vchnumber = grab('vchnumber')
    const errors = grab('errors')
    const exceptions = grab('exceptions')
    parsed = { fallback: true, created, altered, lastvchid, vchkey, vchnumber, errors, exceptions, raw: text }
  }
  return { http: res.status, body: text, parsed }
}
