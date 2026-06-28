import { prisma } from '@/lib/prisma'

const db = prisma as any

/**
 * Lifecycle hooks for PcPaliReprocessLot. The PC-RP carries the rework
 * through fold → dye → finish. Status flips:
 *
 *   pending-approval                            (created from finish stock)
 *     ↓ PATCH /api/dyeing/pc-reprocess/[id]/approve
 *   pending                                     (visible in fold picker)
 *     ↓ fold batch saved with PC-RP lot         (onPcRpFolded)
 *   in-fold
 *     ↓ dye slip created from that fold batch   (onPcRpDyeCreated)
 *   in-dyeing
 *     ↓ dye slip marked dyeingDoneAt            (onPcRpDyeDone)
 *   finished
 *     ↓ finish entry consumes the PC-RP         (onPcRpMerged)
 *   merged
 *
 * All hooks are idempotent and safe to call multiple times.
 */

const RE_PC_RP = /^PC-RP-\d+$/i

export function isPcRpLotNo(lotNo: string | null | undefined): boolean {
  return !!lotNo && RE_PC_RP.test(lotNo.trim())
}

/** Find PcPaliReprocessLot ids referenced by a list of lot codes. */
export async function findPcRpIds(lotNos: string[]): Promise<{ id: number; reproNo: string; status: string }[]> {
  const codes = lotNos.filter(isPcRpLotNo).map(c => c.trim().toUpperCase())
  if (codes.length === 0) return []
  const rows = await db.pcPaliReprocessLot.findMany({
    where: { reproNo: { in: codes, mode: 'insensitive' } },
    select: { id: true, reproNo: true, status: true },
  })
  return rows
}

/** Flip PC-RP to 'in-fold' when its code shows up in a fold batch save. */
export async function onPcRpFolded(lotNos: string[]): Promise<void> {
  const rps = await findPcRpIds(lotNos)
  for (const r of rps) {
    // Only advance from 'pending'; later states already lock the rework in.
    if (r.status !== 'pending') continue
    await db.pcPaliReprocessLot.update({ where: { id: r.id }, data: { status: 'in-fold' } })
  }
}

/** Flip PC-RP to 'in-dyeing' when a dye slip is created from a fold batch
 *  that contains the PC-RP code. Idempotent. */
export async function onPcRpDyeCreated(lotNos: string[]): Promise<void> {
  const rps = await findPcRpIds(lotNos)
  for (const r of rps) {
    if (r.status !== 'pending' && r.status !== 'in-fold') continue
    await db.pcPaliReprocessLot.update({ where: { id: r.id }, data: { status: 'in-dyeing' } })
  }
}

/** Flip PC-RP to 'finished' once the rework dye slip has dyeingDoneAt set. */
export async function onPcRpDyeDone(lotNos: string[]): Promise<void> {
  const rps = await findPcRpIds(lotNos)
  for (const r of rps) {
    if (r.status === 'merged' || r.status === 'finished') continue
    await db.pcPaliReprocessLot.update({ where: { id: r.id }, data: { status: 'finished' } })
  }
}

/** Flip PC-RP to 'merged' when finish entry consumes it.
 *  Called by /api/finish POST/PUT once a FinishEntryLot pcReprocessLotId is set. */
export async function onPcRpMerged(pcReprocessLotIds: number[]): Promise<void> {
  if (pcReprocessLotIds.length === 0) return
  await db.pcPaliReprocessLot.updateMany({
    where: { id: { in: pcReprocessLotIds }, status: { not: 'merged' } },
    data: { status: 'merged', mergedAt: new Date() },
  })
}
