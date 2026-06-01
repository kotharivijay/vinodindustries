import { queryTally, getFirm } from './tally'

export interface DeleteVoucherInput {
  firmCode: string
  vchType: string
  vchNumber: string
  date: Date | string
}

export interface DeleteVoucherResult {
  ok: boolean
  alreadyAbsent?: boolean
  importResult?: { deleted: number; errors: number; exceptions: number; lineError: string }
  error?: string
}

// "2026-05-15" or Date -> "20260515"
function toTallyDate(d: Date | string): string {
  const dt = typeof d === 'string' ? new Date(d) : d
  const y = dt.getFullYear()
  const m = String(dt.getMonth() + 1).padStart(2, '0')
  const day = String(dt.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

// "2026-05-15" or Date -> "15-5-2026" (Tally Voucher Register export form)
function toTallyExportDate(d: Date | string): string {
  const dt = typeof d === 'string' ? new Date(d) : d
  return `${dt.getDate()}-${dt.getMonth() + 1}-${dt.getFullYear()}`
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Probe whether a voucher with this exact date + type + number exists in Tally.
// Returns true if at least one matching voucher is found in the register.
async function voucherExists(tallyCompany: string, vchType: string, vchNumber: string, date: Date | string): Promise<boolean> {
  const tallyDate = toTallyExportDate(date)
  const xml = `<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>Voucher Register</ID></HEADER>
  <BODY><DESC><STATICVARIABLES>
    <SVCURRENTCOMPANY>${escapeXml(tallyCompany)}</SVCURRENTCOMPANY>
    <SVFROMDATE TYPE="Date">${tallyDate}</SVFROMDATE>
    <SVTODATE TYPE="Date">${tallyDate}</SVTODATE>
    <VOUCHERTYPENAME>${escapeXml(vchType)}</VOUCHERTYPENAME>
  </STATICVARIABLES></DESC></BODY></ENVELOPE>`
  const text = await queryTally(xml)
  const blocks = text.match(/<VOUCHER[^>]*>[\s\S]*?<\/VOUCHER>/g) || []
  return blocks.some(b => {
    const num = b.match(/<VOUCHERNUMBER>([^<]*)<\/VOUCHERNUMBER>/)?.[1]?.trim()
    return num === vchNumber
  })
}

/**
 * Delete a voucher in Tally, then verify it's actually gone.
 *
 * Tally Prime's IMPORTRESULT counter is unreliable — it can return
 * <DELETED>1</DELETED> while the voucher remains. So we always re-probe
 * after the delete and only return ok:true when the voucher is confirmed
 * absent.
 *
 * The TAGNAME="VOUCHERNUMBER" TAGVALUE="<num>" attributes on the VOUCHER
 * element are required — without them, Tally silently no-ops the delete
 * even though the counters report success. See
 * memory/reference_tally_delete_pattern.md for the full table of variants
 * tested.
 */
export async function deleteVoucherInTally(input: DeleteVoucherInput): Promise<DeleteVoucherResult> {
  const firm = getFirm(input.firmCode)
  if (!firm) return { ok: false, error: `unknown firm: ${input.firmCode}` }

  const tallyCompany = firm.tallyName
  const tallyDate = toTallyDate(input.date)

  // Short-circuit: if the voucher isn't in Tally to begin with, treat as
  // already done. Useful for cleaning up local orphans.
  const existedBefore = await voucherExists(tallyCompany, input.vchType, input.vchNumber, input.date)
  if (!existedBefore) {
    return { ok: true, alreadyAbsent: true }
  }

  const deleteXml = `<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Import</TALLYREQUEST><TYPE>Data</TYPE><ID>Vouchers</ID></HEADER>
  <BODY>
    <DESC><STATICVARIABLES><SVCURRENTCOMPANY>${escapeXml(tallyCompany)}</SVCURRENTCOMPANY></STATICVARIABLES></DESC>
    <DATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
      <VOUCHER DATE="${tallyDate}" VCHTYPE="${escapeXml(input.vchType)}" ACTION="Delete" TAGNAME="VOUCHERNUMBER" TAGVALUE="${escapeXml(input.vchNumber)}">
        <DATE>${tallyDate}</DATE>
        <VOUCHERTYPENAME>${escapeXml(input.vchType)}</VOUCHERTYPENAME>
        <VOUCHERNUMBER>${escapeXml(input.vchNumber)}</VOUCHERNUMBER>
      </VOUCHER>
    </TALLYMESSAGE></DATA>
  </BODY></ENVELOPE>`

  const respText = await queryTally(deleteXml)
  const importResult = {
    deleted: Number(respText.match(/<DELETED>(\d+)<\/DELETED>/)?.[1] ?? 0),
    errors: Number(respText.match(/<ERRORS>(\d+)<\/ERRORS>/)?.[1] ?? 0),
    exceptions: Number(respText.match(/<EXCEPTIONS>(\d+)<\/EXCEPTIONS>/)?.[1] ?? 0),
    lineError: (respText.match(/<LINEERROR>([^<]*)<\/LINEERROR>/)?.[1] ?? '').trim(),
  }

  // Always verify — IMPORTRESULT counters lie.
  const stillThere = await voucherExists(tallyCompany, input.vchType, input.vchNumber, input.date)
  if (stillThere) {
    return {
      ok: false,
      importResult,
      error: `Tally reported DELETED=${importResult.deleted} but voucher ${input.vchType} #${input.vchNumber} is still present.${importResult.lineError ? ' Tally: ' + importResult.lineError : ''}`,
    }
  }

  return { ok: true, importResult }
}
