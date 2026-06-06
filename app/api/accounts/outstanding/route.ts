export const dynamic = 'force-dynamic'
export const maxDuration = 60
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// Classify a TallyLedger.parent group into a coarse filter bucket the UI
// uses (All / Debtors / Creditors / Other). Permissive matchers — any
// parent containing "debtor" anywhere is treated as a debtor sub-group;
// same for "creditor". This catches both Tally typos in your data
// ("Sundery Debtors", "Sundury Debtors", "Sundary Creditore") and
// custom sub-groups ("Sundry Debtors - Pali", "Sundry Debtors (Direct)").
// Employee / agent / loan groups stay in 'other' on purpose since they
// don't fit either bucket cleanly.
function classifyParty(parent: string | null | undefined): 'debtor' | 'creditor' | 'other' {
  if (!parent) return 'other'
  const p = parent.toLowerCase()
  // "creditor" must be checked first — substring "debtor" doesn't appear
  // in "creditor", but checking creditor first avoids any future
  // sub-group naming surprise. Both match prefixes ("creditore" still
  // contains "creditor").
  if (p.includes('creditor')) return 'creditor'
  if (p.includes('debtor')) return 'debtor'
  // Plain "debtors"/"creditors" group names that Tally sometimes uses
  // as a top-level synonym.
  if (p === 'debtors') return 'debtor'
  if (p === 'creditors') return 'creditor'
  return 'other'
}

// Live-Tally fallback for party classification. Reused pattern from
// /api/accounts/outstanding/tally-match — pull every ledger under
// "Sundry Debtors" + "Sundry Creditors" via Group Summary and build a
// name→type map. Used only when the cached TallyLedger table can't
// resolve a party (which is currently always — the table is empty).
const KSI_COMPANY = 'Kothari Synthetic Industries -( from 2023)'
const escapeXml = (s: string) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
function ymdToday(): string {
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}
function buildGroupSummaryXML(groupName: string, toDate: string): string {
  return `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>Group Summary</ID></HEADER>
<BODY><DESC><STATICVARIABLES>
<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
<SVCURRENTCOMPANY>${escapeXml(KSI_COMPANY)}</SVCURRENTCOMPANY>
<SVFROMDATE>20250401</SVFROMDATE>
<SVTODATE>${toDate}</SVTODATE>
<GROUPNAME>${escapeXml(groupName)}</GROUPNAME>
<EXPLODEFLAG>Yes</EXPLODEFLAG>
</STATICVARIABLES></DESC></BODY></ENVELOPE>`
}
function parseLedgerNames(xml: string): string[] {
  const names: string[] = []
  const blocks = xml.split(/<DSPACCNAME>/).slice(1)
  for (const blk of blocks) {
    const m = blk.match(/<DSPDISPNAME>([^<]+)<\/DSPDISPNAME>/)
    if (m) names.push(m[1].trim())
  }
  return names
}
async function classifyFromTallyLive(): Promise<Map<string, 'debtor' | 'creditor'>> {
  const tunnelUrl = process.env.TALLY_TUNNEL_URL
  if (!tunnelUrl) return new Map()
  const headers: Record<string, string> = { 'Content-Type': 'text/xml' }
  if (process.env.CF_ACCESS_CLIENT_ID) headers['CF-Access-Client-Id'] = process.env.CF_ACCESS_CLIENT_ID
  if (process.env.CF_ACCESS_CLIENT_SECRET) headers['CF-Access-Client-Secret'] = process.env.CF_ACCESS_CLIENT_SECRET
  const toDate = ymdToday()
  const out = new Map<string, 'debtor' | 'creditor'>()
  // Hit each group in parallel — independent queries.
  await Promise.all([
    (async () => {
      try {
        const res = await fetch(tunnelUrl, { method: 'POST', headers, body: buildGroupSummaryXML('Sundry Debtors', toDate) })
        if (!res.ok) return
        for (const n of parseLedgerNames(await res.text())) out.set(n.toLowerCase(), 'debtor')
      } catch {}
    })(),
    (async () => {
      try {
        const res = await fetch(tunnelUrl, { method: 'POST', headers, body: buildGroupSummaryXML('Sundry Creditors', toDate) })
        if (!res.ok) return
        for (const n of parseLedgerNames(await res.text())) {
          // If the same name appeared in both groups (rare misconfig),
          // Debtors wins — that's the receivable side our UI cares about.
          if (!out.has(n.toLowerCase())) out.set(n.toLowerCase(), 'creditor')
        }
      } catch {}
    })(),
  ])
  return out
}

