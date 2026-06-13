// Helpers shared by /api/payroll/staff routes — keep validation + status
// derivation in one place so POST and PATCH stay in sync.

export type StaffStatus = 'ACTIVE' | 'INACTIVE' | 'DELETED'

// Age in years (with day-level precision via integer day diff / 365.25).
// Returns null if dob can't be parsed.
export function ageInYears(dob: string | Date | null | undefined): number | null {
  if (!dob) return null
  const d = dob instanceof Date ? dob : new Date(dob)
  if (isNaN(d.getTime())) return null
  const diffMs = Date.now() - d.getTime()
  if (diffMs < 0) return null
  return diffMs / (1000 * 60 * 60 * 24 * 365.25)
}

// Normalise an Aadhar input to 12 digits, or return null/error.
// Accepts "1234 5678 9012", "1234-5678-9012", "123456789012", etc.
export function normaliseAadhar(raw: unknown): string | null {
  if (raw == null || raw === '') return null
  const digits = String(raw).replace(/\D/g, '')
  if (digits.length === 0) return null
  if (digits.length !== 12) throw new Error('Aadhar must be exactly 12 digits')
  return digits
}

export function normaliseStatus(raw: unknown): StaffStatus {
  const s = String(raw || 'ACTIVE').toUpperCase()
  if (s === 'INACTIVE') return 'INACTIVE'
  if (s === 'DELETED') return 'DELETED'
  return 'ACTIVE'
}

// status='ACTIVE' → isActive=true; everything else → isActive=false.
export function isActiveFromStatus(status: StaffStatus): boolean {
  return status === 'ACTIVE'
}

// Throws if dob is set and the person would be < 18 today.
export function assertAge18(dob: string | Date | null | undefined) {
  if (!dob) return
  const age = ageInYears(dob)
  if (age == null) throw new Error('Invalid date of birth')
  if (age < 18) throw new Error(`Staff must be 18 or older (computed age ${age.toFixed(1)} years)`)
}
