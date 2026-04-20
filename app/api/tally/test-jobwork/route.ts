export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { queryTally, getFirm } from '@/lib/tally'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const firm = req.nextUrl.searchParams.get('firm') || 'KSI'
  const fromDate = req.nextUrl.searchParams.get('from') || '01/04/2025'
  const toDate = req.nextUrl.searchParams.get('to') || '21/04/2026'
  const vchType = req.nextUrl.searchParams.get('type') || 'Sales'

  const firmInfo = getFirm(firm)
  if (!firmInfo) return NextResponse.json({ error: `Unknown firm: ${firm}` }, { status: 400 })

  // Fetch vouchers with inventory + batch details using TDL Collection
  const xml = `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>VoucherExport</ID></HEADER>
<BODY>
<DESC>
<STATICVARIABLES>
<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
<SVCURRENTCOMPANY>${firmInfo.tallyName}</SVCURRENTCOMPANY>
<SVFROMDATE>${fromDate}</SVFROMDATE>
<SVTODATE>${toDate}</SVTODATE>
</STATICVARIABLES>
<TDL><TDLMESSAGE>
<COLLECTION NAME="VoucherExport" ISMODIFY="No">
<TYPE>Voucher</TYPE>
<CHILDOF>${vchType}</CHILDOF>
<FETCH>Date,VoucherNumber,PartyLedgerName,VoucherTypeName,Narration,Reference</FETCH>
<FETCH>AllInventoryEntries.StockItemName,AllInventoryEntries.Rate,AllInventoryEntries.Amount,AllInventoryEntries.BilledQty,AllInventoryEntries.ActualQty</FETCH>
<FETCH>AllInventoryEntries.BatchAllocations.GodownName,AllInventoryEntries.BatchAllocations.BatchName,AllInventoryEntries.BatchAllocations.Amount,AllInventoryEntries.BatchAllocations.BilledQty,AllInventoryEntries.BatchAllocations.ActualQty</FETCH>
</COLLECTION>
</TDLMESSAGE></TDL>
</DESC>
</BODY>
</ENVELOPE>`

  try {
    const response = await queryTally(xml)

    // Return first 5000 chars of raw XML for inspection + parsed summary
    const vouchers: any[] = []
    const voucherBlocks = response.match(/<VOUCHER[^>]*>[\s\S]*?<\/VOUCHER>/g) || []

    for (const block of voucherBlocks.slice(0, 10)) {
      const date = block.match(/<DATE[^>]*>([^<]*)<\/DATE>/)?.[1] || ''
      const vchNo = block.match(/<VOUCHERNUMBER[^>]*>([^<]*)<\/VOUCHERNUMBER>/)?.[1] || ''
      const party = block.match(/<PARTYLEDGERNAME[^>]*>([^<]*)<\/PARTYLEDGERNAME>/)?.[1] || ''
      const vchTypeName = block.match(/<VOUCHERTYPENAME[^>]*>([^<]*)<\/VOUCHERTYPENAME>/)?.[1] || ''
      const narration = block.match(/<NARRATION[^>]*>([^<]*)<\/NARRATION>/)?.[1] || ''

      // Parse inventory entries
      const items: any[] = []
      const invBlocks = block.match(/<ALLINVENTORYENTRIES\.LIST>[\s\S]*?<\/ALLINVENTORYENTRIES\.LIST>/g) || []
      for (const inv of invBlocks) {
        const itemName = inv.match(/<STOCKITEMNAME[^>]*>([^<]*)<\/STOCKITEMNAME>/)?.[1] || ''
        const rate = inv.match(/<RATE[^>]*>([^<]*)<\/RATE>/)?.[1] || ''
        const amount = inv.match(/<AMOUNT[^>]*>([^<]*)<\/AMOUNT>/)?.[1] || ''
        const billedQty = inv.match(/<BILLEDQTY[^>]*>([^<]*)<\/BILLEDQTY>/)?.[1] || ''
        const actualQty = inv.match(/<ACTUALQTY[^>]*>([^<]*)<\/ACTUALQTY>/)?.[1] || ''

        // Parse batch allocations
        const batches: any[] = []
        const batchBlocks = inv.match(/<BATCHALLOCATIONS\.LIST>[\s\S]*?<\/BATCHALLOCATIONS\.LIST>/g) || []
        for (const bat of batchBlocks) {
          const godown = bat.match(/<GODOWNNAME[^>]*>([^<]*)<\/GODOWNNAME>/)?.[1] || ''
          const batchName = bat.match(/<BATCHNAME[^>]*>([^<]*)<\/BATCHNAME>/)?.[1] || ''
          const bAmt = bat.match(/<AMOUNT[^>]*>([^<]*)<\/AMOUNT>/)?.[1] || ''
          const bQty = bat.match(/<BILLEDQTY[^>]*>([^<]*)<\/BILLEDQTY>/)?.[1] || ''
          batches.push({ godown, batchName, amount: bAmt, qty: bQty })
        }

        items.push({ itemName, rate, amount, billedQty, actualQty, batches })
      }

      vouchers.push({ date, vchNo, party, vchType: vchTypeName, narration, items })
    }

    return NextResponse.json({
      firm,
      vchType,
      fromDate,
      toDate,
      totalVouchersFound: voucherBlocks.length,
      showing: Math.min(10, voucherBlocks.length),
      vouchers,
      rawXmlPreview: response.substring(0, 3000),
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
