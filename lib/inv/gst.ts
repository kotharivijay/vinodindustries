/**
 * Decide GST treatment for a purchase invoice given the party + KSI's state.
 *   Unregistered / Composition  → 'NONE'
 *   Regular + same state         → 'CGST_SGST'
 *   Regular + different state    → 'IGST'
 */
export type GstTreatment = 'NONE' | 'CGST_SGST' | 'IGST'

export function decideGstTreatment(party: { gstRegistrationType: string; state: string | null }): GstTreatment {
  if (party.gstRegistrationType === 'Unregistered' || party.gstRegistrationType === 'Composition') {
    return 'NONE'
  }
  const ksiState = (process.env.KSI_STATE || 'Rajasthan').toLowerCase()
  const partyState = (party.state || '').toLowerCase()
  return partyState && partyState === ksiState ? 'CGST_SGST' : 'IGST'
}
