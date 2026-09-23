/**
 * Gmail/Notion-Mail-style search operators (`from:`, `to:`, `subject:`, `has:attachment`,
 * `is:unread`, `is:starred`, `label:`, `before:`, `after:`) layered on top of the existing
 * free-text FTS search. Pure and framework-free so it's unit-testable; `navToFilter` (lib/store.ts)
 * is the only caller.
 *
 * `ThreadFilter` already supports every one of these fields server-side (repo.ts `buildWhere`) --
 * this only has to turn a typed string into that shape. Anything not recognised as an operator
 * falls through to free text, so a query like `budget from:priya has:attachment` mixes both.
 */
import type { Label, ThreadFilter } from '@shared/types'

export interface ParsedQuery {
  filter: Pick<ThreadFilter, 'from' | 'to' | 'subjectContains' | 'hasAttachment' | 'unread' | 'starred' | 'labelIds' | 'before' | 'after'>
  /** Remaining free text, handed to FTS as `ThreadFilter.text`. */
  text: string
}

/** One `key:value` or `key:"quoted value"` token, or a bare free-text word. */
const TOKEN_RE = /([a-z]+):"([^"]*)"|([a-z]+):(\S+)|(\S+)/gi

/** `YYYY-MM-DD` (what a person types) parsed as local midnight; anything else is not a date. */
function parseOpDate(raw: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d.getTime()
}

export function parseSearchQuery(raw: string, labels: Label[]): ParsedQuery {
  const from: string[] = []
  const to: string[] = []
  const subjectContains: string[] = []
  const labelIds: string[] = []
  let hasAttachment: boolean | undefined
  let unread: boolean | undefined
  let starred: boolean | undefined
  let before: number | undefined
  let after: number | undefined
  const text: string[] = []

  const byName = (name: string): Label | undefined => {
    const q = name.toLowerCase()
    return labels.find((l) => l.kind === 'user' && l.name.toLowerCase() === q)
      ?? labels.find((l) => l.kind === 'user' && l.name.toLowerCase().includes(q))
  }

  for (const m of raw.matchAll(TOKEN_RE)) {
    const key = (m[1] ?? m[3])?.toLowerCase()
    const value = m[1] !== undefined ? m[2] : m[3] !== undefined ? m[4] : undefined
    const bare = m[5]

    if (key !== undefined && value !== undefined) {
      switch (key) {
        case 'from': if (value) from.push(value); continue
        case 'to': if (value) to.push(value); continue
        case 'subject': if (value) subjectContains.push(value); continue
        case 'label': { const l = byName(value); if (l) { labelIds.push(l.id); continue } break }
        case 'has': if (/^attachments?$/i.test(value)) { hasAttachment = true; continue } break
        case 'is':
          if (/^unread$/i.test(value)) { unread = true; continue }
          if (/^read$/i.test(value)) { unread = false; continue }
          if (/^starred$/i.test(value)) { starred = true; continue }
          break
        case 'before': { const d = parseOpDate(value); if (d !== null) { before = d; continue } break }
        case 'after': { const d = parseOpDate(value); if (d !== null) { after = d; continue } break }
        default: break
      }
      // Recognised-looking but not usable (e.g. `label:doesnotexist`, `before:not-a-date`):
      // don't silently drop it -- keep it as literal text so the user can see what they typed.
      text.push(`${key}:${/\s/.test(value) ? `"${value}"` : value}`)
      continue
    }
    if (bare) text.push(bare)
  }

  return {
    filter: {
      ...(from.length ? { from } : {}),
      ...(to.length ? { to } : {}),
      ...(subjectContains.length ? { subjectContains } : {}),
      ...(labelIds.length ? { labelIds } : {}),
      ...(hasAttachment !== undefined ? { hasAttachment } : {}),
      ...(unread !== undefined ? { unread } : {}),
      ...(starred !== undefined ? { starred } : {}),
      ...(before !== undefined ? { before } : {}),
      ...(after !== undefined ? { after } : {})
    },
    text: text.join(' ')
  }
}

/**
 * Whether the text the user is *currently typing* (the last whitespace-delimited token) is a
 * `from:`/`to:` value in progress, e.g. `budget from:pri` -> `{ key: 'from', prefix: 'pri' }`.
 * Used to drive a contact-suggestion dropdown under the search box, the same idea as the
 * recipient autocomplete in the composer (`RecipientField`) but for the query string instead of
 * a chip list. Only fires at the very end of the string -- mid-string editing doesn't get
 * suggestions, matching how the operator cheat-sheet also only ever appends at the end.
 */
export function activeContactPrefix(q: string): { key: 'from' | 'to'; prefix: string } | null {
  const m = /(?:^|\s)(from|to):(\S*)$/i.exec(q)
  if (!m) return null
  return { key: m[1].toLowerCase() as 'from' | 'to', prefix: m[2] }
}

/** Replace the in-progress `from:`/`to:` token at the end of `q` with a resolved address. */
export function applyContactSuggestion(q: string, key: 'from' | 'to', email: string): string {
  return q.replace(/(?:^|\s)(from|to):(\S*)$/i, (whole, _k, _p, offset: number) =>
    `${offset > 0 ? ' ' : ''}${key}:${email} `)
}

/** Shown as a cheat-sheet under the search box while it's focused and empty. */
export const SEARCH_OPERATOR_HELP: { op: string; hint: string }[] = [
  { op: 'from:', hint: 'sender name or address' },
  { op: 'to:', hint: 'recipient name or address' },
  { op: 'subject:', hint: 'words in the subject' },
  { op: 'label:', hint: 'label name' },
  { op: 'has:attachment', hint: 'has a file attached' },
  { op: 'is:unread', hint: 'unread only' },
  { op: 'is:starred', hint: 'starred only' },
  { op: 'before:', hint: 'YYYY-MM-DD' },
  { op: 'after:', hint: 'YYYY-MM-DD' }
]
