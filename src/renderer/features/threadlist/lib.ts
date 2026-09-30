/**
 * Pure list logic: date grouping (filters live in @shared/filters), flattening for windowing, range
 * selection and row text. No React / DOM, so it runs under vitest's node environment.
 */
import type { Label, SystemRole, Thread, View } from '@shared/types'
import { groupLabel, displayName } from '@/lib/format'
import type { Nav } from '@/lib/store'
import { categoryGroups } from '../sidebar/lib'
import type { BundleGroup } from './bundles'

// ---------------------------------------------------------------- grouping

export interface Group { key: string; label: string; threads: Thread[] }

/** Group by date bucket (Today / Yesterday / Previous 7 days / …), preserving list order. */
export function groupThreads(threads: Thread[], byDate: boolean, now = Date.now()): Group[] {
  if (!byDate) return threads.length ? [{ key: 'all', label: '', threads }] : []
  const out: Group[] = []
  for (const t of threads) {
    const label = groupLabel(t.lastMessageAt, now)
    const last = out[out.length - 1]
    if (last && last.label === label) last.threads.push(t)
    else out.push({ key: label, label, threads: [t] })
  }
  return out
}

/**
 * The "Categories" nav: every category's mail in one list, grouped under a header per category
 * (Social / Promotions / Updates / Forums, Gmail's own tab order — see
 * `categoryGroups`), each bucket in the same last-message-first order the query returned. Threads
 * with no non-Primary category label are dropped (Primary is not part of this view).
 * Empty categories are omitted, same as an empty date bucket never rendering a header.
 */
export function groupByCategory(threads: Thread[], labels: Label[], accountId: string): Group[] {
  const rows = categoryGroups(labels, accountId)
  if (!rows.length) return groupThreads(threads, false)
  const remoteIdOf = new Map<string, string>()
  for (const l of labels) if (l.kind === 'category') remoteIdOf.set(l.id, l.remoteId)
  const buckets = new Map<string, Thread[]>()
  for (const t of threads) {
    const remoteId = t.labelIds.map((id) => remoteIdOf.get(id)).find((x): x is string => !!x && x !== 'CATEGORY_PERSONAL')
    if (!remoteId) continue
    const bucket = buckets.get(remoteId)
    if (bucket) bucket.push(t); else buckets.set(remoteId, [t])
  }
  return rows
    .map((g) => ({ key: g.key, label: g.name, threads: buckets.get(g.key) ?? [] }))
    .filter((g) => g.threads.length > 0)
}

// ---------------------------------------------------------------- windowing

export type Item =
  | { kind: 'header'; key: string; label: string; count: number }
  | { kind: 'row'; key: string; thread: Thread; /** A member shown under its expanded bundle. */ child?: boolean }
  | { kind: 'bundle'; key: string; bundle: BundleGroup; expanded: boolean }

export function flatten(groups: Group[]): Item[] {
  const items: Item[] = []
  for (const g of groups) {
    if (g.label) items.push({ kind: 'header', key: `h:${g.key}`, label: g.label, count: g.threads.length })
    for (const t of g.threads) items.push({ kind: 'row', key: t.id, thread: t })
  }
  return items
}

export interface Metrics { rowH: number; headerH: number }

/** Cumulative pixel offsets; `offsets[i]` is the top of item i, `offsets[n]` the total height. */
export function offsetsOf(items: Item[], m: Metrics): number[] {
  const offsets = new Array<number>(items.length + 1)
  let y = 0
  for (let i = 0; i < items.length; i++) { offsets[i] = y; y += items[i].kind === 'header' ? m.headerH : m.rowH }
  offsets[items.length] = y
  return offsets
}

export interface Window {
  start: number
  /** Exclusive. */
  end: number
  padTop: number
  padBottom: number
  /**
   * When the slice starts inside a group, the group's real header is above the window. The list
   * re-emits it here and `padTop` already reserves its height, so sticky headers keep working
   * however far into a group you scroll.
   */
  header: { label: string; count: number } | null
}

/** Render everything below this many items; above it, window the list. */
export const WINDOW_THRESHOLD = 200

/** Visible slice for a scroll position, plus the spacer heights that stand in for the rest. */
export function windowRange(
  items: Item[], offsets: number[], scrollTop: number, viewportH: number, m: Metrics, overscan = 8
): Window {
  const n = items.length
  if (n <= WINDOW_THRESHOLD) return { start: 0, end: n, padTop: 0, padBottom: 0, header: null }
  const top = Math.max(0, scrollTop)
  const bottom = top + Math.max(0, viewportH)
  let start = 0
  while (start < n && offsets[start + 1] <= top) start++
  let end = start
  while (end < n && offsets[end] < bottom) end++
  start = Math.max(0, start - overscan)
  end = Math.min(n, end + overscan)

  let header: Window['header'] = null
  let padTop = offsets[start]
  const first = items[start]
  if (first && first.kind !== 'header') {
    for (let i = start - 1; i >= 0; i--) {
      const it = items[i]
      if (it.kind === 'header') { header = { label: it.label, count: it.count }; padTop = offsets[start] - m.headerH; break }
    }
  }
  return { start, end, padTop, padBottom: offsets[n] - offsets[end], header }
}

