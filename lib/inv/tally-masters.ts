import { queryTally, getFirm } from '@/lib/tally'

const KSI = getFirm('KSI')!

/**
 * XML envelope to export Ledgers under Sundry Creditors / Sundry Debtors,
 * including any sub-group beneath them. $$IsBeneath walks the group chain;
 * the equality tests catch ledgers parked at the top-level group itself
 * ($$IsBeneath returns NO for the group's own ledgers).
 */
function buildPartiesXML(): string {
  return `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>InvPartiesExport</ID></HEADER>
<BODY>
<DESC>
<STATICVARIABLES>
<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
<SVCURRENTCOMPANY>${KSI.tallyName}</SVCURRENTCOMPANY>
</STATICVARIABLES>
<TDL><TDLMESSAGE>
<COLLECTION NAME="InvPartiesExport" ISMODIFY="No">
<TYPE>Ledger</TYPE>
<FETCH>Name,Parent,GUID,Address,LedStateName,GSTRegistrationType,PartyGSTIN,LedgerPhone,LedgerMobile,Email,IsBillWiseOn</FETCH>
<FILTER>SundryParty</FILTER>
</COLLECTION>
<SYSTEM TYPE="Formulae" NAME="SundryParty">$$IsBeneath:$Parent:"Sundry Creditors" OR $Parent = "Sundry Creditors" OR $$IsBeneath:$Parent:"Sundry Debtors" OR $Parent = "Sundry Debtors"</SYSTEM>
</TDLMESSAGE></TDL>
</DESC>
</BODY>
</ENVELOPE>`
}

/**
 * XML envelope to export Stock Items (used as Layer-2 alias master).
 */
function buildStockItemsXML(): string {
  return `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>InvStockItemsExport</ID></HEADER>
<BODY>
<DESC>
<STATICVARIABLES>
<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
<SVCURRENTCOMPANY>${KSI.tallyName}</SVCURRENTCOMPANY>
</STATICVARIABLES>
<TDL><TDLMESSAGE>
<COLLECTION NAME="InvStockItemsExport" ISMODIFY="No">
<TYPE>StockItem</TYPE>
<FETCH>Name,Parent,GUID,BaseUnits,GSTApplicable,GSTDetails,HSNCode,GSTApplicableValue,GSTRateDetailsList</FETCH>
</COLLECTION>
</TDLMESSAGE></TDL>
</DESC>
</BODY>
</ENVELOPE>`
}

/**
 * XML envelope to export Stock Groups so we can fall back on group-level
 * HSN / GST when the stock item itself has it blank.
 */
function buildStockGroupsXML(): string {
  return `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>InvStockGroupsExport</ID></HEADER>
<BODY>
<DESC>
<STATICVARIABLES>
<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
<SVCURRENTCOMPANY>${KSI.tallyName}</SVCURRENTCOMPANY>
</STATICVARIABLES>
<TDL><TDLMESSAGE>
<COLLECTION NAME="InvStockGroupsExport" ISMODIFY="No">
<TYPE>StockGroup</TYPE>
<FETCH>Name,Parent,HSNCode,GSTDetails,GSTRateDetailsList</FETCH>
</COLLECTION>
</TDLMESSAGE></TDL>
</DESC>
</BODY>
</ENVELOPE>`
}

