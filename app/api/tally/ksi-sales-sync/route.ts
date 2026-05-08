export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const KSI_TALLY = 'Kothari Synthetic Industries -( from 2023)'
const SALES_TYPES = ['Process Job']

const pad = (n: number) => String(n).padStart(2, '0')
function isoToYYYYMMDD(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
}
function fyOf(date: Date): string {
  const y = date.getFullYear(), m = date.getMonth()
  const start = m < 3 ? y - 1 : y
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`
}
function parseTallyDate(s: string): Date | null {
  const t = s.trim()
  if (/^\d{8}$/.test(t)) return new Date(`${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T00:00:00`)
  const d = new Date(t)
  return isNaN(d.getTime()) ? null : d
}
const dec = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")

function pickTag(block: string, tag: string): string {
  return dec(block.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`))?.[1] || '')
}
function parseAmount(s: string): number {
  const v = parseFloat(s.replace(/,/g, '').replace(/[^\d.\-]/g, '')) || 0
  return v
}
function parseRate(s: string): { rate: number | null; unit: string | null } {
  // e.g. "175.00/THAN" or "44.00/MTR"
  const m = s.match(/([\d.]+)\s*\/\s*(\w+)/)
  if (!m) return { rate: null, unit: null }
  return { rate: parseFloat(m[1]), unit: m[2] }
}
function parseQty(s: string): {
  qty: number | null; unit: string | null; altQty: number | null; altUnit: string | null
} {
  // " 420.0 THAN"           → qty=420, unit=THAN
  // "834.00 MTR = 35 PCS"   → qty=834, unit=MTR, altQty=35, altUnit=PCS
  const trimmed = s.trim()
  const dual = trimmed.match(/([\d.]+)\s*(\w+)\s*=\s*([\d.]+)\s*(\w+)/)
  if (dual) return { qty: parseFloat(dual[1]), unit: dual[2], altQty: parseFloat(dual[3]), altUnit: dual[4] }
  const single = trimmed.match(/([\d.]+)\s*(\w+)?/)
  if (!single) return { qty: null, unit: null, altQty: null, altUnit: null }
  return { qty: parseFloat(single[1]), unit: single[2] || null, altQty: null, altUnit: null }
}

interface ParsedLine {
  lineNo: number
  stockItem: string
  rawQty: string | null
  qty: number | null
  unit: string | null
  altQty: number | null
  altUnit: string | null
  rate: number | null
  rateUnit: string | null
  amount: number
  discountPct: number | null
  baleNo: string | null
}

interface ParsedLedger {
  ledgerName: string
  amount: number
  isDeemedPositive: boolean
}

interface ParsedVoucher {
  date: Date
  fy: string
  vchNumber: string
  vchType: string
  partyName: string
  partyGstin: string | null
  stateName: string | null
  placeOfSupply: string | null
  totalAmount: number
  taxableAmount: number | null
  cgstAmount: number | null
  sgstAmount: number | null
  igstAmount: number | null
  roundOff: number | null
  narration: string | null
  reference: string | null
  buyerPO: string | null
  transporter: string | null
  agentName: string | null
  lines: ParsedLine[]
  ledgers: ParsedLedger[]
}

