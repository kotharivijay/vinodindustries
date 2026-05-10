// Outstanding due-days bucketing — drives the dot colour and the
// invoice-wise filter pills.

export type DueBucket = 'fresh' | 'soft' | 'mid' | 'hard'

export const DUE_BUCKETS: { id: DueBucket; min: number; max: number; label: string; color: string }[] = [
  { id: 'fresh', min: 0,  max: 14,  label: '< 15 d',  color: '🟢' },
  { id: 'soft',  min: 15, max: 29,  label: '15–30 d', color: '🟡' },
  { id: 'mid',   min: 30, max: 59,  label: '30–60 d', color: '🟠' },
  { id: 'hard',  min: 60, max: Infinity, label: '60+ d',  color: '🔴' },
]

export function bucketFor(days: number): DueBucket {
  if (days >= 60) return 'hard'
  if (days >= 30) return 'mid'
  if (days >= 15) return 'soft'
  return 'fresh'
}

export function dueDaysFrom(dateIso: string | Date, todayMs?: number): number {
  const t = todayMs ?? Date.now()
  const d = typeof dateIso === 'string' ? new Date(dateIso).getTime() : dateIso.getTime()
  return Math.max(0, Math.floor((t - d) / (1000 * 60 * 60 * 24)))
}
