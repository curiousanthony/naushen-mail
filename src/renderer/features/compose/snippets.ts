/**
 * Snippets — reusable blocks of content inserted from the `{}` toolbar button or by typing
 * `/<snippet name>` in the slash menu.
 *
 * Local to the machine (Notion Mail's snippets are account-side; nothing in the shared API
 * stores them, and inventing an IPC method would break the contract other branches build
 * against), so they live in `localStorage`. Storage is injectable so the logic is testable
 * and so a private window with blocked site data degrades to an in-memory store instead of
 * throwing.
 */

import type { DocNode } from '@shared/emailhtml'

export interface Snippet {
  id: string
  name: string
  /** TipTap document fragment: the blocks inserted at the cursor. */
  doc: DocNode
  createdAt: number
  updatedAt: number
}

export const SNIPPETS_KEY = 'mailroom.snippets.v1'

export interface SnippetStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** An in-memory fallback for when `localStorage` is unavailable or throws. */
function memoryStorage(): SnippetStorage {
  const map = new Map<string, string>()
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) }
}

let fallback: SnippetStorage | null = null

function defaultStorage(): SnippetStorage {
  try {
    const ls = globalThis.localStorage
    if (ls) {
      // Touch it: Safari/private mode throws on access, not on construction.
      ls.getItem(SNIPPETS_KEY)
      return ls
    }
  } catch { /* fall through */ }
  fallback ??= memoryStorage()
  return fallback
}

export function loadSnippets(storage: SnippetStorage = defaultStorage()): Snippet[] {
  try {
    const raw = storage.getItem(SNIPPETS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isSnippet).sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
}

function isSnippet(v: unknown): v is Snippet {
  const s = v as Snippet | null
  return !!s && typeof s === 'object' && typeof s.id === 'string' && typeof s.name === 'string' && !!s.doc
}

export function saveSnippets(list: Snippet[], storage: SnippetStorage = defaultStorage()): void {
  try { storage.setItem(SNIPPETS_KEY, JSON.stringify(list)) } catch { /* quota / private mode */ }
}

/** Create or replace by name (names are the `/slash` handle, so they must be unique). */
export function upsertSnippet(
  input: { id?: string; name: string; doc: DocNode },
  storage: SnippetStorage = defaultStorage()
): Snippet[] {
  const list = loadSnippets(storage)
  const name = input.name.trim() || 'Untitled snippet'
  const now = Date.now()
  const existing = list.find((s) => s.id === input.id) ?? list.find((s) => eqName(s.name, name))
  const next = existing
    ? list.map((s) => (s.id === existing.id ? { ...s, name, doc: input.doc, updatedAt: now } : s))
    : [...list, { id: `snip-${now}-${Math.random().toString(36).slice(2, 7)}`, name, doc: input.doc, createdAt: now, updatedAt: now }]
  const sorted = next.sort((a, b) => a.name.localeCompare(b.name))
  saveSnippets(sorted, storage)
  return sorted
}

export function deleteSnippet(id: string, storage: SnippetStorage = defaultStorage()): Snippet[] {
  const next = loadSnippets(storage).filter((s) => s.id !== id)
  saveSnippets(next, storage)
  return next
}

const eqName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

/** Snippets matching a slash-menu query, best match first. */
export function findSnippets(list: Snippet[], query: string): Snippet[] {
  const q = query.trim().toLowerCase()
  if (!q) return list
  return list
    .map((s) => ({ s, score: fuzzyScore(s.name.toLowerCase(), q) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.s.name.localeCompare(b.s.name))
    .map((x) => x.s)
}

/**
 * Small subsequence scorer shared by the slash menu: prefix > word start > contiguous >
 * scattered subsequence. Returns 0 when `query` is not a subsequence of `text`.
 */
export function fuzzyScore(text: string, query: string): number {
  if (!query) return 1
  if (text === query) return 1000
  if (text.startsWith(query)) return 800 - text.length
  let score = 0
  let ti = 0
  let lastHit = -2
  for (const ch of query) {
    const hit = text.indexOf(ch, ti)
    if (hit < 0) return 0
    score += hit === lastHit + 1 ? 12 : 4
    if (hit === 0 || text[hit - 1] === ' ' || text[hit - 1] === '-') score += 8
    lastHit = hit
    ti = hit + 1
  }
  return Math.max(1, score - text.length / 10)
}
