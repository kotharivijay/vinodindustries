import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
const r = await prisma.invPurchaseInvoice.update({
  where: { id: 1 },
  data: { tallyVoucherGuid: '140068', tallyVoucherNo: 'BLT/26-27/0084' },
  select: { id: true, status: true, tallyVoucherGuid: true, tallyVoucherNo: true, tallyPushedAt: true },
})
console.log(r)
await prisma.$disconnect()