// Word boundary `\\b` is critical — without it `<GSTRATE` would also match
// `<GSTRATEDUTYHEAD>` and similar, swallowing nested content and breaking
// the rate extraction.
const xml = (s: string, tag: string): string => {
  const m = s.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`))
  return m ? m[1].trim() : ''
}

const xmlAll = (s: string, tag: string): string[] => {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'g')
  const out: string[] = []
  let m
  while ((m = re.exec(s)) !== null) out.push(m[1].trim())
  return out
}

// Strip Tally end-of-text marker that occasionally appears as an XML entity
// in string fields (e.g. "&#4; Applicable", "&#4; Any").
const cleanTallyText = (s: string | null | undefined): string =>
  (s ?? '').replace(/&#4;/g, '').replace(/&amp;/g, '&').trim()

export interface FetchedParty {
  tallyLedger: string
  tallyGuid: string | null
  parentGroup: string | null
  state: string | null
  gstin: string | null
  gstRegistrationType: string
  whatsapp: string | null
  email: string | null
  city: string | null
}

export async function fetchPartiesFromTally(): Promise<FetchedParty[]> {
  const raw = await queryTally(buildPartiesXML())
  const ledgers = raw.match(/<LEDGER\s[^>]*>[\s\S]*?<\/LEDGER>/g) || []
  return ledgers.map(block => {
    const tallyLedger = (block.match(/<LEDGER\s[^>]*NAME="([^"]+)"/) || [])[1]?.trim() || ''
    const parent = xml(block, 'PARENT')
    const guid = xml(block, 'GUID')
    const state = xml(block, 'LEDSTATENAME')
    const gstin = xml(block, 'PARTYGSTIN')
    const gstType = xml(block, 'GSTREGISTRATIONTYPE') || 'Regular'
    const phone = xml(block, 'LEDGERMOBILE') || xml(block, 'LEDGERPHONE')
    const email = xml(block, 'EMAIL')
    return {
      tallyLedger,
      tallyGuid: guid || null,
      parentGroup: parent || null,
      state: state || null,
      gstin: gstin || null,
      gstRegistrationType: ['Regular', 'Composition', 'Unregistered'].includes(gstType) ? gstType : 'Regular',
      whatsapp: phone || null,
      email: email || null,
      city: null,
    }
  }).filter(p => p.tallyLedger)
}

export interface FetchedAlias {
  tallyStockItem: string
  tallyGuid: string | null
  category: string
  unit: string
  gstRate: number
  hsn: string | null
  defaultTrackStock: boolean
}

/**
 * Pull the total GST rate from a STOCKITEM block. Tally emits one
 * <RATEDETAILS.LIST> per duty head (CGST, SGST/UTGST, IGST, Cess, …).
 * The "real" rate is the IGST one (= CGST + SGST). We prefer that, fall
 * back to summing CGST + SGST/UTGST, and finally to the highest non-zero
 * <GSTRATE> we can find.
 */
function extractGstRate(block: string): number {
  const rateBlocks = xmlAll(block, 'RATEDETAILS.LIST')
  let cgst = 0
  let sgst = 0
  let igst = 0
  for (const rb of rateBlocks) {
    const head = xml(rb, 'GSTRATEDUTYHEAD').toUpperCase()
    const rateRaw = xml(rb, 'GSTRATE')
    const rate = parseFloat(rateRaw)
    if (!Number.isFinite(rate)) continue
    if (head === 'IGST') igst = Math.max(igst, rate)
    else if (head === 'CGST') cgst = Math.max(cgst, rate)
    else if (head.startsWith('SGST') || head.startsWith('UTGST')) sgst = Math.max(sgst, rate)
  }
  if (igst > 0) return igst
  if (cgst + sgst > 0) return cgst + sgst
  // Fallback: scan every GSTRATE in the block, take max
  const all = xmlAll(block, 'GSTRATE').map(s => parseFloat(s)).filter(n => Number.isFinite(n))
  return all.length ? Math.max(...all) : 0
}

/**
 * Fetch every Stock Group and read off HSN + total GST rate. Used to
 * backfill items whose own HSN/GST are blank (common when the user
 * configures these at the group level in Tally).
 */
async function fetchStockGroupHsnGstMap(): Promise<Map<string, { hsn: string | null; gstRate: number }>> {
  const map = new Map<string, { hsn: string | null; gstRate: number }>()
  try {
    const raw = await queryTally(buildStockGroupsXML())
    const groups = raw.match(/<STOCKGROUP\s[^>]*>[\s\S]*?<\/STOCKGROUP>/g) || []
    for (const block of groups) {
      const name = cleanTallyText((block.match(/<STOCKGROUP\s[^>]*NAME="([^"]+)"/) || [])[1])
      if (!name) continue
      const gstDetails = xml(block, 'GSTDETAILS\\.LIST')
      const hsn = cleanTallyText(
        xml(block, 'HSNCODE') ||
        xml(block, 'HSN') ||
        xml(gstDetails, 'HSNCODE') ||
        xml(gstDetails, 'HSN')
      )
      const gstRate = extractGstRate(block)
      map.set(name, { hsn: hsn || null, gstRate })
    }
  } catch {
    // Swallow — group fetch is best-effort. Items just won't get the fallback.
  }
  return map
}

export async function fetchAliasesFromTally(): Promise<FetchedAlias[]> {
  // Fire both queries in parallel — groups are best-effort, items are required.
  const [raw, groupMap] = await Promise.all([
    queryTally(buildStockItemsXML()),
    fetchStockGroupHsnGstMap(),
  ])
  const items = raw.match(/<STOCKITEM\s[^>]*>[\s\S]*?<\/STOCKITEM>/g) || []
  return items.map(block => {
    const tallyStockItem = cleanTallyText((block.match(/<STOCKITEM\s[^>]*NAME="([^"]+)"/) || [])[1])
    const guid = xml(block, 'GUID')
    const parent = cleanTallyText(xml(block, 'PARENT'))
    const unit = cleanTallyText(xml(block, 'BASEUNITS')) || 'kg'
    // HSN can sit at item level OR inside <GSTDETAILS.LIST>
    const gstDetails = xml(block, 'GSTDETAILS\\.LIST')
    const itemHsn = cleanTallyText(
      xml(block, 'HSNCODE') ||
      xml(block, 'HSN') ||
      xml(gstDetails, 'HSNCODE') ||
      xml(gstDetails, 'HSN')
    )
    const itemGstRate = extractGstRate(block)

    // Fall back to the parent group when the item itself has no HSN / GST
    const groupFallback = groupMap.get(parent)
    const hsn = itemHsn || groupFallback?.hsn || null
    const gstRate = itemGstRate > 0 ? itemGstRate : (groupFallback?.gstRate ?? 0)

    // Map Tally parent group to our internal category
    const cat = parent.toLowerCase()
    const category = cat.includes('dye') ? 'Dye'
      : cat.includes('chem') ? 'Chemical'
      : cat.includes('aux') ? 'Auxiliary'
      : cat.includes('spare') || cat.includes('machinery') ? 'Spare'
      : 'Auxiliary'

    return {
      tallyStockItem,
      tallyGuid: guid || null,
      category,
      unit,
      gstRate: Number.isFinite(gstRate) ? gstRate : 0,
      hsn,
      defaultTrackStock: category === 'Chemical' || category === 'Dye',
    }
  }).filter(a => a.tallyStockItem)
}
