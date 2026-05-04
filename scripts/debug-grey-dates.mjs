// Inspect createdAt vs updatedAt for sn 107-113 + the actual sheet values for those rows.
import { PrismaClient } from '@prisma/client'
import { GoogleAuth } from 'google-auth-library'
const prisma = new PrismaClient()

const SHEET_ID = process.env.GOOGLE_SHEET_ID || '1FkDEA84AWJxHBMTX7ku67TRdIo-GP1VMOzO_3ZOUVMo'
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME || 'INWERD GRAY'

async function readSheet() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!keyJson) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY missing')
  const credentials = JSON.parse(keyJson)
  const auth = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] })
  const client = await auth.getClient()
  const token = await client.getAccessToken()
  const range = encodeURIComponent(`'${SHEET_NAME}'!A3:R`)
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token.token}` } })
  if (!res.ok) throw new Error(`Sheet HTTP ${res.status}`)
  return (await res.json()).values || []
}

async function main() {
  const greys = await prisma.greyEntry.findMany({
    where: { sn: { in: [107, 108, 109, 110, 111, 112, 113] } },
    select: { sn: true, lotNo: true, date: true, createdAt: true, updatedAt: true, challanNo: true },
    orderBy: { sn: 'asc' },
  })
  console.log('-- DB --')
  for (const g of greys) {
    const same = g.createdAt.getTime() === g.updatedAt.getTime()
    console.log(`sn=${g.sn} lot=${g.lotNo} ch=${g.challanNo}  date=${g.date.toISOString().slice(0,10)}  created=${g.createdAt.toISOString().slice(0,16)}  updated=${g.updatedAt.toISOString().slice(0,16)} ${same ? '(never edited)' : '(EDITED)'}`)
  }

  console.log('\n-- Sheet rows --')
  const values = await readSheet()
  // Headers in row 3 of sheet, but range starts A3 so values[0] = header, values[1+] = data
  const [, ...rows] = values
  for (const r of rows) {
    const sn = parseInt(r[0])
    if ([107,108,109,110,111,112,113].includes(sn)) {
      console.log(`sn=${sn}  monthCol=${r[1]}  dateCol="${r[2]}"  challan=${r[3]}  party=${r[4]}  lot=${r[16]}`)
    }
  }
}
main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
