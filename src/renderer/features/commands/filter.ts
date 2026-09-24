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

/**
 * Split `text` into runs, marking the parts that matched a query token (case/diacritic
 * insensitive; each token's word-start occurrence preferred; overlaps merged). Used for match
 * highlighting. When normalisation changes the string length the indices would not map, so
 * the text is returned unhighlighted.
 */
export function highlightSegments(text: string, query: string): { text: string; hit: boolean }[] {
  const tokens = norm(query).split(/\s+/).filter(Boolean)
  if (!tokens.length || !text) return [{ text, hit: false }]
  const lower = norm(text)
  if (lower.length !== text.length) return [{ text, hit: false }]
  const spans: [number, number][] = []
  for (const t of tokens) {
    const m = new RegExp(`(^|[^a-z0-9])(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`).exec(lower)
    const at = m ? m.index + m[1].length : lower.indexOf(t)
    if (at >= 0) spans.push([at, at + t.length])
  }
  if (!spans.length) return [{ text, hit: false }]
  spans.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const s of spans) {
    const last = merged[merged.length - 1]
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1])
    else merged.push([s[0], s[1]])
  }
  const out: { text: string; hit: boolean }[] = []
  let pos = 0
  for (const [a, b] of merged) {
    if (a > pos) out.push({ text: text.slice(pos, a), hit: false })
    out.push({ text: text.slice(a, b), hit: true })
    pos = b
  }
  if (pos < text.length) out.push({ text: text.slice(pos), hit: false })
  return out
}
