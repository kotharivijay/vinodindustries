import { NextResponse } from 'next/server'
import { GoogleAuth } from 'google-auth-library'

export async function GET() {
  const DESPATCH_SHEET_ID = process.env.DESPATCH_SHEET_ID
  const DESPATCH_SHEET_NAME = process.env.DESPATCH_SHEET_NAME ?? 'Sheet1'
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY

  const info: Record<string, any> = {
    DESPATCH_SHEET_ID: DESPATCH_SHEET_ID ?? 'NOT SET',
    DESPATCH_SHEET_NAME,
    SERVICE_ACCOUNT_KEY_SET: !!keyJson,
    SERVICE_ACCOUNT_EMAIL: null,
    TOKEN_OK: false,
    SHEET_API_STATUS: null,
    SHEET_API_ERROR: null,
    SHEET_ROWS_RETURNED: null,
    RANGE_USED: null,
  }

  if (!keyJson) return NextResponse.json(info)

  try {
    const credentials = JSON.parse(keyJson)
    info.SERVICE_ACCOUNT_EMAIL = credentials.client_email

    const auth = new GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    })
    const client = await auth.getClient()
    const token = await client.getAccessToken()
    info.TOKEN_OK = !!token.token

    if (token.token && DESPATCH_SHEET_ID) {
      const headers = { Authorization: `Bearer ${token.token}` }

      // 1. Fetch spreadsheet metadata to confirm ID is valid and list all tabs
      const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${DESPATCH_SHEET_ID}?fields=spreadsheetId,properties.title,sheets.properties`
      const metaRes = await fetch(metaUrl, { headers })
      info.METADATA_STATUS = metaRes.status
      const metaBody = await metaRes.json()
      if (metaRes.ok) {
        info.SPREADSHEET_TITLE = metaBody.properties?.title
        info.SHEET_TABS = metaBody.sheets?.map((s: any) => s.properties?.title)
      } else {
        info.METADATA_ERROR = metaBody?.error?.message ?? metaBody
      }

      // 2. Try range without quotes
      const range2 = encodeURIComponent(`${DESPATCH_SHEET_NAME}!A1:P5`)
      info.RANGE_NO_QUOTES = `${DESPATCH_SHEET_NAME}!A1:P5`
      const url2 = `https://sheets.googleapis.com/v4/spreadsheets/${DESPATCH_SHEET_ID}/values/${range2}`
      const res2 = await fetch(url2, { headers })
      info.NO_QUOTES_STATUS = res2.status
      const body2 = await res2.json()
      if (res2.ok) {
        info.SHEET_ROWS_RETURNED = body2.values?.length ?? 0
        info.FIRST_3_ROWS = body2.values?.slice(0, 3)
      } else {
        info.NO_QUOTES_ERROR = body2?.error?.message ?? body2
      }
    }
  } catch (e: any) {
    info.ERROR = e.message
  }

  return NextResponse.json(info, { status: 200 })
}
