export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prePushValidate } from '@/lib/inv/pre-push-validate'
import { buildPurchaseVoucherJSON } from '@/lib/inv/tally-push'

const db = prisma as any

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = Number(params.id)
  const failures = await prePushValidate(id)

  const inv = await db.invPurchaseInvoice.findUnique({
    where: { id },
    include: {
      party: true,
      lines: { include: { item: { include: { alias: true } } }, orderBy: { lineNo: 'asc' } },
      challans: { include: { challan: { select: { internalSeriesNo: true, seriesFy: true } } } },
    },
  })
  if (!inv) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const cfg = await db.invTallyConfig.findUnique({ where: { id: 1 } })
  if (!cfg || failures.some(f => f.code === 'NO_CONFIG' || f.code === 'NO_PARTY_LEDGER')) {
    return NextResponse.json({ failures, payload: null })
  }

  const linkedChallanSeries = inv.challans.map((cl: any) =>
    `KSI/IN/${cl.challan.seriesFy}/${String(cl.challan.internalSeriesNo).padStart(4, '0')}`,
  )

  let payload = null
  try {
    payload = buildPurchaseVoucherJSON(
      { id: inv.id, supplierInvoiceNo: inv.supplierInvoiceNo, supplierInvoiceDate: inv.supplierInvoiceDate,
        freightAmount: Number(inv.freightAmount), totalDiscountAmount: Number(inv.totalDiscountAmount),
        linkedChallanSeries },
      { tallyLedger: inv.party.tallyLedger, state: inv.party.state, gstin: inv.party.gstin,
        gstRegistrationType: inv.party.gstRegistrationType },
      cfg as any,
      inv.lines.filter((l: any) => l.item).map((l: any) => ({
        lineNo: l.lineNo, qty: Number(l.qty || 0), unit: l.unit || 'kg',
        rate: Number(l.rate || 0), amount: Number(l.amount),
        description: l.description || l.item.displayName,
        gstRate: Number(l.gstRate || 0),
        item: { displayName: l.item.displayName },
        alias: { tallyStockItem: l.item.alias.tallyStockItem, gstRate: Number(l.item.alias.gstRate),
          category: l.item.alias.category, godownOverride: l.item.alias.godownOverride },
      })),
    )
  } catch (e: any) {
    failures.push({ code: 'BUILD_ERROR', message: e.message })
  }

  return NextResponse.json({ failures, payload })
}
