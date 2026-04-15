export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const db = prisma as any

interface ShadeInput {
  name: string
  description?: string
  chemicals: {
    chemicalId: number
    percent: number
    ocrName?: string  // raw OCR name for alias learning
  }[]
}

// POST — save multiple shades from import
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { shades } = await req.json() as { shades: ShadeInput[] }
  if (!shades?.length) return NextResponse.json({ error: 'No shades provided' }, { status: 400 })

  const saved: any[] = []
  const duplicates: string[] = []

  for (const shade of shades) {
    const name = shade.name?.trim()
    if (!name) continue

    // Check for duplicate
    const existing = await db.shade.findUnique({ where: { name } })
    if (existing) {
      duplicates.push(name)
      continue
    }

    // Create shade with recipe items
    const cleanItems = (shade.chemicals ?? []).filter(c => c.chemicalId && c.percent > 0)

    const created = await db.$transaction(async (tx: any) => {
      const s = await tx.shade.create({
        data: {
          name,
          description: shade.description?.trim() || null,
        },
      })

      if (cleanItems.length > 0) {
        await tx.shadeRecipeItem.createMany({
          data: cleanItems.map(c => ({
            shadeId: s.id,
            chemicalId: c.chemicalId,
            quantity: c.percent,
            isPercent: true,
          })),
        })
      }

      return tx.shade.findUnique({
        where: { id: s.id },
        include: {
          recipeItems: {
            include: { chemical: { select: { id: true, name: true, unit: true } } },
          },
        },
      })
    })

    saved.push(created)

    // Learn OCR aliases: if ocrName differs from the actual chemical name, upsert alias
    for (const c of cleanItems) {
      if (c.ocrName && c.ocrName.trim()) {
        try {
          const chemical = await db.chemical.findUnique({
            where: { id: c.chemicalId },
            select: { name: true },
          })
          if (chemical && c.ocrName.trim().toLowerCase() !== chemical.name.toLowerCase()) {
            await db.chemicalAlias.upsert({
              where: { ocrName: c.ocrName.trim().toLowerCase() },
              update: { chemicalId: c.chemicalId, hitCount: { increment: 1 } },
              create: { ocrName: c.ocrName.trim().toLowerCase(), chemicalId: c.chemicalId },
            })
          }
        } catch (_) {
          // Alias learning is best-effort — don't fail the save
        }
      }
    }
  }

  return NextResponse.json({ saved, duplicates })
}
