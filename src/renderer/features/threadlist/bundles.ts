/**
 * Inbox bundles: optional, opt-in grouping of low-value automated mail (a label or a sender)
 * into ONE row per bundle. Pure logic only — the row itself is Bundle.tsx.
 *
 * A bundle is placed by its newest member's date, so it sits exactly where its freshest message
 * would have. Expanded, its members become ordinary rows right under it (uniform row height, so
 * the list's windowing maths keeps working).
 */
import type { Label, Thread } from '@shared/types'
import { displayName, groupLabel } from '@/lib/format'
import i18n from '@/i18n'
import type { Item } from './lib'

export interface BundleDef {
  /** `${kind}:${match}` — stable, so the same choice made twice is the same bundle. */
  id: string
  kind: 'label' | 'sender'
  /** Lower-cased label name, or a lower-cased sender address / domain. */
  match: string
  /** Display name ("Newsletters", "Acme"). */
  name: string
}

export const bundleId = (kind: BundleDef['kind'], match: string): string => `${kind}:${match.trim().toLowerCase()}`

export interface BundleGroup {
  def: BundleDef
  /** Members, newest first. */
  threads: Thread[]
  unread: number
  /** Date of the newest member — where the bundle sits in the list. */
  newest: number
  /** Distinct sender names, unread senders first, then by recency. */
  senders: string[]
}

export type Entry =
  | { kind: 'thread'; thread: Thread }
  | { kind: 'bundle'; bundle: BundleGroup }

/** The person a row is "from": the first participant who is not you. */
export function leadSender(t: Thread, myEmails: Set<string>): { name: string; email: string } | null {
  const p = t.participants.find((x) => x.email && !myEmails.has(x.email.toLowerCase()))
  return p ? { name: displayName(p), email: p.email.toLowerCase() } : null
}

const senderMatches = (match: string, email: string): boolean =>
  email === match || (!match.includes('@') && (email.endsWith(`@${match}`) || email.endsWith(`.${match}`)))

/** Which bundle (if any) claims this thread. First definition wins. Starred mail is never bundled. */
export function assignBundle(t: Thread, defs: BundleDef[], labels: Label[], myEmails: Set<string>): BundleDef | null {
  if (t.starred || !defs.length) return null
  const names = new Set(labels.filter((l) => l.kind === 'user' && t.labelIds.includes(l.id)).map((l) => l.name.trim().toLowerCase()))
  for (const d of defs) {
    if (d.kind === 'label') {
      if (names.has(d.match)) return d
    } else if (t.participants.some((p) => p.email && !myEmails.has(p.email.toLowerCase()) && senderMatches(d.match, p.email.toLowerCase()))) {
      return d
    }
  }
  return null
}

/**
 * Collapse `threads` (newest first) into entries. Order is preserved: a bundle takes the slot of
 * its first (= newest) member.
 */
export function buildEntries(threads: Thread[], defs: BundleDef[], labels: Label[], myEmails: Set<string>): Entry[] {
  if (!defs.length) return threads.map((thread) => ({ kind: 'thread', thread }))
  const groups = new Map<string, BundleGroup>()
  const out: Entry[] = []
  for (const t of threads) {
    const def = assignBundle(t, defs, labels, myEmails)
    if (!def) { out.push({ kind: 'thread', thread: t }); continue }
    let g = groups.get(def.id)
    if (!g) {
      g = { def, threads: [], unread: 0, newest: t.lastMessageAt, senders: [] }
      groups.set(def.id, g)
      out.push({ kind: 'bundle', bundle: g })
    }
    g.threads.push(t)
    if (t.unread) g.unread++
  }
  for (const g of groups.values()) g.senders = senderSummary(g.threads, myEmails)
  return out
}

/** Distinct sender names for the one-line summary: unread first, then newest. */
export function senderSummary(threads: Thread[], myEmails: Set<string>): string[] {
  const seen = new Set<string>()
  const ordered = [...threads.filter((t) => t.unread), ...threads.filter((t) => !t.unread)]
  const out: string[] = []
  for (const t of ordered) {
    const s = leadSender(t, myEmails)
    if (!s || seen.has(s.email)) continue
    seen.add(s.email)
    out.push(s.name)
  }
  return out
}

/** "7 new" when anything is unread, else "7 conversations". */
export const bundleCount = (b: BundleGroup): string =>
  b.unread > 0
    ? i18n.t('threadlist:bundle.newCount', { count: b.unread })
    : i18n.t('threadlist:bundle.conversationCount', { count: b.threads.length })

/** Flat list items (headers, rows, bundle rows) for the windowed list. */
export function buildItems(
  entries: Entry[], byDate: boolean, expanded: Record<string, boolean>, now = Date.now()
): Item[] {
  const items: Item[] = []
  const emit = (e: Entry): void => {
    if (e.kind === 'thread') { items.push({ kind: 'row', key: e.thread.id, thread: e.thread }); return }
    const open = !!expanded[e.bundle.def.id]
    items.push({ kind: 'bundle', key: `b:${e.bundle.def.id}`, bundle: e.bundle, expanded: open })
    if (open) for (const t of e.bundle.threads) items.push({ kind: 'row', key: t.id, thread: t, child: true })
  }
  if (!byDate) { entries.forEach(emit); return items }

  let label: string | null = null
  let start = -1
  let count = 0
  const close = (): void => {
    const h = start >= 0 ? items[start] : null
    if (h && h.kind === 'header') h.count = count
  }
  for (const e of entries) {
    const at = e.kind === 'thread' ? e.thread.lastMessageAt : e.bundle.newest
    const l = groupLabel(at, now)
    if (l !== label) {
      close()
      label = l; count = 0; start = items.length
      items.push({ kind: 'header', key: `h:${l}`, label: l, count: 0 })
    }
    count++
    emit(e)
  }
  close()
  return items
}

/**
 * What keyboard navigation and bulk actions need to know about the current bundles:
 * - `order`: the stops for j/k — one per collapsed bundle (its newest member), every row otherwise
 * - `collapsed`: member id -> all members, for actions on a collapsed bundle (`e` archives it all)
 * - `keyOf`: member id -> bundle id (collapsed or not), so Esc can fold the bundle you are in
 */
export interface BundleNavState {
  order: string[]
  collapsed: Map<string, string[]>
  rep: Map<string, string>
  keyOf: Map<string, string>
}

export function navStateOf(items: Item[]): BundleNavState {
  const order: string[] = []
  const collapsed = new Map<string, string[]>()
  const rep = new Map<string, string>()
  const keyOf = new Map<string, string>()
  for (const it of items) {
    if (it.kind === 'row') {
      order.push(it.thread.id)
    } else if (it.kind === 'bundle') {
      const ids = it.bundle.threads.map((t) => t.id)
      for (const id of ids) keyOf.set(id, it.bundle.def.id)
      if (!it.expanded) {
        order.push(ids[0])
        for (const id of ids) { collapsed.set(id, ids); rep.set(id, ids[0]) }
      }
    }
  }
  return { order, collapsed, rep, keyOf }
}
