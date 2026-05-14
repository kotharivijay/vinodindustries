export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { normalizeLotNo } from '@/lib/lot-no'

// POST /api/fold/import — bulk import folds from structured text
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { folds } = await req.json()

  if (!Array.isArray(folds) || folds.length === 0) {
    return NextResponse.json({ error: 'No folds provided' }, { status: 400 })
  }

  const results: { foldNo: string; status: string; error?: string; id?: number }[] = []

  for (const fold of folds) {
    try {
      const { foldNo, partyName, qualityName, shadeNo, shadeName, batches } = fold

      if (!foldNo?.trim()) {
        results.push({ foldNo: foldNo ?? '?', status: 'error', error: 'Missing fold number' })
        continue
      }

      // Check if foldNo already exists
      const existing = await (prisma as any).foldProgram.findUnique({
        where: { foldNo: String(foldNo).trim() },
      })
      if (existing) {
        results.push({ foldNo, status: 'error', error: 'Fold number already exists' })
        continue
      }

      // Find party (case-insensitive)
      let party = null
      if (partyName?.trim()) {
        party = await (prisma as any).party.findFirst({
          where: { name: { equals: partyName.trim(), mode: 'insensitive' } },
        })
        if (!party) {
          // Create party
          party = await (prisma as any).party.create({
            data: { name: partyName.trim() },
          })
        }
      }

      // Find quality (case-insensitive)
      let quality = null
      if (qualityName?.trim()) {
        quality = await (prisma as any).quality.findFirst({
          where: { name: { equals: qualityName.trim(), mode: 'insensitive' } },
        })
        if (!quality) {
          // Create quality
          quality = await (prisma as any).quality.create({
            data: { name: qualityName.trim() },
          })
        }
      }

      // Find shade by name (case-insensitive)
      let shade = null
      if (shadeName?.trim()) {
        shade = await (prisma as any).shade.findFirst({
          where: { name: { equals: shadeName.trim(), mode: 'insensitive' } },
        })
      }

      // Use the date from the first batch, or today
      const foldDate = batches?.[0]?.date
        ? new Date(batches[0].date)
        : new Date()

      // Create FoldProgram with batches and lots
      const program = await (prisma as any).foldProgram.create({
        data: {
          foldNo: String(foldNo).trim(),
          date: foldDate,
          status: 'draft',
          batches: {
            create: (batches ?? []).map((batch: any, idx: number) => ({
              batchNo: idx + 1,
              shadeId: shade?.id ?? undefined,
              shadeName: shade ? undefined : (shadeName?.trim() || undefined),
              lots: {
                create: (batch.lots ?? []).map((lot: any) => ({
                  lotNo: normalizeLotNo(lot.lotNo) ?? '',
                  partyId: party?.id ?? undefined,
                  qualityId: quality?.id ?? undefined,
                  than: parseInt(lot.than) || 0,
                })),
              },
            })),
          },
        },
        include: {
          batches: {
            include: {
              shade: true,
              lots: { include: { party: true, quality: true } },
            },
          },
        },
      })

      results.push({ foldNo, status: 'ok', id: program.id })
    } catch (e: any) {
      results.push({ foldNo: fold.foldNo ?? '?', status: 'error', error: e.message })
    }
  }

  return NextResponse.json({ results })
}
