/**
 * Pure helpers for the sidebar. No React, no DOM beyond localStorage (guarded), so this
 * module is unit-testable under vitest's node environment.
 */
import type { Counts, Label, SystemRole, View } from '@shared/types'
import type { Nav } from '@/lib/store'

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
export const MAIL_ITEMS: MailItem[] = [
  { id: 'all', name: 'All Mail', role: 'all' },
  { id: 'sent', name: 'Sent', role: 'sent' },
  { id: 'drafts', name: 'Drafts', role: 'drafts' },
  { id: 'snoozed', name: 'Reminders', snoozed: true },
  { id: 'trash', name: 'Trash', role: 'trash' },
  { id: 'spam', name: 'Spam', role: 'spam' }
]

export const mailNav = (m: MailItem): Nav =>
  m.snoozed ? { kind: 'snoozed' } : { kind: 'role', role: m.role ?? 'all' }

/** User labels shown in the "Labels" section, per account (never merged across accounts). */
export function sidebarLabels(labels: Label[], accountId: string): Label[] {
  return labels
    .filter((l) => l.kind === 'user' && (accountId === 'all' || l.accountId === accountId))
    .sort((a, b) => a.name.localeCompare(b.name) || a.accountId.localeCompare(b.accountId))
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
  if (f.role) parts.push(f.role === 'all' ? 'All mail' : f.role[0].toUpperCase() + f.role.slice(1))
  if (f.unread) parts.push('unread')
  if (f.hasAttachment) parts.push('has attachment')
  for (const id of f.labelIds ?? []) parts.push(labels.find((l) => l.id === id)?.name ?? 'label')
  for (const s of f.from ?? []) parts.push(`from ${s}`)
  for (const s of f.subjectContains ?? []) parts.push(`subject ${s}`)
  return parts.join(' · ') || 'No filters'
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
