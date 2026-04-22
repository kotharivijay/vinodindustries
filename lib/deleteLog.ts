import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export interface LogDeleteArgs {
  module: string          // grey | despatch | finish | dyeing | fold | folding-receipt | packing | reprocess
  slipType?: string       // FP | FR | Fold | Dye | Grey | Despatch | Packing
  slipNo?: string | number | null
  lotNo?: string | null   // single lot or comma-joined
  than?: number | null
  recordId?: number | null
  details?: any           // anything else worth keeping
}

/**
 * Write one row to DeleteLog for any DB deletion. Call BEFORE the actual
 * delete so the record's context is still available. Silently swallows
 * errors so logging failures never block a delete.
 */
export async function logDelete(args: LogDeleteArgs): Promise<void> {
  try {
    const session = await getServerSession(authOptions)
    const userEmail = (session as any)?.user?.email || 'unknown'
    const db = prisma as any
    await db.deleteLog.create({
      data: {
        module: args.module,
        slipType: args.slipType || null,
        slipNo: args.slipNo != null ? String(args.slipNo) : null,
        lotNo: args.lotNo || null,
        than: args.than ?? null,
        recordId: args.recordId ?? null,
        userEmail,
        details: args.details ?? null,
      },
    })
  } catch {
    // never block the delete
  }
}
