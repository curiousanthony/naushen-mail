/**
 * Frecency of palette picks (commands, people, labels/views): an exponentially-decayed pick
 * count. One number per key, updated in O(1): score' = score * 0.5^(dt / halfLife) + 1.
 * Stored in localStorage as a per-viewer convenience (same as recent.ts).
 */
const KEY = 'mailroom.frecency'
export const HALF_LIFE_MS = 14 * 24 * 3600 * 1000
export const MAX_ENTRIES = 200

export interface FrecencyEntry { score: number; at: number }
export type FrecencyStore = Record<string, FrecencyEntry>

const decay = (dt: number): number => Math.pow(0.5, Math.max(0, dt) / HALF_LIFE_MS)

/** Current decayed score of a key (0 when never picked). */
export function frecencyScore(store: FrecencyStore, key: string, now = Date.now()): number {
  const e = store[key]
  return e ? e.score * decay(now - e.at) : 0
}

/** Rank boost in the same units as filter.ts scores (a token prefix hit is 100). Capped so a
 *  habit can lift a weaker match above a stronger one but never above an exact-prefix win. */
export function frecencyBoost(store: FrecencyStore, key: string, now = Date.now()): number {
  const s = frecencyScore(store, key, now)
  return s <= 0 ? 0 : Math.min(45, Math.log2(1 + s) * 18)
}

/** Record a pick; returns a new store, pruned to the strongest MAX_ENTRIES. */
export function bumpFrecency(store: FrecencyStore, key: string, now = Date.now()): FrecencyStore {
  const next: FrecencyStore = { ...store, [key]: { score: frecencyScore(store, key, now) + 1, at: now } }
  const keys = Object.keys(next)
  if (keys.length <= MAX_ENTRIES) return next
  const keep = keys.sort((a, b) => frecencyScore(next, b, now) - frecencyScore(next, a, now)).slice(0, MAX_ENTRIES)
  return Object.fromEntries(keep.map((k) => [k, next[k]]))
}

export function loadFrecency(): FrecencyStore {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
    const out: FrecencyStore = {}
    for (const [k, e] of Object.entries(v as Record<string, FrecencyEntry>)) {
      if (e && typeof e.score === 'number' && typeof e.at === 'number') out[k] = { score: e.score, at: e.at }
    }
    return out
  } catch { return {} }
}

export function saveFrecency(store: FrecencyStore): void {
  try { localStorage.setItem(KEY, JSON.stringify(store)) } catch { /* private mode etc. */ }
}

/** Load, bump, save. */
export function recordPick(key: string, now = Date.now()): void {
  saveFrecency(bumpFrecency(loadFrecency(), key, now))
}
