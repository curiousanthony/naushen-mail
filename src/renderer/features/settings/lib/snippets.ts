/**
 * Snippets live in localStorage under `mailroom.snippets` as a JSON array of `Snippet`.
 * The compose branch reads the same key (schema documented in the PR). Whenever this module
 * writes, it dispatches `SNIPPETS_EVENT` on `window` so an open composer can refresh.
 */
export interface Snippet {
  id: string
  title: string
  /** Sanitised HTML body. */
  html: string
  /** Optional slash name, stored without the leading "/" (e.g. "sig" for "/sig"). */
  shortcut?: string
}

export const SNIPPETS_KEY = 'mailroom.snippets'
export const SNIPPETS_EVENT = 'mailroom:snippets-changed'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

const defaultStorage = (): StorageLike | null => {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

export function normalizeShortcut(v: string): string {
  return v.trim().replace(/^\/+/, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
}

/** Tolerant parse: drops malformed entries instead of throwing. */
export function parseSnippets(json: string | null): Snippet[] {
  if (!json) return []
  try {
    const data: unknown = JSON.parse(json)
    if (!Array.isArray(data)) return []
    const out: Snippet[] = []
    for (const item of data) {
      if (!item || typeof item !== 'object') continue
      const o = item as Record<string, unknown>
      if (typeof o.id !== 'string' || typeof o.title !== 'string') continue
      const s: Snippet = { id: o.id, title: o.title, html: typeof o.html === 'string' ? o.html : '' }
      if (typeof o.shortcut === 'string' && o.shortcut) s.shortcut = o.shortcut
      out.push(s)
    }
    return out
  } catch { return [] }
}

export function loadSnippets(storage: StorageLike | null = defaultStorage()): Snippet[] {
  try { return parseSnippets(storage?.getItem(SNIPPETS_KEY) ?? null) } catch { return [] }
}

export function saveSnippets(list: Snippet[], storage: StorageLike | null = defaultStorage(), notify = true): boolean {
  try {
    if (!storage) return false
    storage.setItem(SNIPPETS_KEY, JSON.stringify(list))
    if (notify && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(SNIPPETS_EVENT))
    return true
  } catch { return false }
}

/** Is `shortcut` already used by another snippet? */
export function shortcutTaken(list: Snippet[], shortcut: string, exceptId?: string): boolean {
  const s = normalizeShortcut(shortcut)
  return !!s && list.some((x) => x.id !== exceptId && x.shortcut === s)
}

export function upsertSnippet(list: Snippet[], snippet: Snippet): Snippet[] {
  const clean: Snippet = { ...snippet, title: snippet.title.trim() || 'Untitled snippet' }
  const sc = snippet.shortcut ? normalizeShortcut(snippet.shortcut) : ''
  if (sc) clean.shortcut = sc; else delete clean.shortcut
  return list.some((x) => x.id === clean.id) ? list.map((x) => (x.id === clean.id ? clean : x)) : [...list, clean]
}

export const newSnippetId = (): string => `snip-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`

/** Plain-text preview of a snippet body for list rows. */
export function htmlToPreview(html: string, max = 90): string {
  const text = html.replace(/<\s*(br|\/p|\/div|\/li)\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
