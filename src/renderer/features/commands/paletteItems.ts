import type { Account, Label, SystemRole, View } from '@shared/types'
import { primaryBinding } from './shortcuts'

/** Data-only description of the command palette rows; built purely from app state so it can be tested. */

export type PaletteGroup = 'Actions' | 'Navigate' | 'Compose' | 'Settings'
export const GROUP_ORDER: PaletteGroup[] = ['Actions', 'Navigate', 'Compose', 'Settings']

export interface PaletteItem {
  key: string
  group: PaletteGroup
  label: string
  /** Command id run via runCommand(cmd, {arg}). */
  cmd: string
  arg?: string
  keywords?: string[]
  /** Binding to show as keycaps (defaults to the command's primary binding). */
  binding?: string
  icon: string
  /** Muted right-aligned text when there is no binding (e.g. account email). */
  hint?: string
  /** Emoji shown instead of the icon (views). */
  emoji?: string
  /** Only listed once the user types. */
  secondary?: boolean
  labelColor?: string
}

export interface PaletteCtx {
  targetCount: number
  /** Known target threads (may be fewer than targetCount for threads outside the list). */
  targetStarred: boolean
  targetUnread: boolean
  /** A thread is open or under the cursor (reply / forward / unsubscribe need one). */
  hasThread: boolean
  navRole: SystemRole | null
  accountId: string
  accounts: Account[]
  views: View[]
  labels: Label[]
  theme: 'system' | 'light' | 'dark'
  sidebarCollapsed: boolean
  canUndo: boolean
}

const item = (i: Omit<PaletteItem, 'key'> & { key?: string }): PaletteItem => ({ key: i.key ?? `${i.cmd}:${i.arg ?? ''}`, ...i })

