/**
 * Pure helpers for the sidebar. No React, no DOM beyond localStorage (guarded), so this
 * module is unit-testable under vitest's node environment.
 */
import type { Counts, Label, LabelColor, SystemRole, View } from '@shared/types'
import type { Nav } from '@/lib/store'
import i18n, { currentLocale } from '@/i18n'
import { roleName } from '@/lib/labels'

/**
 * Unread badge for a sidebar key.
 *
 * `Repo.counts()` keys the map as `${accountId|'all'}:${role|labelId}` and label ids already
 * embed their account (`acct:remote`), so the same lookup serves roles and labels:
 *   unreadFor(counts, 'all', 'inbox')        -> all:inbox
 *   unreadFor(counts, 'a', 'a:L_Travel')     -> a:a:L_Travel
 * Roles that no label carries (notably 'all' / 'archive') are never bumped and return 0.
 */
export function unreadFor(counts: Counts, accountId: string, key: string): number {
  return counts.unread[`${accountId}:${key}`] ?? 0
}

/** Sidebar badge text: '99+' cap (default) or the exact number. Zero/negative => '' (no badge). */
export function formatCount(n: number, mode: 'cap' | 'exact' = 'cap'): string {
  if (!(n > 0)) return ''
  return mode === 'cap' && n > 99 ? '99+' : String(Math.floor(n))
}

export interface MailItem {
  id: string
  name: string
  /** Undefined for the local-only Reminders (snoozed) entry. */
  role?: SystemRole
  snoozed?: boolean
}

/**
 * The "Mail" section, in Notion Mail's order. "All Mail" uses role 'all', which the repo
 * treats as "everything except trash/spam" — i.e. inbox + archived.
 */
// `name` is a getter so the label is resolved at render time and follows the UI language.
export const MAIL_ITEMS: MailItem[] = [
  { id: 'all', get name() { return i18n.t('common:role.all') }, role: 'all' },
  { id: 'starred', get name() { return i18n.t('common:role.starred') }, role: 'starred' },
  { id: 'sent', get name() { return i18n.t('common:role.sent') }, role: 'sent' },
  { id: 'drafts', get name() { return i18n.t('common:role.drafts') }, role: 'drafts' },
  { id: 'snoozed', get name() { return i18n.t('common:role.reminders') }, snoozed: true },
  { id: 'spam', get name() { return i18n.t('common:role.spam') }, role: 'spam' },
  { id: 'trash', get name() { return i18n.t('common:role.trash') }, role: 'trash' }
]

export const mailNav = (m: MailItem): Nav =>
  m.snoozed ? { kind: 'snoozed' } : { kind: 'role', role: m.role ?? 'all' }

/** User labels shown in the "Labels" section, per account (never merged across accounts). */
export function sidebarLabels(labels: Label[], accountId: string): Label[] {
  return labels
    .filter((l) => l.kind === 'user' && (accountId === 'all' || l.accountId === accountId))
    .sort((a, b) => a.name.localeCompare(b.name, currentLocale()) || a.accountId.localeCompare(b.accountId))
}

/** One sidebar row: a label, or (All accounts) every account's label of the same name. */
export interface LabelGroup {
  /** Stable key: lower-cased name when merged, the label id otherwise. */
  key: string
  name: string
  color?: LabelColor
  /** Underlying label ids; the first is what navigation stores. */
  ids: string[]
  accountIds: string[]
}

/**
 * Labels for the sidebar. Viewing "All accounts", same-named labels (case-insensitive) collapse
 * into one row so "Newsletters" is not listed once per account; with a single account selected
 * every label stays its own row.
 */
export function mergedLabels(labels: Label[], accountId: string): LabelGroup[] {
  const own = sidebarLabels(labels, accountId)
  if (accountId !== 'all') {
    return own.map((l) => ({ key: l.id, name: l.name, color: l.color, ids: [l.id], accountIds: [l.accountId] }))
  }
  const groups = new Map<string, LabelGroup>()
  const votes = new Map<string, Map<string, number>>()
  for (const l of own) {
    const key = l.name.trim().toLowerCase()
    const g = groups.get(key)
    const spelling = l.name.trim()
    const v = votes.get(key) ?? new Map<string, number>()
    v.set(spelling, (v.get(spelling) ?? 0) + 1)
    votes.set(key, v)
    if (!g) groups.set(key, { key, name: spelling, color: l.color, ids: [l.id], accountIds: [l.accountId] })
    else {
      g.ids.push(l.id)
      if (!g.accountIds.includes(l.accountId)) g.accountIds.push(l.accountId)
      g.color ??= l.color
    }
  }
  // Display the spelling most accounts use ("Receipts" over "receipts"); a tie keeps the first seen.
  for (const [key, g] of groups) {
    let best = g.name
    for (const [spelling, n] of votes.get(key)!) if (n > (votes.get(key)!.get(best) ?? 0)) best = spelling
    g.name = best
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, currentLocale()))
}

/** Combined unread count of a merged row. A thread lives in one account, so nothing double counts. */
export const unreadForGroup = (counts: Counts, accountId: string, g: LabelGroup): number =>
  g.ids.reduce((n, id) => n + unreadFor(counts, accountId, id), 0)

// ---------------------------------------------------------------- categories (Gmail only)

