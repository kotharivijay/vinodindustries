// Find the invoice containing challan KSI/IN/2026-27/0005 and push it via the API.
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const SERIES_FY = '2026-27'
  const SERIES_NO = 5

  const challan = await prisma.invChallan.findUnique({
    where: { seriesFy_internalSeriesNo: { seriesFy: SERIES_FY, internalSeriesNo: SERIES_NO } },
    include: {
      party: { select: { id: true, displayName: true, tallyLedger: true, gstRegistrationType: true, state: true, gstin: true } },
      invoiceLink: { include: { invoice: { select: { id: true, supplierInvoiceNo: true, supplierInvoiceDate: true, status: true, totalAmount: true, taxableAmount: true } } } },
    },
  })
  if (!challan) {
    console.log('Challan KSI/IN/2026-27/0005 not found')
    return
  }
  console.log('-- Challan --')
  console.log(`id=${challan.id} series=KSI/IN/${challan.seriesFy}/${String(challan.internalSeriesNo).padStart(4, '0')}  challanNo=${challan.challanNo}  date=${challan.challanDate.toISOString().slice(0,10)}  status=${challan.status}`)
  console.log(`party=${challan.party.displayName} (${challan.party.tallyLedger}, ${challan.party.gstRegistrationType}, state=${challan.party.state})`)

  if (!challan.invoiceLink) {
    console.log('\nNo invoice linked to this challan yet.')
    return
  }
  const inv = challan.invoiceLink.invoice
  console.log('\n-- Linked Invoice --')
  console.log(`id=${inv.id}  supplierInvoiceNo=${inv.supplierInvoiceNo}  date=${inv.supplierInvoiceDate.toISOString().slice(0,10)}  status=${inv.status}  taxable=${inv.taxableAmount}  total=${inv.totalAmount}`)

  // Hit the push-to-tally endpoint via fetch (assumes dev server at localhost:3000)
  // We don't have a session token from this script context — better to read the
  // invoice + build payload + call postPurchaseVoucher directly. Let's import
  // the helpers from the app's lib path.
  console.log('\nInvoice id:', inv.id)
  console.log('Run the push from the app UI or: POST /api/inv/invoices/' + inv.id + '/push-to-tally')
}
main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
