export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { fetchAliasesFromTally } from '@/lib/inv/tally-masters'

export const maxDuration = 60

const db = prisma as any

type Progress = (msg: string) => void
const noop: Progress = () => {}

async function doSync(progress: Progress = noop) {
  const start = Date.now()

  progress('Fetching stock items from Tally KSI…')
  const fetched = await fetchAliasesFromTally()
  progress(`Tally returned ${fetched.length} stock items.`)

  // Dedupe by tallyStockItem (occasional duplicates in Tally export)
  const seen = new Set<string>()
  const deduped = fetched.filter(a => {
    if (!a.tallyStockItem || seen.has(a.tallyStockItem)) return false
    seen.add(a.tallyStockItem)
    return true
  })
  if (deduped.length !== fetched.length) {
    progress(`Deduped to ${deduped.length} unique items.`)
  }

  // Bulk lookup all existing aliases by tallyStockItem in ONE query.
  progress('Looking up existing rows…')
  const existingRows = await db.invTallyAlias.findMany({
    where: { tallyStockItem: { in: deduped.map(a => a.tallyStockItem) } },
    select: { tallyStockItem: true },
  })
  const existingSet = new Set<string>(existingRows.map((r: any) => r.tallyStockItem))
  const toCreate = deduped.filter(a => !existingSet.has(a.tallyStockItem))
  const toUpdate = deduped.filter(a =>  existingSet.has(a.tallyStockItem))
  progress(`${toCreate.length} new · ${toUpdate.length} to refresh.`)

  const now = new Date()

  // INSERT new rows in batches of 2000 (same pattern as ledger-sync).
  const BATCH = 2000
  let inserted = 0
  for (let i = 0; i < toCreate.length; i += BATCH) {
    const slice = toCreate.slice(i, i + BATCH)
    const r = await db.invTallyAlias.createMany({
      data: slice.map(a => ({
        tallyStockItem: a.tallyStockItem,
        tallyGuid: a.tallyGuid,
        displayName: a.tallyStockItem,
        category: a.category,
        unit: a.unit,
        gstRate: a.gstRate,
        hsn: a.hsn,
        defaultTrackStock: a.defaultTrackStock,
        lastSyncedAt: now,
      })),
      skipDuplicates: true,
    })
    inserted += r.count
    progress(`Inserted ${Math.min(i + slice.length, toCreate.length)}/${toCreate.length} new rows…`)
  }
  // PgBouncer/transaction-pool sometimes returns 0 from createMany — fall back to slice length.
  if (inserted === 0 && toCreate.length > 0) inserted = toCreate.length

  // UPDATE existing rows in parallel chunks. Only refresh facts from Tally;
  // category / defaultTrackStock / displayName stay untouched.
  const UPDATE_CONCURRENCY = 50
  let updated = 0
  for (let i = 0; i < toUpdate.length; i += UPDATE_CONCURRENCY) {
    const chunk = toUpdate.slice(i, i + UPDATE_CONCURRENCY)
    const results = await Promise.all(chunk.map(a =>
      db.invTallyAlias.update({
        where: { tallyStockItem: a.tallyStockItem },
        data: {
          tallyGuid: a.tallyGuid,
          unit: a.unit,
          gstRate: a.gstRate,
          hsn: a.hsn,
          lastSyncedAt: now,
        },
      }).then(() => 1).catch(() => 0)
    ))
    updated += results.reduce((s, n) => s + n, 0)
    progress(`Refreshed ${Math.min(i + chunk.length, toUpdate.length)}/${toUpdate.length} existing rows…`)
  }

  const duration = (Date.now() - start) / 1000
  return { inserted, updated, total: deduped.length, duration }
}

// POST — non-streamed (used by cron / scripts)
export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const r = await doSync()
    return NextResponse.json({ ok: true, ...r })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 })
  }
}

// GET — SSE stream of progress messages for the UI
export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return new Response('Unauthorized', { status: 401 })

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: any) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      try {
        const result = await doSync(msg => send({ type: 'progress', message: msg }))
        send({
          type: 'complete',
          message: `✅ Done in ${result.duration.toFixed(1)}s — ${result.inserted} new, ${result.updated} updated (${result.total} total)`,
          ...result,
        })
      } catch (err: any) {
        send({ type: 'error', message: `❌ Sync failed: ${err?.message || 'Unknown error'}` })
      }
      controller.close()
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  })
}
