/**
 * Helpers ported from the existing Sales/Receipt push flow.
 * Kept inv-scoped so changes to either module don't ripple.
 */

export function fmtDate(input: string | Date): string {
  const s = typeof input === 'string' ? input.trim() : input.toISOString().slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10).replace(/-/g, '')
  const m = s.match(/^(\d{2})-(\d{2})-(\d{2,4})$/)
  if (m) {
    const dd = m[1], mm = m[2]
    const yy = m[3].length === 2 ? '20' + m[3] : m[3]
    return `${yy}${mm}${dd}`
  }
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

export function neg(n: number): string {
  return `-${n.toFixed(2)}`
}
