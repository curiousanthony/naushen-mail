/**
 * Pure ranking for the universal jump bar: which result group leads, and how frecency blends
 * with the text match. No React, no store; unit-tested (tests/renderer/jump.test.ts).
 */
import { scoreMatch } from './filter'
import { frecencyBoost, type FrecencyStore } from './frecency'

export type JumpGroup = 'Actions' | 'Navigate' | 'Commands' | 'People' | 'Threads'

/** Tie-break order when groups' best scores are equal. */
export const JUMP_ORDER: JumpGroup[] = ['Actions', 'Navigate', 'Commands', 'People', 'Threads']

/** Text match score plus habit boost; 0 (no match) never gets a boost. */
export function blendScore(
  query: string, label: string, keywords: string[] | undefined, frecencyKey: string | undefined, store: FrecencyStore, now = Date.now()
): number {
  const s = scoreMatch(query, label, keywords)
  if (s <= 0) return 0
  return s + (frecencyKey ? frecencyBoost(store, frecencyKey, now) : 0)
}

/**
 * Order groups for display. Contextual Actions always lead (they act on what you are looking
 * at). The rest sort by their best item's score, ties by JUMP_ORDER. Threads carry a fixed
 * modest score (they are FTS hits with no label to prefix-match) so an exact command or
 * person outranks them but they beat weak fuzzy command matches.
 */
export function orderGroups<T extends { group: JumpGroup; best: number }>(groups: T[]): T[] {
  return [...groups].sort((a, b) => {
    if (a.group === 'Actions' || b.group === 'Actions') return a.group === 'Actions' ? -1 : 1
    return b.best - a.best || JUMP_ORDER.indexOf(a.group) - JUMP_ORDER.indexOf(b.group)
  })
}

/** Score given to thread (FTS) hits when ordering groups. */
export const THREAD_GROUP_SCORE = 60

/** Sort scored items best-first, stable for ties. */
export function rankScored<T>(items: { item: T; score: number }[]): T[] {
  return items
    .map((x, i) => ({ ...x, i }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.item)
}

/** Looks like an address the user is typing (offer "Write to …" when nobody matches). */
export const looksLikeEmail = (s: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim())
