import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
const db = prisma

async function main() {
  const inv = await db.invPurchaseInvoice.findUnique({
    where: { id: 1 },
    include: {
      party: true,
      lines: { include: { item: { include: { alias: true } } }, orderBy: { lineNo: 'asc' } },
      challans: { include: { challan: { select: { internalSeriesNo: true, seriesFy: true } } } },
    },
  })
  console.log('status:', inv.status)
  console.log('hasTallyPayload:', !!inv.tallyPayload)
  console.log('pushAttempts:', inv.pushAttempts)
  console.log('lastPushError:', inv.lastPushError)
  console.log('tallyVoucherGuid:', inv.tallyVoucherGuid)
  console.log('verifiedById:', inv.verifiedById)
  console.log('lines count:', inv.lines.length)
  for (const l of inv.lines) {
    console.log(`  line ${l.lineNo}: item=${l.item?.displayName} alias=${l.item?.alias?.tallyStockItem} qty=${l.qty} ${l.unit} rate=${l.rate} gst=${l.gstRate}% amount=${l.amount}`)
  }
  console.log('linkedChallans:', inv.challans.map(c => `KSI/IN/${c.challan.seriesFy}/${String(c.challan.internalSeriesNo).padStart(4,'0')}`).join(', '))

  const cfg = await db.invTallyConfig.findUnique({ where: { id: 1 } })
  console.log('\ncfg present:', !!cfg)
  if (cfg) {
    console.log('  purchaseLedgerMap:', JSON.stringify(cfg.purchaseLedgerMap))
    console.log('  godownMap:', JSON.stringify(cfg.godownMap))
    console.log('  gstLedgers:', JSON.stringify(cfg.gstLedgers))
    console.log('  roundOffLedger:', cfg.roundOffLedger)
    console.log('  freightLedger:', cfg.freightLedger)
    console.log('  discountLedger:', cfg.discountLedger)
  }
  console.log('\nenv:')
  console.log('  TALLY_TUNNEL_URL:', process.env.TALLY_TUNNEL_URL || '(unset)')
  console.log('  KSI_TALLY_COMPANY:', process.env.KSI_TALLY_COMPANY || '(unset)')
  console.log('  KSI_STATE:', process.env.KSI_STATE || '(unset)')
}
main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
