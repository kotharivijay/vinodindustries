import { NextRequest, NextResponse } from 'next/server'
import { viPrisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// POST — save a batch of parsed ledgers to DB using raw SQL for speed
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { firmCode, ledgers, isFirstBatch } = await req.json()
  if (!firmCode || !ledgers?.length) return NextResponse.json({ error: 'firmCode and ledgers required' }, { status: 400 })

  const db = viPrisma as any

  // On first batch, delete all existing ledgers for this firm (replace strategy)
  if (isFirstBatch) {
    try {
      await db.tallyLedger.deleteMany({ where: { firmCode } })
    } catch (e: any) {
      console.error('Delete failed:', e.message)
    }
  }

  // Deduplicate within batch (Tally may have duplicate ledger names)
  const now = new Date()
  function parseMobiles(raw: string | null): { m1: string | null; m2: string | null; m3: string | null } {
    if (!raw) return { m1: null, m2: null, m3: null }
    const nums = raw.split(/[,;|\/\s]+/).map(n => n.replace(/[^0-9+]/g, '').trim()).filter(n => n.length >= 7 && n.length <= 15)
    return { m1: nums[0] || null, m2: nums[1] || null, m3: nums[2] || null }
  }

  const seen = new Set<string>()
  const data: any[] = []
  for (const l of ledgers) {
    const key = `${firmCode}|${(l.name || '').trim()}`
    if (seen.has(key) || !l.name?.trim()) continue
    seen.add(key)
    const { m1, m2, m3 } = parseMobiles(l.mobileNos)
    data.push({
      firmCode,
      name: l.name.trim(),
      parent: l.parent || null,
      address: l.address || null,
      gstNo: l.gstNo || null,
      panNo: l.panNo || null,
      mobileNos: l.mobileNos || null,
      mobileNo1: m1,
      mobileNo2: m2,
      mobileNo3: m3,
      state: l.state || null,
      lastSynced: now,
    })
  }

  if (!data.length) return NextResponse.json({ saved: 0, errors: 0 })

  try {
    const result = await db.tallyLedger.createMany({
      data,
      skipDuplicates: true,
    })
    return NextResponse.json({ saved: result.count, errors: 0 })
  } catch (e: any) {
    console.error('CreateMany failed:', e.message?.slice(0, 200))
    // Fallback: try one by one
    let saved = 0
    for (const d of data) {
      try {
        await db.tallyLedger.upsert({
          where: { firmCode_name: { firmCode: d.firmCode, name: d.name } },
          create: d,
          update: { ...d, firmCode: undefined, name: undefined },
        })
        saved++
      } catch {}
    }
    return NextResponse.json({ saved, errors: data.length - saved, fallback: true })
  }
}