/** Gmail's inbox-tab category names in Gmail's own tab order. Mirrors main/providers/gmail/labels.ts. */
/** Primary (CATEGORY_PERSONAL) is deliberately absent: it is the plain Inbox, never a Categories row. */
export const CATEGORY_ORDER = ['CATEGORY_SOCIAL', 'CATEGORY_PROMOTIONS', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS']

/** Gmail's category names are fixed provider strings, so they are localised by `remoteId` rather than shown as stored. */
function categoryName(remoteId: string, stored: string): string {
  switch (remoteId) {
    case 'CATEGORY_SOCIAL': return i18n.t('common:category.social')
    case 'CATEGORY_PROMOTIONS': return i18n.t('common:category.promotions')
    case 'CATEGORY_UPDATES': return i18n.t('common:category.updates')
    case 'CATEGORY_FORUMS': return i18n.t('common:category.forums')
    default: return stored
  }
}

/**
 * Category labels for the sidebar's "Categories" section, one row per distinct category
 * (grouped by `remoteId`, not name — the friendly name is fixed, not user text), in Gmail's tab
 * order. Only ever populated from Gmail-synced mail (Outlook never emits `kind: 'category'`
 * labels), so an empty result here is exactly how the section knows to hide itself.
 */
export function categoryGroups(labels: Label[], accountId: string): LabelGroup[] {
  const own = labels.filter((l) => l.kind === 'category' && (accountId === 'all' || l.accountId === accountId))
  const groups = new Map<string, LabelGroup>()
  for (const l of own) {
    const g = groups.get(l.remoteId)
    if (!g) groups.set(l.remoteId, { key: l.remoteId, name: categoryName(l.remoteId, l.name), color: l.color, ids: [l.id], accountIds: [l.accountId] })
    else {
      g.ids.push(l.id)
      if (!g.accountIds.includes(l.accountId)) g.accountIds.push(l.accountId)
    }
  }
  return CATEGORY_ORDER.map((remoteId) => groups.get(remoteId)).filter((g): g is LabelGroup => !!g)
}

/**
 * Label names carried by more than one account. Viewing "All accounts" lists each account's
 * label separately (threads are never merged across accounts), so these rows need the owning
 * account spelled out to tell two identically-named labels apart.
 */
export function ambiguousLabelNames(labels: Label[]): Set<string> {
  const byName = new Map<string, Set<string>>()
  for (const l of labels) {
    if (l.kind !== 'user') continue
    const accounts = byName.get(l.name) ?? new Set<string>()
    accounts.add(l.accountId)
    byName.set(l.name, accounts)
  }
  const out = new Set<string>()
  for (const [name, accounts] of byName) if (accounts.size > 1) out.add(name)
  return out
}

/** Views shown in the sidebar, in saved order. */
export function sidebarViews(views: View[]): View[] {
  return views.filter((v) => v.showInSidebar !== false).slice().sort((a, b) => a.position - b.position)
}

/** True when `nav` is the thing this row points at. */
export function navEquals(a: Nav, b: Nav): boolean {
  if (a.kind !== b.kind) return false
  switch (a.kind) {
    case 'role': return a.role === (b as { role: SystemRole }).role
    case 'view': return a.viewId === (b as { viewId: string }).viewId
    case 'label': return a.labelId === (b as { labelId: string }).labelId
    default: return true
  }
}

// ---------------------------------------------------------------- section collapse

const COLLAPSE_KEY = 'mailroom.sidebar.sections'

/** Collapsed-section map, persisted per machine. Never throws (private mode, denied storage). */
export function loadCollapsed(): Record<string, boolean> {
  try {
    const raw = globalThis.localStorage?.getItem(COLLAPSE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, boolean> = {}
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) if (typeof v === 'boolean') out[k] = v
      return out
    }
  } catch { /* storage unavailable */ }
  return {}
}

export function saveCollapsed(state: Record<string, boolean>): void {
  try { globalThis.localStorage?.setItem(COLLAPSE_KEY, JSON.stringify(state)) } catch { /* ignore */ }
}

// ---------------------------------------------------------------- view editor

/** Short human description of a saved view's filter, for the editor and row tooltips. */
export function filterSummary(v: View, labels: Label[]): string {
  const f = v.filter
  const parts: string[] = []
  const t = i18n.getFixedT(null, 'sidebar')
  if (f.role) parts.push(f.role === 'all' ? t('summary.allMail') : roleName(f.role))
  if (f.unread) parts.push(t('summary.unread'))
  if (f.hasAttachment) parts.push(t('summary.hasAttachment'))
  for (const id of f.labelIds ?? []) parts.push(labels.find((l) => l.id === id)?.name ?? t('summary.label'))
  for (const s of f.from ?? []) parts.push(t('summary.from', { value: s }))
  for (const s of f.subjectContains ?? []) parts.push(t('summary.subject', { value: s }))
  return parts.join(' · ') || t('summary.noFilters')
}

/** Text used in the sidebar for an account's display name. */
export const accountLabel = (name: string, email: string): string => name.trim() || email.split('@')[0]

const localPart = (email: string): string => email.split('@')[0]
const domainPart = (email: string): string => email.split('@')[1]?.split('.')[0] ?? email

/**
 * The shortest tag that still tells these accounts apart, keyed by account id. One person's
 * two mailboxes usually share a display name and often a local part ("anthony@gmail",
 * "anthony@acme"), so fall through local part -> domain -> full address.
 */
export function accountTags(accounts: { id: string; email: string }[]): Record<string, string> {
  const distinct = (f: (e: string) => string): boolean =>
    new Set(accounts.map((a) => f(a.email))).size === accounts.length
  const pick = distinct(localPart) ? localPart : distinct(domainPart) ? domainPart : (e: string) => e
  return Object.fromEntries(accounts.map((a) => [a.id, pick(a.email)]))
}
