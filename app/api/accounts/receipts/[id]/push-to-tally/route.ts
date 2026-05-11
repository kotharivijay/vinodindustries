export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// POST /api/accounts/receipts/[id]/push-to-tally
//
// Three-step push (mirrors the proven manual scripts):
//   1. ALTER the existing receipt voucher in Tally to add bill-wise
//      allocations (Agst Ref per invoice / CN / On-account).
//   2. CREATE a Journal voucher for the linked TDS (if > 0).
//   3. CREATE a Journal voucher for the linked Discount (if > 0).
//
// TDS / Discount only ever apply to non-CN allocations (server forces
// them to 0 on CN rows at allocate-time). CN allocations carry into the
// receipt's BILLALLOCATIONS with NEGATIVE amount — Tally then knocks
// the CN off the party ledger at the same time as the invoice.
//
// All amounts are rounded to whole rupees per user directive ("no decimals").

const escapeXml = (s: any) => (s == null ? '' : String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;'))

const ymd = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`

const COMPANY = 'Kothari Synthetic Industries -( from 2023)'
const HDFC_LEDGER = 'HDFC BANK'
const TDS_LEDGER = 'Tds Recivable  (JOB)'
const DISCOUNT_LEDGER = 'Discount'
// Bank UUID reused from the receipt #31 working push — Tally regenerates
// if it doesn't match. Bank-allocations only matter for the receipt; the
// two journals don't touch the bank.
const BANK_NAME_UUID = 'a45a95d2-94d1-4fba-a75c-d443564c662a'

type PushResult = { kind: string; ok: boolean; created: number; altered: number; errors: number; exceptions: number; lineError?: string; lastVchId?: string; raw?: string }

function buildTallyHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'text/xml',
    version: '1', tallyrequest: 'Import', type: 'Data', id: 'Vouchers',
  }
  if (process.env.CF_ACCESS_CLIENT_ID) headers['CF-Access-Client-Id'] = process.env.CF_ACCESS_CLIENT_ID
  if (process.env.CF_ACCESS_CLIENT_SECRET) headers['CF-Access-Client-Secret'] = process.env.CF_ACCESS_CLIENT_SECRET
  return headers
}

async function postToTally(xml: string, kind: string): Promise<PushResult> {
  const url = process.env.TALLY_TUNNEL_URL
  if (!url) return { kind, ok: false, created: 0, altered: 0, errors: 1, exceptions: 0, lineError: 'TALLY_TUNNEL_URL not configured' }
  const res = await fetch(url, { method: 'POST', headers: buildTallyHeaders(), body: xml })
  const text = await res.text()
  const m = (tag: string) => (text.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) || [])[1]
  const created = Number(m('CREATED') || 0)
  const altered = Number(m('ALTERED') || 0)
  const errors = Number(m('ERRORS') || 0)
  const exceptions = Number(m('EXCEPTIONS') || 0)
  const lineError = m('LINEERROR') || undefined
  const lastVchId = m('LASTVCHID') || undefined
  const ok = res.ok && errors === 0 && exceptions === 0 && (created + altered > 0)
  return { kind, ok, created, altered, errors, exceptions, lineError, lastVchId, raw: text.slice(0, 800) }
}

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = parseInt(params.id)
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })

  const db = prisma as any
  const url = new URL(_req.url)
  const force = url.searchParams.get('force') === '1'
  const receipt = await db.ksiHdfcReceipt.findUnique({
    where: { id },
    include: { allocations: { include: { invoice: { select: { vchNumber: true, vchType: true } } } } },
  })
  if (!receipt) return NextResponse.json({ error: 'Receipt not found' }, { status: 404 })
  if (receipt.allocations.length === 0) {
    return NextResponse.json({ error: 'Nothing to push — receipt has no linked invoices' }, { status: 400 })
  }
  if (receipt.vchType !== 'Receipt') {
    return NextResponse.json({ error: `Only Receipt vouchers can be pushed (got ${receipt.vchType})` }, { status: 400 })
  }
  // Idempotency: once pushed, block until the caller explicitly forces
  // a re-push (e.g. after editing allocations). Prevents accidental
  // duplicate journals on rapid double-clicks.
  if (receipt.tallyPushedAt && !force) {
    return NextResponse.json({
      error: 'Receipt already pushed to Tally. Use force=1 to re-push (will create duplicate journals).',
      tallyPushedAt: receipt.tallyPushedAt,
    }, { status: 409 })
  }

  const dateStr = ymd(receipt.date)
  const partyName = receipt.partyName

  // Round per-bill to whole rupees, then derive totals from rounded values
  // so all sums balance exactly.
  type Bill = { vch: string; amt: number; isCN: boolean; tds: number; disc: number }
  const bills: Bill[] = receipt.allocations.map((a: any) => ({
    vch: a.invoice.vchNumber,
    amt: Math.round(a.allocatedAmount),
    isCN: a.invoice.vchType === 'Credit Note',
    tds: Math.round(a.tdsAmount || 0),
    disc: Math.round(a.discountAmount || 0),
  })).filter((b: Bill) => b.amt > 0)

  // Signed cash usage of receipt: CN allocations subtract.
  const signedCashUsed = bills.reduce((s, b) => s + (b.isCN ? -b.amt : b.amt), 0)
  const receiptAmt = Math.round(receipt.amount)
  const onAccount = receiptAmt - signedCashUsed  // can be 0 or positive
  if (onAccount < 0) {
    return NextResponse.json({ error: `Allocations exceed receipt amount: signed used ₹${signedCashUsed} > receipt ₹${receiptAmt}` }, { status: 400 })
  }

  // ── 1. Build receipt ALTER XML ──────────────────────────────────────
  // Party Cr = receiptAmt total. Bill allocations breakdown:
  //   • invoice: +amt (Agst Ref)
  //   • CN:      −amt (Agst Ref, knock-off)
  //   • leftover: onAccount as "On Account" (no NAME)
  const billXmlParts: string[] = []
  for (const b of bills) {
    const signedAmt = b.isCN ? -b.amt : b.amt
    billXmlParts.push(`            <BILLALLOCATIONS.LIST>
              <NAME>${escapeXml(b.vch)}</NAME>
              <BILLTYPE>Agst Ref</BILLTYPE>
              <AMOUNT>${signedAmt}</AMOUNT>
            </BILLALLOCATIONS.LIST>`)
  }
  if (onAccount > 0) {
    billXmlParts.push(`            <BILLALLOCATIONS.LIST>
              <BILLTYPE>On Account</BILLTYPE>
              <AMOUNT>${onAccount}</AMOUNT>
            </BILLALLOCATIONS.LIST>`)
  }
  const billAllocsXml = billXmlParts.join('\n')

  const receiptXml = `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Import</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>Vouchers</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVCURRENTCOMPANY>${COMPANY}</SVCURRENTCOMPANY>
      </STATICVARIABLES>
    </DESC>
    <DATA>
      <TALLYMESSAGE xmlns:UDF="TallyUDF">
        <VOUCHER DATE="${dateStr}" VCHTYPE="Receipt" ACTION="Alter" TAGNAME="VOUCHERNUMBER" TAGVALUE="${escapeXml(receipt.vchNumber)}" OBJVIEW="Accounting Voucher View">
          <DATE>${dateStr}</DATE>
          <EFFECTIVEDATE>${dateStr}</EFFECTIVEDATE>
          <VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME>
          <VOUCHERNUMBER>${escapeXml(receipt.vchNumber)}</VOUCHERNUMBER>
          <PARTYLEDGERNAME>${escapeXml(partyName)}</PARTYLEDGERNAME>
          <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>

          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${escapeXml(partyName)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
            <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
            <AMOUNT>${receiptAmt}</AMOUNT>
${billAllocsXml}
          </ALLLEDGERENTRIES.LIST>

          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${HDFC_LEDGER}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
            <AMOUNT>-${receiptAmt}</AMOUNT>
            <BANKALLOCATIONS.LIST>
              <DATE>${dateStr}</DATE>
              <INSTRUMENTDATE>${dateStr}</INSTRUMENTDATE>
              <BANKERSDATE>${dateStr}</BANKERSDATE>
              <NAME>${BANK_NAME_UUID}</NAME>
              <TRANSACTIONTYPE>Others</TRANSACTIONTYPE>
              <PAYMENTFAVOURING>${escapeXml(partyName)}</PAYMENTFAVOURING>
              <INSTRUMENTNUMBER>${escapeXml(receipt.instrumentNo || '')}</INSTRUMENTNUMBER>
              <UNIQUEREFERENCENUMBER>${escapeXml(receipt.bankRef || '')}</UNIQUEREFERENCENUMBER>
              <PAYMENTMODE>Transacted</PAYMENTMODE>
              <BANKPARTYNAME>${escapeXml(partyName)}</BANKPARTYNAME>
              <BANKMANUALSTATUS>Reconciled</BANKMANUALSTATUS>
              <AMOUNT>-${receiptAmt}</AMOUNT>
            </BANKALLOCATIONS.LIST>
          </ALLLEDGERENTRIES.LIST>
        </VOUCHER>
      </TALLYMESSAGE>
    </DATA>
  </BODY>
</ENVELOPE>`

  // ── 2. Build TDS Journal XML (only non-CN bills with tds > 0) ───────
  const tdsBills = bills.filter(b => !b.isCN && b.tds > 0)
  const tdsTotal = tdsBills.reduce((s, b) => s + b.tds, 0)
  const tdsJournalXml = tdsTotal > 0 ? `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Import</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>Vouchers</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVCURRENTCOMPANY>${COMPANY}</SVCURRENTCOMPANY>
      </STATICVARIABLES>
    </DESC>
    <DATA>
      <TALLYMESSAGE xmlns:UDF="TallyUDF">
        <VOUCHER DATE="${dateStr}" VCHTYPE="Journal" ACTION="Create" OBJVIEW="Accounting Voucher View">
          <DATE>${dateStr}</DATE>
          <EFFECTIVEDATE>${dateStr}</EFFECTIVEDATE>
          <VOUCHERTYPENAME>Journal</VOUCHERTYPENAME>
          <NARRATION>TDS for receipt #${escapeXml(receipt.vchNumber)} - ${escapeXml(partyName)}</NARRATION>
          <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>

          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${TDS_LEDGER}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <ISPARTYLEDGER>No</ISPARTYLEDGER>
            <AMOUNT>-${tdsTotal}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>

          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${escapeXml(partyName)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
            <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
            <AMOUNT>${tdsTotal}</AMOUNT>
${tdsBills.map(b => `            <BILLALLOCATIONS.LIST>
              <NAME>${escapeXml(b.vch)}</NAME>
              <BILLTYPE>Agst Ref</BILLTYPE>
              <AMOUNT>${b.tds}</AMOUNT>
            </BILLALLOCATIONS.LIST>`).join('\n')}
          </ALLLEDGERENTRIES.LIST>
        </VOUCHER>
      </TALLYMESSAGE>
    </DATA>
  </BODY>
</ENVELOPE>` : null

  // ── 3. Build Discount Journal XML (only non-CN bills with disc > 0) ─
  const discBills = bills.filter(b => !b.isCN && b.disc > 0)
  const discTotal = discBills.reduce((s, b) => s + b.disc, 0)
  const discJournalXml = discTotal > 0 ? `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Import</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>Vouchers</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVCURRENTCOMPANY>${COMPANY}</SVCURRENTCOMPANY>
      </STATICVARIABLES>
    </DESC>
    <DATA>
      <TALLYMESSAGE xmlns:UDF="TallyUDF">
        <VOUCHER DATE="${dateStr}" VCHTYPE="Journal" ACTION="Create" OBJVIEW="Accounting Voucher View">
          <DATE>${dateStr}</DATE>
          <EFFECTIVEDATE>${dateStr}</EFFECTIVEDATE>
          <VOUCHERTYPENAME>Journal</VOUCHERTYPENAME>
          <NARRATION>Discount for receipt #${escapeXml(receipt.vchNumber)} - ${escapeXml(partyName)}</NARRATION>
          <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>

          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${DISCOUNT_LEDGER}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <ISPARTYLEDGER>No</ISPARTYLEDGER>
            <AMOUNT>-${discTotal}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>

          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${escapeXml(partyName)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
            <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
            <AMOUNT>${discTotal}</AMOUNT>
${discBills.map(b => `            <BILLALLOCATIONS.LIST>
              <NAME>${escapeXml(b.vch)}</NAME>
              <BILLTYPE>Agst Ref</BILLTYPE>
              <AMOUNT>${b.disc}</AMOUNT>
            </BILLALLOCATIONS.LIST>`).join('\n')}
          </ALLLEDGERENTRIES.LIST>
        </VOUCHER>
      </TALLYMESSAGE>
    </DATA>
  </BODY>
</ENVELOPE>` : null

  // ── Push, stopping early if the receipt alter fails ─────────────────
  const results: PushResult[] = []
  const receiptResult = await postToTally(receiptXml, 'receipt-alter')
  results.push(receiptResult)
  if (!receiptResult.ok) {
    return NextResponse.json({ ok: false, results, summary: { receiptAmt, signedCashUsed, onAccount, tdsTotal, discTotal, bills: bills.length } }, { status: 502 })
  }

  if (tdsJournalXml) results.push(await postToTally(tdsJournalXml, 'tds-journal'))
  if (discJournalXml) results.push(await postToTally(discJournalXml, 'disc-journal'))

  const ok = results.every(r => r.ok)
  let tallyPushedAt: Date | null = null
  if (ok) {
    tallyPushedAt = new Date()
    await db.ksiHdfcReceipt.update({ where: { id }, data: { tallyPushedAt } })
  }
  return NextResponse.json({
    ok,
    results,
    tallyPushedAt,
    summary: { receiptAmt, signedCashUsed, onAccount, tdsTotal, discTotal, bills: bills.length },
  }, { status: ok ? 200 : 502 })
}
