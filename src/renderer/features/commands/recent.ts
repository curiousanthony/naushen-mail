/** Recent searches for the palette (localStorage, per-viewer convenience only). */
const KEY = 'mailroom.recentSearches'
export const MAX_RECENT = 6

export function pushRecent(list: string[], query: string, max = MAX_RECENT): string[] {
  const q = query.trim()
  if (!q) return list
  return [q, ...list.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, max)
}

export function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENT) : []
  } catch { return [] }
}

export function saveRecent(list: string[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_RECENT))) } catch { /* private mode etc. */ }
}

export function clearRecent(): void {
  try { localStorage.removeItem(KEY) } catch { /* ignore */ }
}
