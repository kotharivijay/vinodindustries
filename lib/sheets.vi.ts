import { GoogleAuth } from 'google-auth-library'

export async function readGoogleSheet(sheetId: string, range: string): Promise<string[][]> {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}')
  const auth = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] })
  const client = await auth.getClient() as any
  const token = await client.getAccessToken()
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token.token}` } })
  const data = await res.json()
  return data.values || []
}

export const VI_ORDER_SHEET_ID = '1btQIur0Fh9IGBnFwGDt4IqTwE9juerz8Od7KB0j0qng'
export const VI_OS_SHEET_ID = '1qCAQiE6u-kvYB8cpjn0wRdfb-8a3Mz-WyCKBU1CArck'

export const ORDER_SHEETS = [
  { name: 'VI Order', firmCode: 'VI' },
  { name: 'VCF Order', firmCode: 'VCF' },
  { name: 'VF Order', firmCode: 'VF' },
]

export const CONTACT_SHEETS = [
  { name: 'vi pa', firmCode: 'VI', headerRow: 3, dataRow: 4 },
  { name: 'vcf pa', firmCode: 'VCF', headerRow: 2, dataRow: 3 },
]

export const BANK_SHEETS = [
  { name: 'vi_bank', firmCode: 'VI' },
  { name: 'bank', firmCode: 'VCF' },
]

export function parseMobile(raw: string): string | null {
  if (!raw) return null
  const cleaned = raw.replace(/\D/g, '')
  if (cleaned.length < 7 || raw.toLowerCase().includes('no need')) return null
  // Remove 91 prefix if 12 digits
  if (cleaned.length === 12 && cleaned.startsWith('91')) return cleaned.slice(2)
  if (cleaned.length === 10) return cleaned
  return cleaned.length >= 7 ? cleaned : null
}
