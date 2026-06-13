// Tally helpers for the Payroll module — closing-balance lookup + journal push.
//
// Both functions resolve TallyFirmConfig from the firm code (defaulting to
// 'VI' for the Vinod Industries payroll). Cloudflare-Access headers attached
// when configured. Mirrors the proven approach in:
//   scripts/fetch-closing-bal.mjs   (balance lookup)
//   scripts/push-pending-wages.mjs  (journal push)

import { prisma } from '@/lib/prisma'

function decodeTally(s: string | null | undefined): string {
  if (!s) return ''
  return s
    .replace(/&#4;/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#13;/g, '').replace(/&#10;/g, ' ')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .trim()
}

function xmlEsc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

// Parse a Tally CLOSINGBALANCE string. Tally suffixes "Dr"/"Cr" — e.g.
// "1500.00 Dr" means a debit balance (we owe them / they owe us depending
// on group convention). For staff ledgers under "Loans & Advances", a Dr
// balance means we PAID the staff (advance outstanding).
//
// Returns a positive number — the magnitude of the advance. If the balance
// is Cr (we owe them), returns 0 (no advance to deduct).
// Parse a Tally CLOSINGBALANCE string, taking group type into account.
export function parseTallyAdvance(closingStr: string | null | undefined, isLiability: boolean = true): number {
  if (!closingStr) return 0
  const s = String(closingStr).trim()
  const m = s.match(/^(-?[0-9]+(?:\.[0-9]+)?)\s*(Dr|Cr)?$/i)
  if (!m) return 0
  const n = parseFloat(m[1])
  if (!Number.isFinite(n)) return 0
  const suffix = (m[2] || '').toLowerCase()
  
  let type = 'Dr'
  if (suffix === 'cr') type = 'Cr'
  else if (suffix === 'dr') type = 'Dr'
  else {
    // No suffix in Tally XML:
    if (isLiability) {
      // For Liabilities: negative is Debit (Dr/Advance)
      type = n < 0 ? 'Dr' : 'Cr'
    } else {
      // For Assets: positive is Debit (Dr/Advance)
      type = n >= 0 ? 'Dr' : 'Cr'
    }
  }

  return type === 'Dr' ? Math.abs(n) : 0
}

// Format a Date as Tally's YYYYMMDD string.
function fmtTallyDate(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${y}${m}${dd}`
}

// Fetch closing balances for ALL ledgers in a Tally company, returned as a
// case-insensitive name → balance string map. The single-collection
// approach is heavy (~50 MB) but matches the firm's working scripts.
// Filtering by name happens client-side.
//
// asOfDate (optional) — passes SVTODATE so Tally returns the closing
// balance as of that day. Defaults to today; this is what makes "Sync
// Advances" for a previous month return the LIVE advance balance instead
// of the balance frozen at month-end.
export interface TallyLedgerBalance {
  closing: string
  parent: string
  isLiability: boolean
}

// Fetch closing balances for ALL ledgers in a Tally company, returned as a
// case-insensitive name → balance details map.
export async function fetchTallyLedgerBalances(firm: string, asOfDate?: Date): Promise<Map<string, TallyLedgerBalance>> {
  const cfg = await prisma.tallyFirmConfig.findUnique({ where: { firmCode: firm } })
  if (!cfg?.tallyTunnelUrl) throw new Error(`No Tally tunnel URL for firm ${firm}`)

  const headers: Record<string, string> = { 'Content-Type': 'text/xml' }
  if (cfg.cfAccessClientId && cfg.cfAccessClientSecret) {
    headers['CF-Access-Client-Id'] = cfg.cfAccessClientId
    headers['CF-Access-Client-Secret'] = cfg.cfAccessClientSecret
  }

  const toDate = fmtTallyDate(asOfDate || new Date())

  // 1. Fetch Group Hierarchies
  const groupXml = `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>GroupExport</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>${xmlEsc(cfg.tallyCompanyName)}</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="GroupExport" ISMODIFY="No"><TYPE>Group</TYPE><FETCH>Name,Parent</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`
  
  const gRes = await fetch(cfg.tallyTunnelUrl, { method: 'POST', headers, body: groupXml })
  if (!gRes.ok) throw new Error(`Tally Group HTTP ${gRes.status}`)
  const gText = await gRes.text()
  const gBlocks = gText.match(/<GROUP\s[^>]*>[\s\S]*?<\/GROUP>/g) || []
  
  const groupParentMap = new Map<string, string>()
  for (const block of gBlocks) {
    const name = decodeTally((block.match(/<GROUP\s[^>]*NAME="([^"]+)"/) || [])[1] || '')
    const parent = decodeTally((block.match(/<PARENT[^>]*>([^<]*)<\/PARENT>/) || [])[1] || '')
    if (name) {
      groupParentMap.set(name.toLowerCase().trim(), parent.toLowerCase().trim())
    }
  }

  function isLiabilityGroup(groupName: string): boolean {
    let current = (groupName || '').toLowerCase().trim()
    let safety = 0
    while (current && safety < 12) {
      if (current === 'sundry creditors' || current === 'current liabilities' || current === 'suspense account') {
        return true
      }
      if (current === 'sundry debtors' || current === 'current assets' || current === 'loans & advances (asset)' || current === 'loans (asset)') {
        return false
      }
      const parent = groupParentMap.get(current)
      if (!parent || parent === current) break
      current = parent
      safety++
    }
    return /creditor|liability|loan|payable/i.test(groupName) && !/asset|receivable/i.test(groupName)
  }

  // 2. Fetch Ledgers with Parents
  const xml = `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>LedgerClosingBal</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>${xmlEsc(cfg.tallyCompanyName)}</SVCURRENTCOMPANY><SVTODATE>${toDate}</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="LedgerClosingBal" ISMODIFY="No"><TYPE>Ledger</TYPE><FETCH>Name,Parent,ClosingBalance</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`
  const res = await fetch(cfg.tallyTunnelUrl, { method: 'POST', headers, body: xml })
  if (!res.ok) throw new Error(`Tally Ledger HTTP ${res.status}`)
  const text = await res.text()

  const out = new Map<string, TallyLedgerBalance>()
  const blocks = text.match(/<LEDGER\s[^>]*>[\s\S]*?<\/LEDGER>/g) || []
  for (const block of blocks) {
    const name = decodeTally((block.match(/<LEDGER\s[^>]*NAME="([^"]+)"/) || [])[1] || '')
    if (!name) continue
    const parent = decodeTally((block.match(/<PARENT[^>]*>([^<]*)<\/PARENT>/) || [])[1] || '')
    const closing = decodeTally((block.match(/<CLOSINGBALANCE[^>]*>([^<]*)<\/CLOSINGBALANCE>/) || [])[1] || '')
    
    out.set(name.toLowerCase(), {
      closing,
      parent,
      isLiability: isLiabilityGroup(parent)
    })
  }
  return out
}

// Push ONE Journal voucher PER STAFF (Dr wages / Cr staff ledger) instead
// of one consolidated voucher with N Cr legs. Each leg's amount is rounded
// to a whole rupee. Returns per-leg results so the caller can record each
// staff's individual voucher id and retry only the failed ones.
export async function postWageJournal(
  firm: string,
  opts: {
    voucherDateYYYYMMDD: string // 20260507
    wagesLedger: string // "WAGES AND SALARY"
    narration: string // base narration; staff name is appended per voucher
    legs: { staffLedger: string; amount: number; staffName?: string }[]
  }
): Promise<{
  ok: boolean
  postedCount: number
  failedCount: number
  results: { staffLedger: string; amount: number; ok: boolean; vchId: string | null; error?: string; raw?: string }[]
}> {
  const cfg = await prisma.tallyFirmConfig.findUnique({ where: { firmCode: firm } })
  if (!cfg?.tallyTunnelUrl) throw new Error(`No Tally tunnel URL for firm ${firm}`)

  const headers: Record<string, string> = { 'Content-Type': 'text/xml' }
  if (cfg.cfAccessClientId && cfg.cfAccessClientSecret) {
    headers['CF-Access-Client-Id'] = cfg.cfAccessClientId
    headers['CF-Access-Client-Secret'] = cfg.cfAccessClientSecret
  }

  const results: { staffLedger: string; amount: number; ok: boolean; vchId: string | null; error?: string; raw?: string }[] = []
  let postedCount = 0
  let failedCount = 0

  for (const leg of opts.legs) {
    const amt = Math.round(leg.amount)
    if (amt <= 0) {
      results.push({ staffLedger: leg.staffLedger, amount: amt, ok: false, vchId: null, error: 'amount <= 0 after rounding' })
      failedCount++
      continue
    }
    const perVoucherNarration = leg.staffName
      ? `${opts.narration} — ${leg.staffName}`
      : opts.narration
    const wagesLeg = `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${xmlEsc(opts.wagesLedger)}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-${amt}</AMOUNT></ALLLEDGERENTRIES.LIST>`
    const staffLeg = `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${xmlEsc(leg.staffLedger)}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${amt}</AMOUNT></ALLLEDGERENTRIES.LIST>`
    const voucher = `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Import</TALLYREQUEST><TYPE>Data</TYPE><ID>Vouchers</ID></HEADER><BODY><DESC><STATICVARIABLES><SVCURRENTCOMPANY>${xmlEsc(cfg.tallyCompanyName)}</SVCURRENTCOMPANY></STATICVARIABLES></DESC><DATA><TALLYMESSAGE><VOUCHER VCHTYPE="Journal" ACTION="Create" OBJVIEW="Accounting Voucher View"><DATE>${opts.voucherDateYYYYMMDD}</DATE><EFFECTIVEDATE>${opts.voucherDateYYYYMMDD}</EFFECTIVEDATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><ISINVOICE>No</ISINVOICE><NARRATION>${xmlEsc(perVoucherNarration)}</NARRATION>${wagesLeg}${staffLeg}</VOUCHER></TALLYMESSAGE></DATA></BODY></ENVELOPE>`

    try {
      const res = await fetch(cfg.tallyTunnelUrl, { method: 'POST', headers, body: voucher })
      const raw = await res.text()
      const created = parseInt((raw.match(/<CREATED[^>]*>(\d+)<\/CREATED>/) || [])[1] || '0', 10)
      const errors = parseInt((raw.match(/<ERRORS[^>]*>(\d+)<\/ERRORS>/) || [])[1] || '0', 10)
      const exceptions = parseInt((raw.match(/<EXCEPTIONS[^>]*>(\d+)<\/EXCEPTIONS>/) || [])[1] || '0', 10)
      const vchId = decodeTally((raw.match(/<LASTVCHID[^>]*>([^<]+)<\/LASTVCHID>/) || [])[1] || '') || null
      const ok = created > 0 && errors === 0 && exceptions === 0
      if (ok) { postedCount++; results.push({ staffLedger: leg.staffLedger, amount: amt, ok: true, vchId }) }
      else { failedCount++; results.push({ staffLedger: leg.staffLedger, amount: amt, ok: false, vchId, error: `created=${created} errors=${errors} exceptions=${exceptions}`, raw: raw.slice(0, 400) }) }
    } catch (e) {
      failedCount++
      results.push({ staffLedger: leg.staffLedger, amount: amt, ok: false, vchId: null, error: (e as Error).message })
    }
  }

  return { ok: failedCount === 0 && postedCount > 0, postedCount, failedCount, results }
}

export interface TallyBankDetails {
  accountNumber: string
  ifsc: string
  bankName: string
  branch: string
}

export async function fetchTallyBankDetails(firm: string): Promise<Map<string, TallyBankDetails>> {
  const cfg = await prisma.tallyFirmConfig.findUnique({ where: { firmCode: firm } })
  if (!cfg?.tallyTunnelUrl) throw new Error(`No Tally tunnel URL for firm ${firm}`)

  const headers: Record<string, string> = { 'Content-Type': 'text/xml' }
  if (cfg.cfAccessClientId && cfg.cfAccessClientSecret) {
    headers['CF-Access-Client-Id'] = cfg.cfAccessClientId
    headers['CF-Access-Client-Secret'] = cfg.cfAccessClientSecret
  }

  const queryXml = `<ENVELOPE>
    <HEADER>
      <VERSION>1</VERSION>
      <TALLYREQUEST>Export</TALLYREQUEST>
      <TYPE>Collection</TYPE>
      <ID>LedgerBankDetails</ID>
    </HEADER>
    <BODY>
      <DESC>
        <STATICVARIABLES>
          <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
          <SVCURRENTCOMPANY>${xmlEsc(cfg.tallyCompanyName)}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
        <TDL>
          <TDLMESSAGE>
            <COLLECTION NAME="LedgerBankDetails" ISMODIFY="No">
              <TYPE>Ledger</TYPE>
              <FETCH>Name,Parent,BANKDETAILS.LIST,PAYMENTDETAILS.LIST</FETCH>
            </COLLECTION>
          </TDLMESSAGE>
        </TDL>
      </DESC>
    </BODY>
  </ENVELOPE>`

  const res = await fetch(cfg.tallyTunnelUrl, { method: 'POST', headers, body: queryXml })
  if (!res.ok) throw new Error(`Tally Bank HTTP ${res.status}`)
  const xml = await res.text()

  const out = new Map<string, TallyBankDetails>()
  const blocks = xml.match(/<LEDGER\s[^>]*>[\s\S]*?<\/LEDGER>/g) || []

  for (const block of blocks) {
    const name = decodeTally((block.match(/<LEDGER\s[^>]*NAME="([^"]+)"/) || [])[1] || '')
    if (!name) continue

    const bankDetailsList = block.match(/<BANKDETAILS\.LIST>([\s\S]*?)<\/BANKDETAILS\.LIST>/g) || []
    const paymentDetailsList = block.match(/<PAYMENTDETAILS\.LIST>([\s\S]*?)<\/PAYMENTDETAILS\.LIST>/g) || []

    let acc = ''
    let ifsc = ''
    let bank = ''
    let branch = ''

    for (const b of [...bankDetailsList, ...paymentDetailsList]) {
      const accNumber = decodeTally((b.match(/<ACCOUNTNUMBER[^>]*>([^<]*)<\/ACCOUNTNUMBER>/) || [])[1] || '')
      const ifscCode = decodeTally((b.match(/<IFSCODE[^>]*>([^<]*)<\/IFSCODE>/) || [])[1] || '')
      const bankName = decodeTally((b.match(/<BANKNAME[^>]*>([^<]*)<\/BANKNAME>/) || [])[1] || '')
      const bankBranch = decodeTally((b.match(/<BANKBRANCH[^>]*>([^<]*)<\/BANKBRANCH>/) || [])[1] || '')

      if (accNumber) acc = accNumber
      if (ifscCode) ifsc = ifscCode
      if (bankName) bank = bankName
      if (bankBranch) branch = bankBranch
    }

    if (acc || ifsc || bank || branch) {
      out.set(name.toLowerCase().trim(), {
        accountNumber: acc,
        ifsc: ifsc,
        bankName: bank,
        branch: branch
      })
    }
  }
  return out
}

export async function postWagePayments(
  firm: string,
  opts: {
    voucherDateYYYYMMDD: string
    bankLedger: string
    narration: string
    payments: {
      staffLedger: string
      amount: number
      accNumber: string
      ifscCode: string
      bankName: string
      uniqueRefNo: string
      allocationName: string
    }[]
  }
): Promise<{ ok: boolean; lastVchId: string | null; created: number; errors: number; exceptions: number; raw: string }> {
  const cfg = await prisma.tallyFirmConfig.findUnique({ where: { firmCode: firm } })
  if (!cfg?.tallyTunnelUrl) throw new Error(`No Tally tunnel URL for firm ${firm}`)

  const headers: Record<string, string> = { 'Content-Type': 'text/xml' }
  if (cfg.cfAccessClientId && cfg.cfAccessClientSecret) {
    headers['CF-Access-Client-Id'] = cfg.cfAccessClientId
    headers['CF-Access-Client-Secret'] = cfg.cfAccessClientSecret
  }

  const messagesXml = opts.payments.map((p) => {
    // Round to whole rupee — Tally Payment voucher should not carry paise.
    const amt = Math.round(p.amount)
    const drLeg = `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${xmlEsc(p.staffLedger)}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-${amt}</AMOUNT></ALLLEDGERENTRIES.LIST>`

    const crLeg = `<ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>${xmlEsc(opts.bankLedger)}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <AMOUNT>${amt}</AMOUNT>
      <BANKALLOCATIONS.LIST>
        <DATE>${opts.voucherDateYYYYMMDD}</DATE>
        <INSTRUMENTDATE>${opts.voucherDateYYYYMMDD}</INSTRUMENTDATE>
        <NAME>${xmlEsc(p.allocationName)}</NAME>
        <TRANSACTIONTYPE>Inter Bank Transfer</TRANSACTIONTYPE>
        <IFSCODE>${xmlEsc(p.ifscCode)}</IFSCODE>
        <BANKNAME>${xmlEsc(p.bankName)}</BANKNAME>
        <ACCOUNTNUMBER>${xmlEsc(p.accNumber)}</ACCOUNTNUMBER>
        <PAYMENTFAVOURING>${xmlEsc(p.staffLedger)}</PAYMENTFAVOURING>
        <TRANSACTIONNAME>Primary</TRANSACTIONNAME>
        <TRANSFERMODE>NEFT</TRANSFERMODE>
        <BANKID>1</BANKID>
        <UNIQUEREFERENCENUMBER>${xmlEsc(p.uniqueRefNo)}</UNIQUEREFERENCENUMBER>
        <STATUS>No</STATUS>
        <PAYMENTMODE>Transacted</PAYMENTMODE>
        <SECONDARYSTATUS>Not Approved</SECONDARYSTATUS>
        <BANKPARTYNAME>${xmlEsc(p.staffLedger)}</BANKPARTYNAME>
        <ISCONNECTEDPAYMENT>No</ISCONNECTEDPAYMENT>
        <ISSPLIT>No</ISSPLIT>
        <ISCONTRACTUSED>No</ISCONTRACTUSED>
        <ISACCEPTEDWITHWARNING>No</ISACCEPTEDWITHWARNING>
        <ISTRANSFORCED>No</ISTRANSFORCED>
        <AMOUNT>${amt}</AMOUNT>
      </BANKALLOCATIONS.LIST>
    </ALLLEDGERENTRIES.LIST>`

    return `<TALLYMESSAGE xmlns:UDF="TallyUDF">
      <VOUCHER VCHTYPE="Payment" ACTION="Create" OBJVIEW="Accounting Voucher View">
        <DATE>${opts.voucherDateYYYYMMDD}</DATE>
        <EFFECTIVEDATE>${opts.voucherDateYYYYMMDD}</EFFECTIVEDATE>
        <VOUCHERTYPENAME>Payment</VOUCHERTYPENAME>
        <ISINVOICE>No</ISINVOICE>
        <NARRATION>${xmlEsc(opts.narration + ' - ' + p.staffLedger)}</NARRATION>
        ${drLeg}
        ${crLeg}
      </VOUCHER>
    </TALLYMESSAGE>`
  }).join('')

  const envelopeXml = `<ENVELOPE>
    <HEADER>
      <VERSION>1</VERSION>
      <TALLYREQUEST>Import</TALLYREQUEST>
      <TYPE>Data</TYPE>
      <ID>Vouchers</ID>
    </HEADER>
    <BODY>
      <DESC>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${xmlEsc(cfg.tallyCompanyName)}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </DESC>
      <DATA>
        ${messagesXml}
      </DATA>
    </BODY>
  </ENVELOPE>`

  const res = await fetch(cfg.tallyTunnelUrl, { method: 'POST', headers, body: envelopeXml })
  const raw = await res.text()
  const created = parseInt((raw.match(/<CREATED[^>]*>(\d+)<\/CREATED>/) || [])[1] || '0', 10)
  const errors = parseInt((raw.match(/<ERRORS[^>]*>(\d+)<\/ERRORS>/) || [])[1] || '0', 10)
  const exceptions = parseInt((raw.match(/<EXCEPTIONS[^>]*>(\d+)<\/EXCEPTIONS>/) || [])[1] || '0', 10)
  const lastVchId = decodeTally((raw.match(/<LASTVCHID[^>]*>([^<]+)<\/LASTVCHID>/) || [])[1] || '') || null
  
  const ok = created === opts.payments.length && errors === 0 && exceptions === 0
  return { ok, lastVchId, created, errors, exceptions, raw }
}
