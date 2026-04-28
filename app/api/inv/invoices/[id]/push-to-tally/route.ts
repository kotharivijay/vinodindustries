export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prePushValidate } from '@/lib/inv/pre-push-validate'
import { buildPurchaseVoucherJSON, postPurchaseVoucher } from '@/lib/inv/tally-push'

export const maxDuration = 60

const db = prisma as any

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = Number(params.id)
  const failures = await prePushValidate(id)
  if (failures.length > 0) {
    return NextResponse.json({ ok: false, failures }, { status: 409 })
  }

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
  if (!cfg) return NextResponse.json({ error: 'Tally config missing' }, { status: 500 })

  const linkedChallanSeries = inv.challans.map((cl: any) =>
    `KSI/IN/${cl.challan.seriesFy}/${String(cl.challan.internalSeriesNo).padStart(4, '0')}`,
  )

  const lines = inv.lines
    .filter((l: any) => l.item) // skip non-item (freight) lines for inventory entries
    .map((l: any) => ({
      lineNo: l.lineNo,
      qty: Number(l.qty || 0),
      unit: l.unit || 'kg',
      rate: Number(l.rate || 0),
      amount: Number(l.amount),
      description: l.description || l.item.displayName,
      gstRate: Number(l.gstRate || 0),
      item: { displayName: l.item.displayName },
      alias: {
        tallyStockItem: l.item.alias.tallyStockItem,
        gstRate: Number(l.item.alias.gstRate),
        category: l.item.alias.category,
        godownOverride: l.item.alias.godownOverride,
      },
    }))

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
      lines,
    )
  } catch (e: any) {
    return NextResponse.json({ ok: false, failures: [{ code: 'BUILD_ERROR', message: e.message }] }, { status: 409 })
  }

  await db.invPurchaseInvoice.update({
    where: { id },
    data: { status: 'PushPending', pushAttempts: { increment: 1 }, tallyPayload: payload },
  })

  let result
  try { result = await postPurchaseVoucher(payload) }
  catch (e: any) {
    await db.invPurchaseInvoice.update({
      where: { id },
      data: { lastPushError: e.message, status: 'PushPending' },
    })
    return NextResponse.json({ ok: false, error: e.message }, { status: 502 })
  }

  const created = Number(result.parsed?.created ?? result.parsed?.RESPONSE?.CREATED ?? 0)
  const vchkey = result.parsed?.vchkey || result.parsed?.lastvchid || null

  if (created > 0) {
    await db.invPurchaseInvoice.update({
      where: { id },
      data: {
        status: 'PushedToTally',
        tallyPushedAt: new Date(),
        tallyVoucherGuid: vchkey,
        tallyResponse: result.parsed,
        lastPushError: null,
      },
    })
    return NextResponse.json({ ok: true, vchkey, created })
  }

  await db.invPurchaseInvoice.update({
    where: { id },
    data: {
      status: 'PushPending',
      lastPushError: typeof result.body === 'string' ? result.body.slice(0, 500) : 'Push failed',
      tallyResponse: result.parsed,
    },
  })
  return NextResponse.json({ ok: false, parsed: result.parsed, body: result.body }, { status: 502 })
}
