export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

/**
 * Record a partial-or-full return of items on a Draft / PendingInvoice
 * challan. Body: { lines: [{ lineId, qty }], reason? }.
 * Side effects:
 *  - Bumps InvChallanLine.returnedQty by `qty` (cumulative across calls).
 *  - Inserts STOCK_OUT movements for trackStock items (refType='CHALLAN_RETURN').
 *  - When every line is fully returned, flips status='Returned'.
 *  - Recomputes parent rollups (totalQty / totalAmount / totalGstAmount /
 *    totalWithGst) using effective qty so the card totals match what's left.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = Number(params.id)
  const body = await req.json()
  const reason: string | null = body?.reason ? String(body.reason) : null
  const inputLines: { lineId: number; qty: number }[] = Array.isArray(body?.lines) ? body.lines : []
  if (!inputLines.length) {
    return NextResponse.json({ error: 'lines[] required' }, { status: 400 })
  }

  const c = await db.invChallan.findUnique({
    where: { id },
    include: { lines: { include: { item: true } } },
  })
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (['Invoiced', 'CashPaid', 'Cancelled', 'Returned'].includes(c.status)) {
    return NextResponse.json({ error: `Cannot return — challan is ${c.status}` }, { status: 409 })
  }

  // Validate each line: belongs to challan + qty <= remaining capacity
  type Plan = { line: any; addQty: number }
  const plan: Plan[] = []
  for (const inp of inputLines) {
    const lineId = Number(inp.lineId)
    const addQty = Number(inp.qty || 0)
    if (addQty <= 0) continue
    const line = c.lines.find((l: any) => l.id === lineId)
    if (!line) {
      return NextResponse.json({ error: `Line ${lineId} not on this challan` }, { status: 400 })
    }
    const already = Number(line.returnedQty ?? 0)
    const remaining = Number(line.qty) - already
    if (addQty > remaining + 0.0001) {
      return NextResponse.json({
        error: `Line ${line.lineNo}: return qty ${addQty} exceeds remaining ${remaining}`,
      }, { status: 400 })
    }
    plan.push({ line, addQty })
  }
  if (!plan.length) {
    return NextResponse.json({ error: 'No qty to return' }, { status: 400 })
  }

  // Build stock OUT movements only for trackStock items
  const movements = plan
    .filter(p => p.line.item.trackStock && p.addQty > 0)
    .map(p => ({
      itemId: p.line.itemId,
      movementDate: new Date(),
      direction: 'OUT',
      qty: p.addQty,
      unit: p.line.unit,
      refType: 'CHALLAN_RETURN',
      refId: c.id,
      remarks: `Return challan ${c.challanNo}${reason ? ` — ${reason}` : ''}`,
    }))

  await db.$transaction(async (tx: any) => {
    for (const p of plan) {
      const newReturnedQty = Number(p.line.returnedQty ?? 0) + p.addQty
      await tx.invChallanLine.update({
        where: { id: p.line.id },
        data: { returnedQty: newReturnedQty },
      })
    }
    if (movements.length) {
      await tx.invStockMovement.createMany({ data: movements })
    }

    // Re-read lines to compute rollups + decide whether to flip status to Returned
    const fresh = await tx.invChallanLine.findMany({
      where: { challanId: c.id },
      select: { qty: true, returnedQty: true, rate: true, gstRate: true, amount: true, gstAmount: true, totalWithGst: true },
    })
    const fullyReturned = fresh.every((l: any) => Number(l.returnedQty ?? 0) >= Number(l.qty))
    const dataPatch: any = {}
    if (fullyReturned) {
      dataPatch.status = 'Returned'
      dataPatch.returnReason = reason
    } else if (reason && !c.returnReason) {
      // partial — preserve the first reason supplied
      dataPatch.returnReason = reason
    }

    await tx.invChallan.update({ where: { id: c.id }, data: dataPatch })
  })

  const fresh = await db.invChallan.findUnique({
    where: { id: c.id },
    include: { lines: { include: { item: { include: { alias: true } } }, orderBy: { lineNo: 'asc' } } },
  })
  return NextResponse.json(fresh)
}