function parseVouchers(xml: string): ParsedVoucher[] {
  const out: ParsedVoucher[] = []
  const blocks = xml.match(/<VOUCHER[^>]*>[\s\S]*?<\/VOUCHER>/g) || []
  for (const b of blocks) {
    const dateStr = pickTag(b, 'DATE')
    const date = parseTallyDate(dateStr)
    if (!date) continue
    const vchNumber = pickTag(b, 'VOUCHERNUMBER')
    const vchType = pickTag(b, 'VOUCHERTYPENAME')
    if (!vchNumber || !vchType) continue
    const partyName = pickTag(b, 'PARTYLEDGERNAME') || pickTag(b, 'PARTYNAME')

    // Lines
    const invBlocks = b.match(/<ALLINVENTORYENTRIES\.LIST[^>]*>[\s\S]*?<\/ALLINVENTORYENTRIES\.LIST>/g) || []
    const lines: ParsedLine[] = []
    let taxable = 0
    invBlocks.forEach((il, i) => {
      const stockItem = pickTag(il, 'STOCKITEMNAME')
      if (!stockItem) return
      const rawQty = pickTag(il, 'ACTUALQTY') || pickTag(il, 'BILLEDQTY')
      const { qty, unit: qtyUnit, altQty, altUnit } = parseQty(rawQty)
      const rateStr = pickTag(il, 'RATE')
      const { rate, unit: rateUnit } = parseRate(rateStr)
      const amount = parseAmount(pickTag(il, 'AMOUNT'))
      const discPct = parseFloat(pickTag(il, 'DISCOUNT')) || null
      const bale = dec(il.match(/<UDF:AVITMTOTBALNO(?![A-Z0-9_])[^>]*>([^<]*)<\/UDF:AVITMTOTBALNO>/)?.[1] || '') || null
      lines.push({
        lineNo: i + 1,
        stockItem,
        rawQty: rawQty || null,
        qty,
        unit: qtyUnit,
        altQty,
        altUnit,
        rate,
        rateUnit,
        amount: Math.abs(amount),
        discountPct: discPct,
        baleNo: bale,
      })
      taxable += Math.abs(amount)
    })

    // Ledger entries — categorise common known ones (CGST/SGST/IGST/RoundOff)
    // for the headline columns AND store EVERY entry verbatim so the user can
    // map any new ledger name to extra-charge / discount / ignore in the UI.
    const ledBlocks = b.match(/<ALLLEDGERENTRIES\.LIST[^>]*>[\s\S]*?<\/ALLLEDGERENTRIES\.LIST>/g) || []
    let cgst = 0, sgst = 0, igst = 0, roundOff = 0
    const ledgers: ParsedLedger[] = []
    for (const lb of ledBlocks) {
      const ledgerName = pickTag(lb, 'LEDGERNAME')
      if (!ledgerName) continue
      const signedAmt = parseAmount(pickTag(lb, 'AMOUNT'))
      const idp = pickTag(lb, 'ISDEEMEDPOSITIVE').toLowerCase() === 'yes'
      const lname = ledgerName.toLowerCase()
      const absAmt = Math.abs(signedAmt)
      if (/cgst/.test(lname)) cgst += absAmt
      else if (/sgst|utgst/.test(lname)) sgst += absAmt
      else if (/igst/.test(lname)) igst += absAmt
      else if (/round/.test(lname)) roundOff += absAmt
      ledgers.push({ ledgerName, amount: signedAmt, isDeemedPositive: idp })
    }

    const totalAmount = Math.abs(parseAmount(pickTag(b, 'AMOUNT')))

    // UDFs
    const agentName = dec(b.match(/<UDF:AGENTNMVCH_PCDOE26(?![A-Z0-9_])[^>]*>([^<]*)<\/UDF:AGENTNMVCH_PCDOE26>/)?.[1] || '') || null

    out.push({
      date,
      fy: fyOf(date),
      vchNumber,
      vchType,
      partyName,
      partyGstin: pickTag(b, 'PARTYGSTIN') || null,
      stateName: pickTag(b, 'STATENAME') || null,
      placeOfSupply: pickTag(b, 'PLACEOFSUPPLY') || null,
      totalAmount,
      taxableAmount: taxable || null,
      cgstAmount: cgst || null,
      sgstAmount: sgst || null,
      igstAmount: igst || null,
      roundOff: roundOff || null,
      narration: pickTag(b, 'NARRATION') || null,
      reference: pickTag(b, 'REFERENCE') || null,
      buyerPO: pickTag(b, 'BASICPURCHASEORDERNO') || pickTag(b, 'BASICORDERREF') || null,
      transporter: pickTag(b, 'BASICSHIPPEDBY') || null,
      agentName,
      lines,
      ledgers,
    })
  }
  return out
}

function buildXML(fromYMD: string, toYMD: string): string {
  const typeFilter = SALES_TYPES.map(t => `$VoucherTypeName="${t}"`).join(' OR ')
  return `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>KsiSalesVouchers</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <SVCURRENTCOMPANY>${KSI_TALLY}</SVCURRENTCOMPANY>
        <SVFROMDATE>${fromYMD}</SVFROMDATE>
        <SVTODATE>${toYMD}</SVTODATE>
      </STATICVARIABLES>
      <TDL><TDLMESSAGE>
        <COLLECTION NAME="KsiSalesVouchers" ISMODIFY="No">
          <TYPE>Voucher</TYPE>
          <FETCH>Date,VoucherNumber,VoucherTypeName,PartyLedgerName,PartyName,PartyGSTIN,StateName,PlaceOfSupply,Amount,Narration,Reference,BasicShippedBy,BasicPurchaseOrderNo,BasicOrderRef,AllInventoryEntries,AllLedgerEntries</FETCH>
          <FILTER>KsiSalesFilter</FILTER>
        </COLLECTION>
        <SYSTEM TYPE="Formulae" NAME="KsiSalesFilter">(${typeFilter}) AND $Date &gt;= $$Date:"${fromYMD}" AND $Date &lt;= $$Date:"${toYMD}"</SYSTEM>
      </TDLMESSAGE></TDL>
    </DESC>
  </BODY>
</ENVELOPE>`
}

