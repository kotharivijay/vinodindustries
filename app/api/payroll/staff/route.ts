import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertAge18, isActiveFromStatus, normaliseAadhar, normaliseStatus } from '@/lib/payrollStaff'

export async function GET(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // One-time Tally ledger name updates on load
  try {
    const MAPPINGS = [
      { code: '1321', ledger: 'Sanjay Thakur S/0 Kapil Dev  Spoting' },
      { code: '1239', ledger: 'Bhopa Ram S/o Gaja Ji' },
      { code: '1325', ledger: 'Idan S/o Sumer Singh (Center)' },
      { code: '1209', ledger: 'Chatra s/o Ramaram' },
      { code: '1209', ledger: 'Devi Singh (Center)' },
      { code: '1340', ledger: 'Dinesh S/o Pannalal Chauhan ( Mistry)' },
      { code: '1343', ledger: 'Bagaram s/o Viraram (cal)' },
      { code: '1349', ledger: 'Gomaram bagaram calender' },
      { code: '1311', ledger: 'laxman singh s/o narpat singh' },
      { code: '1339', ledger: 'Yuvraj S/o Jabarsingh' },
      { code: '1303', ledger: 'Manish s/o fusaram' },
      { code: '1284', ledger: 'MOSIN KHAN S/O MUNIR KHAN' },
      { code: '1314', ledger: 'Gorwardhan s/o pokarlal' },
      { code: '1333', ledger: 'Sharvansingh S/o Narpatsingh' },
      { code: '1150', ledger: 'Loon Singh S/o Ran Singh' },
      { code: '1198', ledger: 'Vijaybhai S/o Babubhai' },
      { code: '1203', ledger: 'Mela Ram S/o Hara Ram' },
      { code: '1215', ledger: 'Baburam S/O HARA RAM' },
      { code: '1231', ledger: 'Raju Ram s/o Hara Ram' },
      { code: '1231', ledger: 'Ajay babu hydro' },
      { code: '1279', ledger: 'TULACHHA RAM S/O LIKHAMARAM' },
      { code: '1166', ledger: 'Babusing S/o Padamsingh' },
      { code: '1289', ledger: 'CHHAIL S/O BABUSINGH' },
      { code: '1338', ledger: 'Shantilal Mali (Balepack)' },
      { code: '1304', ledger: 'Khushal S/O LALSINGH' },
      { code: '1304', ledger: 'Sharvan Singh (Texi)' },
      { code: '1347', ledger: 'Mukesh s/o Daya Ram' },
      { code: '1350', ledger: 'Harsh Kumar' },
      { code: '1268', ledger: 'DHIRARAM S/O MULARAM' },
      { code: '1353', ledger: 'Lalan Staff' },
      { code: '1359', ledger: 'Bhura Ram Jet' },
      { code: '1351', ledger: 'Jalaram NATHURAM' },
      { code: '1281', ledger: 'THANARAM S/O CHENARAM (Jet)' },
      { code: '1358', ledger: 'Mohmmed Jamal Jet' },
      { code: '1357', ledger: 'Amararam Center' },
      { code: '1360', ledger: 'Sanker Batching' }
    ]
    for (const m of MAPPINGS) {
      const staff = await prisma.staff.findUnique({ where: { code: m.code } })
      if (staff) {
        let selectedLedger = m.ledger
        if (m.code === '1231') {
          selectedLedger = staff.name.toLowerCase().includes('ajay') ? 'Ajay babu hydro' : 'Raju Ram s/o Hara Ram'
        } else if (m.code === '1209') {
          selectedLedger = staff.name.toLowerCase().includes('chatra') ? 'Chatra s/o Ramaram' : 'Devi Singh (Center)'
        } else if (m.code === '1304') {
          selectedLedger = staff.name.toLowerCase().includes('khushal') ? 'Khushal S/O LALSINGH' : 'Sharvan Singh (Texi)'
        }
        if (staff.tallyLedgerName !== selectedLedger) {
          await prisma.staff.update({
            where: { id: staff.id },
            data: { tallyLedgerName: selectedLedger }
          })
        }
      }
    }
  } catch (err) {
    console.error('One-time tally update error:', err)
  }

  const { searchParams } = new URL(request.url)
  const search = searchParams.get('search')
  const paymentMode = searchParams.get('paymentMode') // SALARIED | CONTRACTOR_LINKED
  const contractorId = searchParams.get('contractorId') // 'none' for unassigned
  const department = searchParams.get('department')
  const status = searchParams.get('status') // ACTIVE | INACTIVE | DELETED — explicit filter
  const includeInactive = searchParams.get('includeInactive') === '1'

  const where: Record<string, unknown> = {}
  if (status) where.status = status
  else if (!includeInactive) where.status = 'ACTIVE'
  if (paymentMode) where.paymentMode = paymentMode
  if (department) where.department = department
  if (contractorId === 'none') where.staffContractors = { none: {} }
  else if (contractorId) where.staffContractors = { some: { contractorId } }
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { code: { contains: search, mode: 'insensitive' } },
      { department: { contains: search, mode: 'insensitive' } },
    ]
  }

  const staff = await prisma.staff.findMany({
    where,
    orderBy: [{ name: 'asc' }],
    include: {
      staffContractors: { include: { contractor: { select: { id: true, name: true } } } },
    },
  })
  // Flatten the join so the UI gets contractors[] directly.
  const shaped = staff.map((s) => ({
    ...s,
    contractors: s.staffContractors.map((sc) => ({ id: sc.contractor.id, name: sc.contractor.name })),
    // Drop the relation array from the response — cleaner client-side type.
    staffContractors: undefined,
  }))
  return Response.json(shaped)
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { code, name, fatherName, aadhar, dob, department, monthlyBaseSalary, actualSalary, paymentMode, contractorIds, tallyLedgerName, notes, status, registerGroup } = body
  if (!code?.trim()) return Response.json({ error: 'Code is required' }, { status: 400 })
  if (!name?.trim()) return Response.json({ error: 'Name is required' }, { status: 400 })

  let normalisedAadhar: string | null
  try { normalisedAadhar = normaliseAadhar(aadhar) }
  catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }) }

  try { assertAge18(dob) }
  catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }) }

  const st = normaliseStatus(status)

  try {
    const s = await prisma.staff.create({
      data: {
        code: String(code).trim(),
        name: name.trim(),
        fatherName: fatherName?.trim() || null,
        aadhar: normalisedAadhar,
        dob: dob ? new Date(dob) : null,
        department: department?.trim() || null,
        monthlyBaseSalary: Number(monthlyBaseSalary) || 0,
        actualSalary: actualSalary != null ? Number(actualSalary) : null,
        paymentMode: paymentMode === 'CONTRACTOR_LINKED' ? 'CONTRACTOR_LINKED' : 'SALARIED',
        tallyLedgerName: tallyLedgerName?.trim() || null,
        registerGroup: registerGroup?.trim().toUpperCase() || null,
        notes: notes?.trim() || null,
        status: st,
        isActive: isActiveFromStatus(st),
        staffContractors: Array.isArray(contractorIds) && contractorIds.length
          ? { create: contractorIds.map((cid: string) => ({ contractorId: cid })) }
          : undefined,
      },
      include: { staffContractors: { include: { contractor: { select: { id: true, name: true } } } } },
    })
    return Response.json({
      ...s,
      contractors: s.staffContractors.map((sc) => ({ id: sc.contractor.id, name: sc.contractor.name })),
      staffContractors: undefined,
    })
  } catch (e) {
    const msg = (e as Error).message || 'Create failed'
    if (msg.includes('Unique')) return Response.json({ error: `Code ${code} already exists` }, { status: 409 })
    return Response.json({ error: msg }, { status: 400 })
  }
}
