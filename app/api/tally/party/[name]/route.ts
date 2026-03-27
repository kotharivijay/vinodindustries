import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { viPrisma } from '@/lib/prisma'
import { getFirms, queryTally } from '@/lib/tally'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name } = await params
  const partyName = decodeURIComponent(name)
  const firms = Object.values(getFirms())

  // 1. Ledger info from DB
  let ledgerInfo: {
    id: number
    firmCode: string
    name: string
    parent: string | null
    address: string | null
    gstNo: string | null
    panNo: string | null
    mobileNos: string | null
    state: string | null
  }[] = []
  try {
    ledgerInfo = await (viPrisma as any).tallyLedger.findMany({
      where: { name: { equals: partyName, mode: 'insensitive' } },
      select: {
        id: true,
        firmCode: true,
        name: true,
        parent: true,
        address: true,
        gstNo: true,
        panNo: true,
        mobileNos: true,
        state: true,
      },
    })
  } catch {
    // DB may not have ledger info
  }

  // 2. Outstanding balance per firm
  const outstanding: { firmCode: string; firmName: string; balance: number }[] = []
  for (const firm of firms) {
    try {
      const xml = `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>PartyBal</ID></HEADER>
<BODY>
<DESC>
<STATICVARIABLES>
<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
<SVCURRENTCOMPANY>${firm.tallyName}</SVCURRENTCOMPANY>
</STATICVARIABLES>
<TDL><TDLMESSAGE>
<COLLECTION NAME="PartyBal" ISMODIFY="No">
<TYPE>Ledger</TYPE>
<FETCH>Name,ClosingBalance,Parent</FETCH>
<FILTER>NameFilter</FILTER>
</COLLECTION>
<SYSTEM TYPE="Formulae" NAME="NameFilter">$Name = "${partyName}"</SYSTEM>
</TDLMESSAGE></TDL>
</DESC>
</BODY>
</ENVELOPE>`
      const response = await queryTally(xml)
      const balMatch = response.match(/<CLOSINGBALANCE[^>]*>([^<]*)<\/CLOSINGBALANCE>/)
      if (balMatch) {
        const bal = parseFloat(balMatch[1].replace(/,/g, '')) || 0
        outstanding.push({ firmCode: firm.code, firmName: firm.name, balance: bal })
      }
    } catch {
      // Tally connection may be down for this firm
    }
  }

  // 3. Recent vouchers (all types) per firm
  const vouchers: {
    date: string
    voucherNo: string
    type: string
    amount: number
    narration: string
    firmCode: string
  }[] = []
  for (const firm of firms) {
    try {
      const xml = `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>PartyVouchers</ID></HEADER>
<BODY>
<DESC>
<STATICVARIABLES>
<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
<SVCURRENTCOMPANY>${firm.tallyName}</SVCURRENTCOMPANY>
</STATICVARIABLES>
<TDL><TDLMESSAGE>
<COLLECTION NAME="PartyVouchers" ISMODIFY="No">
<TYPE>Voucher</TYPE>
<FETCH>Date,VoucherNumber,VoucherTypeName,PartyLedgerName,Amount,Narration</FETCH>
<FILTER>PartyFilter</FILTER>
</COLLECTION>
<SYSTEM TYPE="Formulae" NAME="PartyFilter">$PartyLedgerName = "${partyName}"</SYSTEM>
</TDLMESSAGE></TDL>
</DESC>
</BODY>
</ENVELOPE>`
      const response = await queryTally(xml)
      const blocks = response.match(/<VOUCHER[^>]*>[\s\S]*?<\/VOUCHER>/g) || []
      for (const block of blocks) {
        const date = block.match(/<DATE[^>]*>([^<]*)<\/DATE>/)?.[1] || ''
        const voucherNo = block.match(/<VOUCHERNUMBER[^>]*>([^<]*)<\/VOUCHERNUMBER>/)?.[1] || ''
        const vType = block.match(/<VOUCHERTYPENAME[^>]*>([^<]*)<\/VOUCHERTYPENAME>/)?.[1] || ''
        const amtStr = block.match(/<AMOUNT[^>]*>([^<]*)<\/AMOUNT>/)?.[1] || '0'
        const amount = Math.abs(parseFloat(amtStr.replace(/,/g, '')) || 0)
        const narration = block.match(/<NARRATION[^>]*>([^<]*)<\/NARRATION>/)?.[1] || ''
        if (date) {
          const fmtDate = date.length === 8
            ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
            : date
          vouchers.push({ date: fmtDate, voucherNo, type: vType, amount, narration, firmCode: firm.code })
        }
      }
    } catch {
      // Tally connection may be down for this firm
    }
  }

  vouchers.sort((a, b) => b.date.localeCompare(a.date))

  return NextResponse.json({
    partyName,
    ledgerInfo,
    outstanding,
    vouchers: vouchers.slice(0, 100),
  })
}