/** Scroll offset that brings item `index` fully into view, or null when it already is. */
export function scrollOffsetFor(
  offsets: number[], index: number, itemH: number, scrollTop: number, viewportH: number, pad = 8
): number | null {
  const top = Math.max(0, offsets[index] - pad)
  const bottom = offsets[index] + itemH + pad
  if (top < scrollTop) return top
  if (bottom > scrollTop + viewportH) return bottom - viewportH
  return null
}

// ---------------------------------------------------------------- selection

/** Ids between the anchor row and the target row, inclusive. Falls back to just the target. */
export function rangeIds(threads: Thread[], anchorId: string | null, targetId: string): string[] {
  const to = threads.findIndex((t) => t.id === targetId)
  if (to < 0) return []
  const from = anchorId ? threads.findIndex((t) => t.id === anchorId) : -1
  if (from < 0) return [targetId]
  const [a, b] = from <= to ? [from, to] : [to, from]
  return threads.slice(a, b + 1).map((t) => t.id)
}

/** Union of two id lists, order-preserving. */
export const unionIds = (a: string[], b: string[]): string[] => [...a, ...b.filter((id) => !a.includes(id))]

// ---------------------------------------------------------------- row text

/** "Me", "Léa Martin", "Léa, Marc" or "Léa, Marc +2" — me is always shown as "Me". */
export function senderText(t: Thread, myEmails: Set<string>): string {
  const names = t.participants.map((p) =>
    myEmails.has(p.email.toLowerCase()) ? 'Me' : displayName(p))
  const seen: string[] = []
  for (const n of names) if (!seen.includes(n)) seen.push(n)
  const others = seen.filter((n) => n !== 'Me')
  const list = others.length ? others : seen
  if (list.length <= 2) return list.join(', ')
  return `${list.slice(0, 2).join(', ')} +${list.length - 2}`
}

/** Labels to show as chips on a row (user labels only, at most three). */
export function rowLabels(t: Thread, labels: Label[], max = 3): Label[] {
  return labels.filter((l) => l.kind === 'user' && t.labelIds.includes(l.id)).slice(0, max)
}

// ---------------------------------------------------------------- copy

const ROLE_TITLE: Record<SystemRole, string> = {
  inbox: 'Inbox', sent: 'Sent', drafts: 'Drafts', trash: 'Trash', spam: 'Spam',
  archive: 'Archive', starred: 'Starred', important: 'Important', all: 'All Mail'
}

/** Heading for the list's top bar. */
export function listTitle(nav: Nav, views: View[], labels: Label[]): { emoji?: string; title: string } {
  switch (nav.kind) {
    case 'role': return { title: ROLE_TITLE[nav.role] }
    case 'categories': return { title: 'Categories' }
    case 'snoozed': return { title: 'Reminders' }
    case 'search': return { title: nav.text ? `Search: ${nav.text}` : 'Search' }
    case 'label': return { title: labels.find((l) => l.id === nav.labelId)?.name ?? 'Label' }
    case 'view': {
      const v = views.find((x) => x.id === nav.viewId)
      return { emoji: v?.emoji, title: v?.name ?? 'View' }
    }
  }
}

export interface EmptyCopy { title: string; body: string }

/** Per-view empty state, in Notion's calm sentence-case voice. */
export function emptyCopy(nav: Nav, viewName?: string, filtered = false): EmptyCopy {
  if (filtered) return { title: 'No matches', body: 'No conversations match these filters.' }
  switch (nav.kind) {
    case 'role':
      switch (nav.role) {
        case 'inbox': return { title: "You're all caught up.", body: 'Nothing new in your inbox.' }
        case 'sent': return { title: 'Nothing sent yet', body: 'Messages you send will appear here.' }
        case 'drafts': return { title: 'No drafts', body: 'Start a message and it will be saved here.' }
        case 'trash': return { title: 'Trash is empty', body: 'Deleted conversations land here first.' }
        case 'spam': return { title: 'No spam', body: 'Nothing has been flagged as spam.' }
        case 'starred': return { title: 'No starred conversations', body: 'Star a conversation to find it quickly.' }
        default: return { title: 'No mail here', body: 'This mailbox is empty.' }
      }
    case 'categories': return { title: 'Nothing categorized', body: 'Social, Promotions, Updates and Forums mail will group here as it arrives.' }
    case 'snoozed': return { title: 'No reminders', body: 'Conversations you snooze will come back here.' }
    case 'label': return { title: 'No conversations', body: 'Nothing carries this label yet.' }
    case 'search': return { title: 'No results', body: `Nothing matches “${nav.text}”.` }
    case 'view': return { title: 'Nothing here yet', body: `No conversations match ${viewName ?? 'this view'}.` }
  }
}
