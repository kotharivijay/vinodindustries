/**
 * Canonical lot-number normalization.
 *
 * The same logical lot used to get stored with inconsistent casing across
 * tables (e.g. GreyEntry "SAM-23-Super" vs DespatchEntryLot "SAM-23-SUPER"),
 * which broke every case-sensitive cross-table `lotNo` match. Reads are now
 * case-insensitive, and every *write* site funnels lotNo through this helper
 * so new data stays consistent. Canonical form: trimmed + UPPERCASE
 * (matches the pre-existing despatch-sync and RE-PRO-N conventions).
 */
export function normalizeLotNo(lotNo: string): string
export function normalizeLotNo(lotNo: string | null | undefined): string | null
export function normalizeLotNo(lotNo: string | null | undefined): string | null {
  if (lotNo == null) return null
  const v = String(lotNo).trim().toUpperCase()
  return v || null
}