export function buildPaletteItems(c: PaletteCtx): PaletteItem[] {
  const out: PaletteItem[] = []
  const many = c.targetCount > 1
  const subject = many ? `${c.targetCount} conversations` : 'conversation'

  // ---- Actions (context aware: only when a thread is targeted)
  if (c.targetCount > 0) {
    if (c.navRole !== 'archive' && c.navRole !== 'trash' && c.navRole !== 'spam') out.push(item({ group: 'Actions', label: `Archive ${subject}`, cmd: 'thread.archive', icon: 'archive', keywords: ['done'] }))
    if (c.navRole !== 'inbox') out.push(item({ group: 'Actions', label: `Move ${subject} to Inbox`, cmd: 'thread.inbox', icon: 'inbox', keywords: ['unarchive', 'restore'] }))
    out.push(item({ group: 'Actions', label: c.targetStarred ? 'Remove star' : 'Star', cmd: 'thread.star', icon: c.targetStarred ? 'star-off' : 'star', keywords: ['favorite', 'unstar'] }))
    out.push(item({ group: 'Actions', label: 'Set reminder…', cmd: 'thread.remind', icon: 'clock', keywords: ['snooze', 'later', 'remind'] }))
    out.push(item({ group: 'Actions', label: 'Label…', cmd: 'thread.label', icon: 'tag', keywords: ['tag', 'add label', 'remove label'] }))
    out.push(item({ group: 'Actions', label: c.targetUnread ? 'Mark as read' : 'Mark as unread', cmd: c.targetUnread ? 'thread.markRead' : 'thread.markUnread', icon: c.targetUnread ? 'mail-open' : 'mail', binding: primaryBinding('thread.unread'), keywords: ['read', 'unread'] }))
    out.push(item({ group: 'Actions', label: 'Delete', cmd: 'thread.trash', icon: 'trash', keywords: ['trash', 'remove'] }))
    out.push(item({ group: 'Actions', label: 'Report spam', cmd: 'thread.spam', icon: 'spam', keywords: ['junk'] }))
  }
  if (c.hasThread) out.push(item({ group: 'Actions', label: 'Unsubscribe', cmd: 'thread.unsubscribe', icon: 'unsubscribe', keywords: ['newsletter', 'mailing list'] }))
  if (c.canUndo) out.push(item({ group: 'Actions', label: 'Undo last action', cmd: 'thread.undo', icon: 'undo', keywords: ['revert'] }))

  // ---- Navigate
  const nav = (label: string, role: SystemRole, icon: string, cmd = `go.${role}`, keywords: string[] = []): void => {
    out.push(item({ group: 'Navigate', label: `Go to ${label}`, cmd, icon, keywords: ['open', 'navigate', ...keywords] }))
  }
  nav('Inbox', 'inbox', 'inbox')
  out.push(item({ group: 'Navigate', label: 'Go to Reminders', cmd: 'go.reminders', icon: 'clock', keywords: ['snoozed', 'open'] }))
  nav('Starred', 'starred', 'star')
  nav('Sent', 'sent', 'send')
  nav('Drafts', 'drafts', 'file')
  nav('All Mail', 'all', 'layers', 'go.all', ['archive'])
  nav('Spam', 'spam', 'spam')
  nav('Trash', 'trash', 'trash')
  for (const v of c.views) out.push(item({ group: 'Navigate', label: `Go to ${v.name}`, cmd: 'go.view', arg: v.id, icon: 'view', emoji: v.emoji, keywords: ['view'], hint: 'View' }))
  const seen = new Set<string>()
  for (const l of c.labels) {
    if (l.kind !== 'user') continue
    if (c.accountId !== 'all' && l.accountId !== c.accountId) continue
    const k = l.name.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(item({ group: 'Navigate', label: `Go to ${l.name}`, cmd: 'go.label', arg: l.id, icon: 'label', labelColor: l.color ?? 'gray', keywords: ['label'], hint: 'Label' }))
  }
  if (c.accounts.length > 1) {
    out.push(item({ group: 'Navigate', label: 'All accounts', cmd: 'go.account', arg: 'all', icon: 'users', binding: 'ctrl+0', keywords: ['switch account', 'everything'], hint: c.accountId === 'all' ? 'Current' : undefined }))
    c.accounts.slice(0, 9).forEach((a, i) => out.push(item({ group: 'Navigate', label: `Switch to ${a.name || a.email}`, cmd: 'go.account', arg: a.id, icon: 'user', binding: `ctrl+${i + 1}`, keywords: ['account', a.email], hint: c.accountId === a.id ? 'Current' : undefined })))
  }

  // ---- Compose
  out.push(item({ group: 'Compose', label: 'New message', cmd: 'compose.new', icon: 'pencil', keywords: ['write', 'compose', 'email'] }))
  if (c.hasThread) {
    out.push(item({ group: 'Compose', label: 'Reply', cmd: 'msg.reply', icon: 'reply' }))
    out.push(item({ group: 'Compose', label: 'Reply all', cmd: 'msg.replyAll', icon: 'reply-all' }))
    out.push(item({ group: 'Compose', label: 'Forward', cmd: 'msg.forward', icon: 'forward' }))
  }

  // ---- Settings
  out.push(item({ group: 'Settings', label: 'Open settings', cmd: 'ui.settings', icon: 'settings', keywords: ['preferences', 'options'] }))
  out.push(item({ group: 'Settings', label: 'Keyboard shortcuts', cmd: 'ui.help', icon: 'keyboard', keywords: ['help', 'cheat sheet', 'keys'] }))
  out.push(item({ group: 'Settings', label: c.sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar', cmd: 'ui.sidebar', icon: 'sidebar', keywords: ['toggle sidebar'] }))
  out.push(item({ group: 'Settings', label: 'Add account…', cmd: 'account.add', icon: 'user-plus', keywords: ['gmail', 'outlook', 'connect'] }))
  out.push(item({ group: 'Settings', label: 'Sync now', cmd: 'sync.now', icon: 'refresh', keywords: ['refresh', 'fetch'] }))
  for (const [t, label, icon] of [['system', 'System', 'monitor'], ['light', 'Light', 'sun'], ['dark', 'Dark', 'moon']] as const) {
    if (c.theme !== t) out.push(item({ group: 'Settings', label: `Theme: ${label}`, cmd: 'theme.set', arg: t, icon, keywords: ['appearance', 'dark mode', 'light mode'], secondary: true }))
  }
  return out
}

/** Group + order items; `query` filtering happens before this. */
export function groupItems(items: PaletteItem[]): { group: PaletteGroup; items: PaletteItem[] }[] {
  return GROUP_ORDER.map((group) => ({ group, items: items.filter((i) => i.group === group) })).filter((g) => g.items.length)
}

/**
 * Where an item lives in the universal jump bar once the user types: contextual Actions,
 * Navigate (folders, views, labels), or Commands (compose, settings, account switching).
 * With an empty query the palette keeps the four classic headings instead.
 */
export function jumpGroupOf(i: PaletteItem): 'Actions' | 'Navigate' | 'Commands' {
  if (i.group === 'Actions') return 'Actions'
  if (i.cmd.startsWith('go.') && i.cmd !== 'go.account') return 'Navigate'
  return 'Commands'
}
