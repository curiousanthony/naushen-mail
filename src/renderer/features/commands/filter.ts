/** Small fuzzy filter shared by the palette, the shortcut sheet and the label picker. */

const norm = (s: string): string => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')

function subsequence(q: string, t: string): boolean {
  let i = 0
  for (let j = 0; j < t.length && i < q.length; j++) if (t[j] === q[i]) i++
  return i === q.length
}

/** Score of one query token against one string; 0 = no match. */
function tokenScore(token: string, text: string): number {
  if (text.startsWith(token)) return 100
  const words = text.split(/[^a-z0-9]+/)
  if (words.some((w) => w.startsWith(token))) return 80
  if (text.includes(token)) return 50
  if (token.length >= 3 && subsequence(token, text)) return 20
  return 0
}

/**
 * Every whitespace-separated token must match the label (or, weaker, a keyword).
 * Returns 0 when the item does not match. Empty query matches everything with score 1.
 */
export function scoreMatch(query: string, label: string, keywords: string[] = []): number {
  const q = norm(query).trim()
  if (!q) return 1
  const l = norm(label)
  const kw = keywords.map(norm)
  let total = 0
  for (const token of q.split(/\s+/)) {
    let best = tokenScore(token, l)
    for (const k of kw) best = Math.max(best, Math.floor(tokenScore(token, k) * 0.6))
    if (best === 0) return 0
    total += best
  }
  return total
}

/** Filter + rank (stable for equal scores). */
export function filterRank<T>(items: T[], query: string, get: (t: T) => { label: string; keywords?: string[] }): T[] {
  if (!query.trim()) return items
  return items
    .map((item, i) => { const g = get(item); return { item, i, s: scoreMatch(query, g.label, g.keywords) } })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.item)
}
