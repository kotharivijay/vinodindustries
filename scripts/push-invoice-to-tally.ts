// Push InvPurchaseInvoice id=N to Tally and dump the response.
// Same code path as POST /api/inv/invoices/[id]/push-to-tally but no auth.
import { PrismaClient } from '@prisma/client'
import { prePushValidate } from '../lib/inv/pre-push-validate'
import { buildPurchaseVoucherJSON, postPurchaseVoucher } from '../lib/inv/tally-push'

const prisma = new PrismaClient()
const db = prisma as any

async function main() {
  const id = Number(process.argv[2])
  if (!id) { console.error('usage: tsx scripts/push-invoice-to-tally.ts <invoiceId>'); process.exit(1) }

  console.log(`-- Pre-push validation for invoice ${id} --`)
  const failures = await prePushValidate(id)
  if (failures.length > 0) {
    console.log('FAILURES:')
    for (const f of failures) console.log(`  [${f.code}] ${f.message}`)
    return
  }
  console.log('  ok')

  const inv = await db.invPurchaseInvoice.findUnique({
    where: { id },
    include: {
      party: true,
      lines: { include: { item: { include: { alias: true } } }, orderBy: { lineNo: 'asc' } },
      challans: { include: { challan: { select: { internalSeriesNo: true, seriesFy: true } } } },
    },
  })
  if (!inv) { console.log('Invoice not found'); return }
  const cfg = await db.invTallyConfig.findUnique({ where: { id: 1 } })

  console.log(`\n-- Invoice --`)
  console.log(`  party=${inv.party.displayName}  ledger="${inv.party.tallyLedger}"  state=${inv.party.state}  gstReg=${inv.party.gstRegistrationType}`)
  console.log(`  supplierInvoice=${inv.supplierInvoiceNo}  date=${inv.supplierInvoiceDate.toISOString().slice(0,10)}`)
  console.log(`  taxable=${inv.taxableAmount}  igst=${inv.igstAmount}  cgst=${inv.cgstAmount}  sgst=${inv.sgstAmount}  freight=${inv.freightAmount}  discount=${inv.totalDiscountAmount}  roundOff=${inv.roundOff}  total=${inv.totalAmount}`)
  console.log(`  treatment=${inv.gstTreatment}  status=${inv.status}`)

  const linkedChallanSeries = inv.challans.map((cl: any) =>
    `KSI/IN/${cl.challan.seriesFy}/${String(cl.challan.internalSeriesNo).padStart(4, '0')}`,
  )
  console.log(`  challans=${linkedChallanSeries.join(', ')}`)

  console.log('\n-- Building payload --')
  let payload: any
  try {
    payload = buildPurchaseVoucherJSON(
      {
        id: inv.id,
        supplierInvoiceNo: inv.supplierInvoiceNo,
        supplierInvoiceDate: inv.supplierInvoiceDate,
        freightAmount: Number(inv.freightAmount),
        totalDiscountAmount: Number(inv.totalDiscountAmount),
        linkedChallanSeries,
      },
      {
        tallyLedger: inv.party.tallyLedger,
        state: inv.party.state,
        gstin: inv.party.gstin,
        gstRegistrationType: inv.party.gstRegistrationType,
      },
      cfg as any,
      inv.lines.filter((l: any) => l.item).map((l: any) => ({
        lineNo: l.lineNo, qty: Number(l.qty || 0), unit: l.unit || 'kg',
        rate: Number(l.rate || 0), amount: Number(l.amount),
        description: l.description || l.item.displayName,
        gstRate: Number(l.gstRate || 0),
        item: { displayName: l.item.displayName },
        alias: {
          tallyStockItem: l.item.alias.tallyStockItem,
          gstRate: Number(l.item.alias.gstRate),
          category: l.item.alias.category,
          godownOverride: l.item.alias.godownOverride,
        },
      })),
    )
  } catch (e: any) {
    console.log('  BUILD_ERROR:', e.message)
    return
  }
  console.log('  payload built (size:', JSON.stringify(payload).length, 'bytes)')
  // Print the voucher header for sanity
  const v = payload?.tallyMessage?.voucher || payload?.VOUCHER || payload
  console.log('  payload preview (top-level keys):', Object.keys(payload).slice(0, 20).join(', '))

  console.log('\n-- Posting to Tally tunnel --')
  console.log('  TALLY_TUNNEL_URL=' + (process.env.TALLY_TUNNEL_URL || '(unset)'))
  await db.invPurchaseInvoice.update({
    where: { id },
    data: { status: 'PushPending', pushAttempts: { increment: 1 }, tallyPayload: payload },
  })

  let result
  try {
    result = await postPurchaseVoucher(payload)
  } catch (e: any) {
    console.log('  POST FAILED:', e.message)
    await db.invPurchaseInvoice.update({
      where: { id },
      data: { lastPushError: e.message, status: 'PushPending' },
    })
    return
  }

  console.log(`  HTTP ${result.http}`)
  console.log('  raw response (first 2000 chars):')
  console.log('  ' + (typeof result.body === 'string' ? result.body.slice(0, 2000) : JSON.stringify(result.body).slice(0, 2000)))
  console.log('\n  parsed:')
  console.log('  ' + JSON.stringify(result.parsed, null, 2).split('\n').join('\n  '))

  const created = Number(result.parsed?.created ?? result.parsed?.RESPONSE?.CREATED ?? 0)
  const vchkey = result.parsed?.vchkey || result.parsed?.lastvchid || null

  if (created > 0) {
    await db.invPurchaseInvoice.update({
      where: { id },
      data: { status: 'PushedToTally', tallyPushedAt: new Date(), tallyVoucherGuid: vchkey, tallyResponse: result.parsed, lastPushError: null },
    })
    console.log(`\n✅ Pushed. created=${created}  vchkey=${vchkey}`)
  } else {
    const errMsg = typeof result.body === 'string' ? result.body.slice(0, 500) : 'Push failed'
    await db.invPurchaseInvoice.update({
      where: { id },
      data: { status: 'PushPending', lastPushError: errMsg, tallyResponse: result.parsed },
    })
    console.log(`\n❌ Not created. Error: ${errMsg}`)
  }
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
