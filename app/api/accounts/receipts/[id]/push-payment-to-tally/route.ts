export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

// POST /api/accounts/receipts/[id]/push-payment-to-tally
//
// CREATES a Payment voucher in Tally for a refund row (KsiHdfcReceipt
// with direction='out', vchType='Payment', refundForReceiptId pointing at
// the source Receipt). Sign convention mirrors the receipt-push code:
//
//   Party leg: ISDEEMEDPOSITIVE=Yes, +amount (Dr to party)
//   HDFC leg : ISDEEMEDPOSITIVE=No,  -amount (Cr bank) with BANKALLOCATIONS
//
// Bill-allocation against the source receipt's vchNumber as "Agst Ref"
// (negative amount) — so Tally nets the refund against the original
// receipt's on-account credit, clearing the party's excess.
//
// Idempotent against accidental double-tap: blocks if tallyPushedAt is
// already set on this Payment row.

const escapeXml = (s: any) => (s == null ? '' : String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;'))

const ymd = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`

const COMPANY = 'Kothari Synthetic Industries -( from 2023)'
const HDFC_LEDGER = 'HDFC BANK'
// Same bank UUID the receipt push uses; Tally regenerates if mismatched.
const BANK_NAME_UUID = 'a45a95d2-94d1-4fba-a75c-d443564c662a'

function buildTallyHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'text/xml',
    version: '1', tallyrequest: 'Import', type: 'Data', id: 'Vouchers',
  }
  if (process.env.CF_ACCESS_CLIENT_ID) headers['CF-Access-Client-Id'] = process.env.CF_ACCESS_CLIENT_ID
  if (process.env.CF_ACCESS_CLIENT_SECRET) headers['CF-Access-Client-Secret'] = process.env.CF_ACCESS_CLIENT_SECRET
  return headers
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = parseInt(params.id)
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  const force = new URL(req.url).searchParams.get('force') === '1'

  const tunnelUrl = process.env.TALLY_TUNNEL_URL
  if (!tunnelUrl) return NextResponse.json({ error: 'TALLY_TUNNEL_URL not configured' }, { status: 500 })

  const payment = await db.ksiHdfcReceipt.findUnique({
    where: { id },
    include: { refundForReceipt: { select: { id: true, vchNumber: true } } },
  })
  if (!payment) return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
  if (payment.vchType !== 'Payment' || payment.direction !== 'out') {
    return NextResponse.json({ error: `Only Payment rows (direction=out) can be pushed (got ${payment.vchType}/${payment.direction})` }, { status: 400 })
  }
  if (!payment.refundForReceipt) {
    return NextResponse.json({ error: 'Payment has no linked source Receipt — refundForReceiptId is null' }, { status: 400 })
  }
  if (payment.tallyPushedAt && !force) {
    return NextResponse.json({
      error: 'Payment already pushed to Tally. Use force=1 to re-push (will create a duplicate voucher).',
      tallyPushedAt: payment.tallyPushedAt,
    }, { status: 409 })
  }

  const dateStr = ymd(payment.date)
  const partyName = payment.partyName
  const amt = Math.round(payment.amount)
  const sourceVch = payment.refundForReceipt.vchNumber

  // Build the Payment voucher XML — CREATE action.
  // Party leg is Dr (+amt, ISDEEMEDPOSITIVE=Yes), bank leg is Cr (-amt).
  // Bill-allocation against source Receipt's vchNumber as Agst Ref with
  // a NEGATIVE amount — Tally treats this as knocking off the party's
  // existing on-account from the source receipt.
  const xml = `<ENVELOPE>
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
        <VOUCHER DATE="${dateStr}" VCHTYPE="Payment" ACTION="Create" OBJVIEW="Accounting Voucher View">
          <DATE>${dateStr}</DATE>
          <EFFECTIVEDATE>${dateStr}</EFFECTIVEDATE>
          <VOUCHERTYPENAME>Payment</VOUCHERTYPENAME>
          <VOUCHERNUMBER>${escapeXml(payment.vchNumber)}</VOUCHERNUMBER>
          <PARTYLEDGERNAME>${escapeXml(partyName)}</PARTYLEDGERNAME>
          <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>

          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${escapeXml(partyName)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
            <AMOUNT>-${amt}</AMOUNT>
            <BILLALLOCATIONS.LIST>
              <NAME>${escapeXml(sourceVch)}</NAME>
              <BILLTYPE>Agst Ref</BILLTYPE>
              <AMOUNT>-${amt}</AMOUNT>
            </BILLALLOCATIONS.LIST>
          </ALLLEDGERENTRIES.LIST>

          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${HDFC_LEDGER}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
            <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
            <AMOUNT>${amt}</AMOUNT>
            <BANKALLOCATIONS.LIST>
              <DATE>${dateStr}</DATE>
              <INSTRUMENTDATE>${dateStr}</INSTRUMENTDATE>
              <BANKERSDATE>${dateStr}</BANKERSDATE>
              <NAME>${BANK_NAME_UUID}</NAME>
              <TRANSACTIONTYPE>Others</TRANSACTIONTYPE>
              <PAYMENTFAVOURING>${escapeXml(partyName)}</PAYMENTFAVOURING>
              <INSTRUMENTNUMBER>${escapeXml(payment.instrumentNo || '')}</INSTRUMENTNUMBER>
              <UNIQUEREFERENCENUMBER>${escapeXml(payment.bankRef || '')}</UNIQUEREFERENCENUMBER>
              <PAYMENTMODE>Transacted</PAYMENTMODE>
              <BANKPARTYNAME>${escapeXml(partyName)}</BANKPARTYNAME>
              <BANKMANUALSTATUS>Reconciled</BANKMANUALSTATUS>
              <AMOUNT>${amt}</AMOUNT>
            </BANKALLOCATIONS.LIST>
          </ALLLEDGERENTRIES.LIST>
        </VOUCHER>
      </TALLYMESSAGE>
    </DATA>
  </BODY>
</ENVELOPE>`

  let res: Response
  try {
    res = await fetch(tunnelUrl, { method: 'POST', headers: buildTallyHeaders(), body: xml })
  } catch (e: any) {
    return NextResponse.json({ error: `Tally tunnel unreachable: ${e?.message || 'network'}` }, { status: 502 })
  }
  const text = await res.text()
  const m = (tag: string) => (text.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) || [])[1]
  const created = Number(m('CREATED') || 0)
  const errors = Number(m('ERRORS') || 0)
  const exceptions = Number(m('EXCEPTIONS') || 0)
  const lineError = m('LINEERROR') || undefined
  const ok = res.ok && errors === 0 && exceptions === 0 && created > 0

  if (!ok) {
    return NextResponse.json({
      ok: false,
      error: lineError || `Tally rejected the push (created=${created}, errors=${errors}, exceptions=${exceptions})`,
      raw: text.slice(0, 1000),
    }, { status: 502 })
  }

  await db.ksiHdfcReceipt.update({ where: { id }, data: { tallyPushedAt: new Date() } })

  return NextResponse.json({
    ok: true,
    created, errors, exceptions,
    payment: { id, vchNumber: payment.vchNumber, amount: amt, partyName },
    againstReceipt: sourceVch,
  })
}
