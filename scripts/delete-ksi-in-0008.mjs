// Hard-delete challan KSI/IN/2026-27/0008 + linked Draft invoice id=2,
// then rewind the series counter so 0008 is reused on the next entry.
//
// Safety:
//  - If invoice has been pushed to Tally (vchkey set), abort.
//  - If a higher series number (9+) already exists in 2026-27, abort the
//    rewind (would create a duplicate on next allocation).
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const APPLY = process.argv.includes('--apply')

async function main() {
  const FY = '2026-27'
  const NO = 8
  const c = await prisma.invChallan.findUnique({
    where: { seriesFy_internalSeriesNo: { seriesFy: FY, internalSeriesNo: NO } },
    include: {
      lines: { select: { id: true } },
      invoiceLink: { include: { invoice: { select: { id: true, supplierInvoiceNo: true, status: true, tallyVoucherGuid: true, tallyPushedAt: true } } } },
    },
  })
  if (!c) { console.log('Not found.'); return }
  console.log(`Challan id=${c.id} (KSI/IN/${FY}/${String(NO).padStart(4,'0')})  status=${c.status}`)
  console.log(`Lines: ${c.lines.length}`)

  let invId = null
  if (c.invoiceLink) {
    const inv = c.invoiceLink.invoice
    invId = inv.id
    console.log(`Linked invoice id=${inv.id} supplierInvNo=${inv.supplierInvoiceNo} status=${inv.status} vchkey=${inv.tallyVoucherGuid} pushedAt=${inv.tallyPushedAt}`)
    if (inv.tallyVoucherGuid || inv.tallyPushedAt) {
      console.log('ABORT: invoice already pushed to Tally — cannot hard-delete blindly.')
      process.exit(1)
    }
  }

  const counter = await prisma.invSeriesCounter.findUnique({
    where: { seriesType_fy: { seriesType: 'inward', fy: FY } },
  })
  console.log(`Series counter: lastNo=${counter?.lastNo ?? 0}`)
  const higherExists = await prisma.invChallan.count({
    where: { seriesFy: FY, internalSeriesNo: { gt: NO } },
  })
  console.log(`Higher series rows (>${NO}) in ${FY}: ${higherExists}`)

  // Rewind only safe if the deleted row was the very latest
  const canRewind = (counter?.lastNo ?? 0) === NO && higherExists === 0
  console.log(`Can rewind counter to ${NO - 1}: ${canRewind}`)

  if (!APPLY) {
    console.log('\n[dry-run — pass --apply to execute]')
    return
  }

  await prisma.$transaction(async tx => {
    // 1. Delete invoice + lines + invoice-challan link
    if (invId) {
      await tx.invInvoiceChallan.deleteMany({ where: { invoiceId: invId } })
      await tx.invPurchaseInvoiceLine.deleteMany({ where: { invoiceId: invId } })
      await tx.invPurchaseInvoice.delete({ where: { id: invId } })
    }
    // 2. Delete challan side
    await tx.invStockMovement.deleteMany({ where: { refType: 'CHALLAN', refId: c.id } })
    await tx.invChallanLine.deleteMany({ where: { challanId: c.id } })
    await tx.invChallan.delete({ where: { id: c.id } })

    // 3. Rewind counter if safe
    if (canRewind) {
      await tx.invSeriesCounter.update({
        where: { seriesType_fy: { seriesType: 'inward', fy: FY } },
        data: { lastNo: NO - 1 },
      })
    }
  })

  console.log('\nApplied.')
  if (canRewind) console.log(`Series counter rewound — next allocation will be ${NO}.`)
  else console.log('Counter NOT rewound (a higher series number exists). Number 0008 will appear as a gap.')

  // Verify
  const after = await prisma.invChallan.findUnique({
    where: { seriesFy_internalSeriesNo: { seriesFy: FY, internalSeriesNo: NO } },
  })
  const counterAfter = await prisma.invSeriesCounter.findUnique({
    where: { seriesType_fy: { seriesType: 'inward', fy: FY } },
  })
  console.log(`Verify: challan ${NO} now ${after ? 'STILL EXISTS' : 'gone'}. counter.lastNo=${counterAfter?.lastNo}`)
}
main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