// POST /api/tally/ksi-sales-sync — Body: { from?, to? } (YYYY-MM-DD)
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tunnelUrl = process.env.TALLY_TUNNEL_URL
  if (!tunnelUrl) return NextResponse.json({ error: 'TALLY_TUNNEL_URL not configured' }, { status: 500 })

  const body = await req.json().catch(() => ({}))
  const from = body.from || '2025-04-01'
  const to = body.to || new Date().toISOString().slice(0, 10)

  const headers: Record<string, string> = { 'Content-Type': 'text/xml' }
  if (process.env.TALLY_API_SECRET) headers['X-Tally-Key'] = process.env.TALLY_API_SECRET
  if (process.env.CF_ACCESS_CLIENT_ID) headers['CF-Access-Client-Id'] = process.env.CF_ACCESS_CLIENT_ID
  if (process.env.CF_ACCESS_CLIENT_SECRET) headers['CF-Access-Client-Secret'] = process.env.CF_ACCESS_CLIENT_SECRET

  let res: Response
  try {
    res = await fetch(tunnelUrl, {
      method: 'POST',
      headers,
      body: buildXML(isoToYYYYMMDD(from), isoToYYYYMMDD(to)),
    })
  } catch (e: any) {
    return NextResponse.json({ error: `Tally tunnel unreachable: ${e?.message || 'network error'}` }, { status: 502 })
  }
  if (!res.ok) return NextResponse.json({ error: `Tally HTTP ${res.status}` }, { status: 502 })

  const xml = await res.text()
  const vouchers = parseVouchers(xml)

  // Defensive: re-filter by date in case Tally returns out-of-range vouchers
  const fromMs = new Date(from + 'T00:00:00').getTime()
  const toMs = new Date(to + 'T23:59:59').getTime()
  const inRange = vouchers.filter(v => {
    const t = v.date.getTime()
    return t >= fromMs && t <= toMs
  })

  const db = prisma as any
  let saved = 0
  const now = new Date()
  for (const v of inRange) {
    // Upsert invoice; replace its lines on each sync (lines are derived;
    // there's no manual data on them).
    const invoice = await db.ksiSalesInvoice.upsert({
      where: { ksi_sales_natural_key: { vchNumber: v.vchNumber, date: v.date, vchType: v.vchType } },
      create: {
        fy: v.fy, date: v.date, vchNumber: v.vchNumber, vchType: v.vchType,
        partyName: v.partyName, partyGstin: v.partyGstin, stateName: v.stateName, placeOfSupply: v.placeOfSupply,
        totalAmount: v.totalAmount, taxableAmount: v.taxableAmount,
        cgstAmount: v.cgstAmount, sgstAmount: v.sgstAmount, igstAmount: v.igstAmount, roundOff: v.roundOff,
        narration: v.narration, reference: v.reference, buyerPO: v.buyerPO, transporter: v.transporter, agentName: v.agentName,
        lastSynced: now,
      },
      update: {
        fy: v.fy,
        partyName: v.partyName, partyGstin: v.partyGstin, stateName: v.stateName, placeOfSupply: v.placeOfSupply,
        totalAmount: v.totalAmount, taxableAmount: v.taxableAmount,
        cgstAmount: v.cgstAmount, sgstAmount: v.sgstAmount, igstAmount: v.igstAmount, roundOff: v.roundOff,
        narration: v.narration, reference: v.reference, buyerPO: v.buyerPO, transporter: v.transporter, agentName: v.agentName,
        lastSynced: now,
      },
    })
    await db.ksiSalesInvoiceLine.deleteMany({ where: { invoiceId: invoice.id } })
    if (v.lines.length > 0) {
      await db.ksiSalesInvoiceLine.createMany({
        data: v.lines.map(l => ({ ...l, invoiceId: invoice.id })),
      })
    }
    // Replace ledger entries fully — these are derived from Tally, no
    // user-edit data lives on this table (categorisation lives on
    // KsiSalesLedgerCategory keyed by ledgerName).
    await db.ksiSalesInvoiceLedger.deleteMany({ where: { invoiceId: invoice.id } })
    if (v.ledgers.length > 0) {
      await db.ksiSalesInvoiceLedger.createMany({
        data: v.ledgers.map(l => ({ ...l, invoiceId: invoice.id })),
      })
    }
    saved++
  }

  return NextResponse.json({
    fetched: vouchers.length,
    inRange: inRange.length,
    saved,
    range: { from, to },
    types: SALES_TYPES,
  })
}
