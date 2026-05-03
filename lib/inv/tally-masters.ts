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

const xml = (s: string, tag: string): string => {
  const m = s.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`))
  return m ? m[1].trim() : ''
}

const xmlAll = (s: string, tag: string): string[] => {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'g')
  const out: string[] = []
  let m
  while ((m = re.exec(s)) !== null) out.push(m[1].trim())
  return out
}

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

export async function fetchAliasesFromTally(): Promise<FetchedAlias[]> {
  const raw = await queryTally(buildStockItemsXML())
  const items = raw.match(/<STOCKITEM\s[^>]*>[\s\S]*?<\/STOCKITEM>/g) || []
  return items.map(block => {
    const tallyStockItem = (block.match(/<STOCKITEM\s[^>]*NAME="([^"]+)"/) || [])[1]?.trim() || ''
    const guid = xml(block, 'GUID')
    const parent = xml(block, 'PARENT') // category-ish (e.g. "Dyes", "Chemicals", "Spare")
    const unit = xml(block, 'BASEUNITS') || 'kg'
    const hsn = xml(block, 'HSNCODE') || xml(block, 'HSN')
    const ratesXml = xmlAll(block, 'GSTRATE')
    const gstRate = ratesXml.length ? parseFloat(ratesXml[0]) : 0

    // Map Tally parent group to our internal category
    const cat = (parent || '').toLowerCase()
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
      gstRate: isNaN(gstRate) ? 0 : gstRate,
      hsn: hsn || null,
      defaultTrackStock: category === 'Chemical' || category === 'Dye',
    }
  }).filter(a => a.tallyStockItem)
}