// GET /api/accounts/outstanding
//
// One DB roundtrip view for the new Outstanding page. Computes
// per-invoice pending and per-receipt unallocated cash from our own
// tables (no Tally roundtrip). Three tabs feed off the same response:
//   • Party-wise   → use `parties[]`
//   • Invoice-wise → flatten parties[].invoices
//   • On-account   → use `receipts[]`
export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = prisma as any
  const todayMs = Date.now()
  const round2 = (n: number) => Math.round(n * 100) / 100
  const dueDays = (d: Date | string) => {
    const t = typeof d === 'string' ? new Date(d).getTime() : d.getTime()
    return Math.max(0, Math.floor((todayMs - t) / 86400_000))
  }

  // ── Invoices: pending = totalAmount − Σ(cash + tds + disc)
  //
  // Bill-style vouchers only. Dr-side (party owes us): Sales,
  // Process Job, Debit Note. Cr-side (party credit, offsets):
  // Credit Note and Purchase. The Purchase branch is for the rare
  // case where a customer sent an invoice that was booked as a
  // Purchase voucher in Tally — operator adds it manually via the
  // Opening Balance modal and we treat it identically to a CN here.
  // Journal stays excluded — TDS / discount adjustments live in the
  // ledger view but aren't pending bills.
  const invoiceRows = await db.ksiSalesInvoice.findMany({
    where: { vchType: { in: ['Process Job', 'Sales', 'Credit Note', 'Debit Note', 'Purchase'] } },
    select: {
      id: true, vchNumber: true, vchType: true, date: true,
      partyName: true, totalAmount: true,
      skipAutoLink: true, skipAutoLinkReason: true,
      allocations: { select: { allocatedAmount: true, tdsAmount: true, discountAmount: true } },
    },
  })
  // Credit Notes are opposite-nature: pending CN balance is a party CREDIT
  // (we owe them), not a debit. We compute per-row pending normally so the
  // row still shows up in the invoice list, then subtract CN pending at
  // party-totals time below.
  const pendingInvoices = invoiceRows
    .map((inv: any) => {
      const isCN = inv.vchType === 'Credit Note' || inv.vchType === 'Purchase'
      const consumed = (inv.allocations || []).reduce(
        (s: number, a: any) => s + (a.allocatedAmount || 0) + (a.tdsAmount || 0) + (a.discountAmount || 0),
        0,
      )
      const pending = round2(Math.max(0, inv.totalAmount - consumed))
      return { ...inv, isCN, pending }
    })
    .filter((inv: any) => inv.pending > 0.5)

  // ── Receipts: unallocated = amount − Σ(signed linkedCash) − carryOverPriorFy − refunded.
  // CN allocations subtract from linkedCash (they don't consume receipt cash).
  // Refunds (Payment vouchers with refundForReceiptId = this row) reduce
  // the leftover excess so a fully-refunded receipt drops out of the
  // onAccount list.
  const receiptRows = await db.ksiHdfcReceipt.findMany({
    where: { direction: 'in', hidden: false },
    select: {
      id: true, vchNumber: true, vchType: true, date: true,
      partyName: true, amount: true, carryOverPriorFy: true,
      bankRef: true, instrumentNo: true, narration: true,
      allocations: {
        select: {
          allocatedAmount: true, tdsAmount: true, discountAmount: true,
          invoice: { select: { vchNumber: true, vchType: true, date: true } },
        },
      },
      refunds: { select: { id: true, vchNumber: true, date: true, amount: true } },
    },
  })
  const onAccountReceipts = receiptRows
    .map((r: any) => {
      const linkedCash = (r.allocations || []).reduce((s: number, a: any) => {
        const isCN = a.invoice?.vchType === 'Credit Note' || a.invoice?.vchType === 'Purchase'
        return s + (isCN ? -a.allocatedAmount : a.allocatedAmount)
      }, 0)
      const linkedTds = (r.allocations || []).reduce((s: number, a: any) => s + (a.tdsAmount || 0), 0)
      const linkedDiscount = (r.allocations || []).reduce((s: number, a: any) => s + (a.discountAmount || 0), 0)
      const linkedInvoices = (r.allocations || []).map((a: any) => {
        const isCN = a.invoice?.vchType === 'Credit Note' || a.invoice?.vchType === 'Purchase'
        return {
          vchNumber: a.invoice?.vchNumber || '',
          vchType: a.invoice?.vchType || '',
          date: a.invoice?.date || null,
          allocatedAmount: round2(isCN ? -a.allocatedAmount : a.allocatedAmount),
          tdsAmount: round2(a.tdsAmount || 0),
          discountAmount: round2(a.discountAmount || 0),
          isCN,
        }
      })
      const carryOver = r.carryOverPriorFy || 0
      const refunded = (r.refunds || []).reduce((s: number, x: any) => s + (x.amount || 0), 0)
      const unallocated = round2(Math.max(0, r.amount - linkedCash - carryOver - refunded))
      return {
        ...r,
        linkedCash: round2(linkedCash),
        linkedTds: round2(linkedTds),
        linkedDiscount: round2(linkedDiscount),
        linkedInvoices,
        carryOver,
        refunded: round2(refunded),
        unallocated,
      }
    })
    .filter((r: any) => r.unallocated > 0.5)

  // ── Group invoices and on-account receipts by party
  const onAccByParty = new Map<string, number>()
  for (const r of onAccountReceipts) {
    const key = r.partyName
    onAccByParty.set(key, round2((onAccByParty.get(key) || 0) + r.unallocated))
  }

  // Party total = Σ invoice pending − Σ CN pending. CN is a credit
  // sitting on the party's ledger that offsets future invoices.
  const byParty = new Map<string, { invoices: any[]; totalPending: number }>()
  for (const inv of pendingInvoices) {
    const key = inv.partyName
    if (!byParty.has(key)) byParty.set(key, { invoices: [], totalPending: 0 })
    const e = byParty.get(key)!
    e.invoices.push(inv)
    e.totalPending = round2(e.totalPending + (inv.isCN ? -inv.pending : inv.pending))
  }

  // Parties response — sorted by totalPending desc; each party's
  // invoices sorted by due days desc (most overdue first).
  const parties = [...byParty.entries()].map(([name, data]) => {
    const invs = data.invoices
      .map((inv: any) => ({
        id: inv.id, vchNumber: inv.vchNumber, vchType: inv.vchType,
        date: inv.date, totalAmount: inv.totalAmount, pending: inv.pending,
        isCN: !!inv.isCN,
        dueDays: dueDays(inv.date),
        skipAutoLink: !!inv.skipAutoLink,
        skipAutoLinkReason: inv.skipAutoLinkReason ?? null,
      }))
      .sort((a: any, b: any) => b.dueDays - a.dueDays || b.pending - a.pending)
    return {
      name,
      totalPending: data.totalPending,
      oldestDueDays: invs[0]?.dueDays ?? 0,
      invoiceCount: invs.length,
      onAccount: onAccByParty.get(name) || 0,
      invoices: invs,
    }
  }).sort((a, b) => b.totalPending - a.totalPending)

  // Pull in parties that have only on-account (no pending invoices) so
  // the user sees the "money sitting" rows too.
  for (const [name, onAcc] of onAccByParty.entries()) {
    if (!byParty.has(name)) {
      parties.push({
        name, totalPending: 0, oldestDueDays: 0, invoiceCount: 0,
        onAccount: onAcc, invoices: [],
      })
    }
  }

  // Classify each party as debtor / creditor / other.
  //
  // Step 1 — try the cached TallyLedger snapshot (free, fast). Looks up
  // parent group; classifyParty handles sub-group variations like
  // "Sundry Debtors - Pali".
  // Step 2 — if anything is unresolved AND a tunnel is configured, ask
  // Tally LIVE via Group Summary (Sundry Debtors / Sundry Creditors with
  // EXPLODEFLAG=Yes). This is the same approach the "Match with Tally"
  // button uses and works even when TallyLedger is empty.
  const partyTypeByLower = new Map<string, 'debtor' | 'creditor' | 'other'>()
  try {
    const db2 = prisma as any
    const ledgerRows = await db2.tallyLedger.findMany({
      where: { firmCode: 'KSI', name: { in: parties.map(p => p.name) } },
      select: { name: true, parent: true },
    })
    for (const l of ledgerRows) partyTypeByLower.set(l.name.toLowerCase(), classifyParty(l.parent))
  } catch { /* fall through */ }

  const needLive = parties.some(p => !partyTypeByLower.has(p.name.toLowerCase()))
  if (needLive) {
    const liveMap = await classifyFromTallyLive()
    for (const [k, v] of liveMap) {
      // Don't downgrade a cached debtor/creditor classification.
      if (!partyTypeByLower.has(k)) partyTypeByLower.set(k, v)
    }
  }

  for (const p of parties as any[]) {
    p.partyType = partyTypeByLower.get(p.name.toLowerCase()) ?? 'other'
  }

  const receipts = onAccountReceipts.map((r: any) => ({
    id: r.id, vchNumber: r.vchNumber, vchType: r.vchType, date: r.date,
    partyName: r.partyName, amount: r.amount,
    bankRef: r.bankRef, instrumentNo: r.instrumentNo, narration: r.narration,
    linkedCash: r.linkedCash, linkedTds: r.linkedTds, linkedDiscount: r.linkedDiscount,
    linkedInvoices: r.linkedInvoices || [],
    carryOver: r.carryOver, unallocated: r.unallocated,
    daysSince: dueDays(r.date),
    // Mirror the party's classification down so the on-account tab
    // can filter independently.
    partyType: partyTypeByLower.get(r.partyName.toLowerCase()) ?? 'other',
  })).sort((a: any, b: any) => b.unallocated - a.unallocated)

  const totalOutstanding = parties.reduce((s, p) => s + p.totalPending, 0)
  const totalOnAccount = receipts.reduce((s: number, r: any) => s + r.unallocated, 0)

  return NextResponse.json({
    totals: {
      outstanding: round2(totalOutstanding),
      onAccount: round2(totalOnAccount),
      netReceivable: round2(totalOutstanding - totalOnAccount),
      parties: parties.length,
      invoices: pendingInvoices.length,
      receipts: receipts.length,
    },
    parties,
    receipts,
  })
}
