const COLORS = [
  'red','blue','green','yellow','white','black','grey','gray','pink',
  'purple','orange','brown','violet','maroon','cream','beige','navy',
  'teal','gold','silver','rose','olive','coral','magenta','cyan',
]

/** Normalize a name: lowercase, collapse spaces, strip quotes/inch-marks */
export function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/["""''`″′]/g, '')   // strip quote / inch marks
    .replace(/\s+/g, ' ')         // collapse spaces
    .trim()
}

/** Strip trailing color words for base comparison */
function stripColors(name: string): string {
  const parts = name.split(' ')
  while (parts.length > 1 && COLORS.includes(parts[parts.length - 1])) {
    parts.pop()
  }
  return parts.join(' ')
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
  return dp[m][n]
}

/** Returns 0–100 similarity score between two names */
export function similarity(a: string, b: string): number {
  const na = stripColors(normalizeName(a))
  const nb = stripColors(normalizeName(b))
  if (na === nb) return 100
  const maxLen = Math.max(na.length, nb.length)
  if (maxLen === 0) return 100
  return Math.round((1 - levenshtein(na, nb) / maxLen) * 100)
}

/** Find similar names from a list, sorted by score descending */
export function findSimilar(
  input: string,
  existing: { id: number; name: string }[],
  threshold = 60
): { id: number; name: string; score: number }[] {
  const normInput = normalizeName(input)
  return existing
    .map(item => ({ ...item, score: similarity(input, item.name) }))
    .filter(item => item.score >= threshold || normalizeName(item.name) === normInput)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
}
