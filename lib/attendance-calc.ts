// Pure attendance math for an uploaded punch sheet. No imports so it can be
// unit-checked from a plain Node script.
//
// Punch semantics follow the Petpooja convention the old API path used
// (lib/petpooja.ts): punches alternate IN/OUT by position, so an odd count
// means one punch is missing — flagged, never "corrected".

export const FULL_DAY_MIN = 8 * 60   // >= 8h  → FD
export const HALF_DAY_MIN = 4 * 60   // >= 4h  → HD, below → ABSENT

export type Punch = { time: string; kind: 'IN' | 'OUT' }
export type DayStatus = 'FD' | 'HD' | 'ABSENT'

export function toMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm.trim())
  if (!m) return NaN
  return Number(m[1]) * 60 + Number(m[2])
}

/** 525 → "8:45", 0 → "0:00" */
export function fmtHM(min: number): string {
  const m = Math.max(0, Math.round(min))
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
}

export function pairPunches(times: string[]): { punches: Punch[]; problem: boolean } {
  return {
    punches: times.map((time, i) => ({ time, kind: i % 2 === 0 ? 'IN' : 'OUT' })),
    problem: times.length % 2 === 1,
  }
}

export function computeDay(times: string[]): {
  workingHrs: string; breakHrs: string; status: DayStatus
  workedMin: number; breakMin: number; problem: boolean
} {
  const problem = times.length % 2 === 1
  if (times.length === 0) return { workingHrs: '-', breakHrs: '-', status: 'ABSENT', workedMin: 0, breakMin: 0, problem }

  let worked = 0, brk = 0, prevOut: number | null = null
  for (let i = 0; i + 1 < times.length; i += 2) {
    const inMin = toMinutes(times[i])
    let outMin = toMinutes(times[i + 1])
    if (Number.isNaN(inMin) || Number.isNaN(outMin)) continue
    if (outMin < inMin) outMin += 24 * 60          // crossed midnight
    worked += outMin - inMin
    if (prevOut != null && inMin > prevOut) brk += inMin - prevOut
    prevOut = outMin
  }
  // A lone trailing IN (odd count) contributes nothing — we don't know when
  // they left. It still shows as a punch and carries the problem flag.
  const status: DayStatus = worked >= FULL_DAY_MIN ? 'FD' : worked >= HALF_DAY_MIN ? 'HD' : 'ABSENT'
  return {
    workingHrs: worked > 0 ? fmtHM(worked) : '-',
    breakHrs: worked > 0 ? fmtHM(brk) : '-',
    status, workedMin: worked, breakMin: brk, problem,
  }
}
