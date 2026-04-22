export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { neonPrisma } from '@/lib/neonBackup'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export const maxDuration = 120

// Tables to mirror, in FK-forward order. Each entry = [modelName, pascalTableName].
// createMany can't write the `tags` array on TallyLedger and some other fields
// unsupported across Prisma 5 — production-flow tables only here.
const TABLES: [string, string][] = [
  // Masters (no FKs)
  ['party', 'Party'],
  ['quality', 'Quality'],
  ['transport', 'Transport'],
  ['weaver', 'Weaver'],
  ['dyeingMachine', 'DyeingMachine'],
  ['dyeingOperator', 'DyeingOperator'],
  ['shade', 'Shade'],

  // Opening balance hierarchy
  ['lotOpeningBalance', 'LotOpeningBalance'],
  ['lotOpeningBalanceAllocation', 'LotOpeningBalanceAllocation'],
  ['lotCarryForwardDespatch', 'LotCarryForwardDespatch'],

  // Grey (refs Party/Quality/Transport/Weaver)
  ['greyEntry', 'GreyEntry'],

  // Despatch
  ['despatchEntry', 'DespatchEntry'],
  ['despatchEntryLot', 'DespatchEntryLot'],
  ['despatchChangeLog', 'DespatchChangeLog'],
  ['despatchNotification', 'DespatchNotification'],

  // Fold MUST be before Dyeing — DyeingEntry.foldBatchId → FoldBatch
  ['foldProgram', 'FoldProgram'],
  ['foldBatch', 'FoldBatch'],
  ['foldBatchLot', 'FoldBatchLot'],

  // Dyeing (refs FoldBatch + DyeingMachine + DyeingOperator)
  ['dyeingEntry', 'DyeingEntry'],
  ['dyeingEntryLot', 'DyeingEntryLot'],

  // Finish + folding receipts
  ['finishEntry', 'FinishEntry'],
  ['finishEntryLot', 'FinishEntryLot'],
  ['foldingReceipt', 'FoldingReceipt'],

  // Packing
  ['packingEntry', 'PackingEntry'],
  ['packingLot', 'PackingLot'],

  // Audit
  ['deleteLog', 'DeleteLog'],
]

async function runBackup() {
  const src = prisma as any
  const dst = neonPrisma as any
  const started = Date.now()
  const tableStats: Record<string, { rows: number; ms: number }> = {}

  // Wipe all target tables in one go (CASCADE handles FKs).
  const truncate = TABLES.map(([, t]) => `"${t}"`).join(', ')
  await neonPrisma.$executeRawUnsafe(`TRUNCATE TABLE ${truncate} RESTART IDENTITY CASCADE`)

  // Copy each table.
  for (const [model, pascal] of TABLES) {
    const t0 = Date.now()
    const rows = await src[model].findMany()
    if (rows.length > 0) {
      // Batch to avoid Prisma/pgbouncer payload limits
      const BATCH = 500
      for (let i = 0; i < rows.length; i += BATCH) {
        await dst[model].createMany({
          data: rows.slice(i, i + BATCH),
          skipDuplicates: true,
        })
      }
    }
    // Fix the SERIAL sequence to max(id)+1 so future inserts on Neon
    // (if ever promoted) don't collide.
    await neonPrisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('"${pascal}"', 'id'), COALESCE((SELECT MAX(id) FROM "${pascal}"), 0) + 1, false)`,
    ).catch(() => {}) // tables without `id` (none here) are safe to skip
    tableStats[pascal] = { rows: rows.length, ms: Date.now() - t0 }
  }

  return {
    ok: true,
    durationMs: Date.now() - started,
    totalRows: Object.values(tableStats).reduce((s, x) => s + x.rows, 0),
    tables: tableStats,
  }
}

// Cron trigger (Bearer CRON_SECRET) or manual trigger (session).
export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  const isCron = cronSecret && auth === `Bearer ${cronSecret}`

  if (!isCron) {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: 'NEON_DATABASE_URL not configured' }, { status: 500 })
  }

  try {
    const result = await runBackup()
    return NextResponse.json(result)
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Backup failed', stack: e?.stack?.slice(0, 500) }, { status: 500 })
  }
}

// Same endpoint as GET for Vercel cron convenience.
export async function GET(req: NextRequest) {
  return POST(req)
}
