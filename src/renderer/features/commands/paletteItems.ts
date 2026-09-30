import type { Account, Label, SystemRole, View } from '@shared/types'
import i18n from '@/i18n'
import { roleName } from '@/lib/labels'
import { primaryBinding } from './shortcuts'

/** Data-only description of the command palette rows; built purely from app state so it can be tested. */

export type PaletteGroup = 'Actions' | 'Navigate' | 'Compose' | 'Settings'
export const GROUP_ORDER: PaletteGroup[] = ['Actions', 'Navigate', 'Compose', 'Settings']

/** Group ids stay English (they are keys); this is the heading the user reads. Also covers the jump-bar groups. */
export function groupText(g: PaletteGroup | 'Commands' | 'People' | 'Threads'): string {
  switch (g) {
    case 'Actions': return i18n.t('commands:group.actions')
    case 'Navigate': return i18n.t('commands:group.navigate')
    case 'Compose': return i18n.t('commands:group.compose')
    case 'Settings': return i18n.t('commands:group.settings')
    case 'Commands': return i18n.t('commands:group.commands')
    case 'People': return i18n.t('commands:group.people')
    case 'Threads': return i18n.t('commands:group.threads')
  }
}

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
  /** Sender of the focused thread (first participant who is not you); enables sender-level actions. */
  sender?: { name: string; email: string } | null
  /** Ids of the inbox bundles switched on (features/threadlist/bundles), to word the toggle. */
  bundleIds?: string[]
  /** Every target thread is muted (label flips to Unmute). */
  targetMuted?: boolean
  /** Number of threads in the visible list (Select all needs some). */
  listCount?: number
}

const item = (i: Omit<PaletteItem, 'key'> & { key?: string }): PaletteItem => ({ key: i.key ?? `${i.cmd}:${i.arg ?? ''}`, ...i })

export function buildPaletteItems(c: PaletteCtx): PaletteItem[] {
  const out: PaletteItem[] = []
  const t = i18n.getFixedT(null, 'commands')
  const count = c.targetCount

  // ---- Actions (context aware: only when a thread is targeted)
  if (c.targetCount > 0) {
    if (c.navRole !== 'archive' && c.navRole !== 'trash' && c.navRole !== 'spam') out.push(item({ group: 'Actions', label: t('palette.archive', { count }), cmd: 'thread.archive', icon: 'archive', keywords: ['done'] }))
    if (c.navRole === 'spam') out.push(item({ group: 'Actions', label: t('palette.notSpam', { count }), cmd: 'thread.inbox', icon: 'inbox', binding: primaryBinding('thread.inbox'), keywords: ['unspam', 'not junk', 'restore', 'inbox', 'legitimate'] }))
    else if (c.navRole !== 'inbox') out.push(item({ group: 'Actions', label: t('palette.moveToInbox', { count }), cmd: 'thread.inbox', icon: 'inbox', keywords: ['unarchive', 'restore'] }))
    out.push(item({ group: 'Actions', label: c.targetStarred ? t('palette.removeStar') : t('palette.star'), cmd: 'thread.star', icon: c.targetStarred ? 'star-off' : 'star', keywords: ['favorite', 'unstar'] }))
    out.push(item({ group: 'Actions', label: t('palette.setReminder'), cmd: 'thread.remind', icon: 'clock', keywords: ['snooze', 'later', 'remind'] }))
    out.push(item({ group: 'Actions', label: t('palette.followUp'), cmd: 'thread.followup', icon: 'clock', binding: primaryBinding('thread.followup'), keywords: ['remind', 'waiting', 'nudge', 'no response'] }))
    out.push(item({ group: 'Actions', label: t('palette.label'), cmd: 'thread.label', icon: 'tag', keywords: ['tag', 'add label', 'remove label'] }))
    out.push(item({ group: 'Actions', label: c.targetUnread ? t('palette.markRead') : t('palette.markUnread'), cmd: c.targetUnread ? 'thread.markRead' : 'thread.markUnread', icon: c.targetUnread ? 'mail-open' : 'mail', binding: primaryBinding('thread.unread'), keywords: ['read', 'unread'] }))
    out.push(item({ group: 'Actions', label: t('palette.delete'), cmd: 'thread.trash', icon: 'trash', keywords: ['trash', 'remove'] }))
    if (c.navRole !== 'spam') out.push(item({ group: 'Actions', label: t('palette.reportSpam'), cmd: 'thread.spam', icon: 'spam', keywords: ['junk'] }))
    out.push(item({ group: 'Actions', label: t('palette.moveTo'), cmd: 'thread.move', icon: 'folder-input', keywords: ['folder', 'label', 'file', 'move'] }))
    out.push(item({ group: 'Actions', label: c.targetMuted ? t('palette.unmute') : t('palette.mute'), cmd: 'thread.mute', icon: 'bell-off', keywords: ['silence', 'ignore', 'skip inbox', 'mute'] }))
  }
  if ((c.listCount ?? 0) > 0) out.push(item({ group: 'Actions', label: t('palette.selectAll'), cmd: 'sel.all', icon: 'check-square', keywords: ['everything', 'multi-select', 'all'] }))
  if (c.hasThread) out.push(item({ group: 'Actions', label: t('palette.unsubscribe'), cmd: 'thread.unsubscribe', icon: 'unsubscribe', keywords: ['newsletter', 'mailing list'] }))
  if (c.hasThread) out.push(item({ group: 'Actions', label: t('palette.copyCode'), cmd: 'msg.copyCode', icon: 'keyboard', binding: primaryBinding('msg.copyCode'), keywords: ['otp', 'one-time', 'passcode', '2fa'] }))
  if (c.hasThread) out.push(item({ group: 'Actions', label: t('palette.createRule'), cmd: 'rule.create', icon: 'rule', keywords: ['filter', 'automate', 'skip inbox', 'always'] }))
  if (c.sender) {
    const { name, email } = c.sender
    out.push(item({ group: 'Actions', label: t('palette.archiveAllFrom', { name }), cmd: 'sender.archiveAll', arg: email, icon: 'archive', keywords: ['sender', 'everything', email], hint: email }))
    out.push(item({ group: 'Actions', label: t('palette.unsubscribeArchiveAll', { name }), cmd: 'sender.unsubscribeArchive', arg: email, icon: 'unsubscribe', keywords: ['sender', 'newsletter', 'mailing list', email] }))
    out.push(item({ group: 'Actions', label: t('palette.block', { name }), cmd: 'sender.block', arg: email, icon: 'block', keywords: ['sender', 'trash', 'ban', 'never', email], hint: t('palette.blockHint') }))
    const bundled = c.bundleIds?.includes(`sender:${email.toLowerCase()}`)
    out.push(item({ group: 'Actions', label: bundled ? t('palette.stopBundling', { name }) : t('palette.bundle', { name }), cmd: 'bundle.sender', arg: email, icon: 'layers', keywords: ['collapse', 'group', 'sender'], secondary: true }))
  }
  if (c.canUndo) out.push(item({ group: 'Actions', label: t('palette.undoLast'), cmd: 'thread.undo', icon: 'undo', keywords: ['revert'] }))

  // ---- Navigate
  const nav = (role: SystemRole, icon: string, cmd = `go.${role}`, keywords: string[] = []): void => {
    out.push(item({ group: 'Navigate', label: t('palette.goTo', { name: roleName(role) }), cmd, icon, keywords: ['open', 'navigate', ...keywords] }))
  }
  nav('inbox', 'inbox')
  out.push(item({ group: 'Navigate', label: t('palette.goTo', { name: t('common:role.reminders') }), cmd: 'go.reminders', icon: 'clock', keywords: ['snoozed', 'open'] }))
  nav('starred', 'star')
  nav('sent', 'send')
  nav('drafts', 'file')
  nav('all', 'layers', 'go.all', ['archive'])
  nav('spam', 'spam')
  nav('trash', 'trash')
  for (const v of c.views) out.push(item({ group: 'Navigate', label: t('palette.goTo', { name: v.name }), cmd: 'go.view', arg: v.id, icon: 'view', emoji: v.emoji, keywords: ['view'], hint: t('palette.hintView') }))
  const seen = new Set<string>()
  for (const l of c.labels) {
    if (l.kind !== 'user') continue
    if (c.accountId !== 'all' && l.accountId !== c.accountId) continue
    const k = l.name.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(item({ group: 'Navigate', label: t('palette.goTo', { name: l.name }), cmd: 'go.label', arg: l.id, icon: 'label', labelColor: l.color ?? 'gray', keywords: ['label'], hint: t('palette.hintLabel') }))
    const bundled = c.bundleIds?.includes(`label:${k}`)
    out.push(item({ group: 'Settings', label: bundled ? t('palette.stopBundling', { name: l.name }) : t('palette.bundle', { name: l.name }), cmd: 'bundle.label', arg: l.id, icon: 'layers', keywords: ['collapse', 'group', 'label', 'bundle'], secondary: true }))
  }
  if (c.accounts.length > 1) {
    out.push(item({ group: 'Navigate', label: t('palette.allAccounts'), cmd: 'go.account', arg: 'all', icon: 'users', binding: 'ctrl+0', keywords: ['switch account', 'everything'], hint: c.accountId === 'all' ? t('palette.hintCurrent') : undefined }))
    c.accounts.slice(0, 9).forEach((a, i) => out.push(item({ group: 'Navigate', label: t('palette.switchTo', { name: a.name || a.email }), cmd: 'go.account', arg: a.id, icon: 'user', binding: `ctrl+${i + 1}`, keywords: ['account', a.email], hint: c.accountId === a.id ? t('palette.hintCurrent') : undefined })))
  }

  // ---- Compose
  out.push(item({ group: 'Compose', label: t('palette.newMessage'), cmd: 'compose.new', icon: 'pencil', keywords: ['write', 'compose', 'email'] }))
  if (c.hasThread) {
    out.push(item({ group: 'Compose', label: t('palette.reply'), cmd: 'msg.reply', icon: 'reply' }))
    out.push(item({ group: 'Compose', label: t('palette.replyAll'), cmd: 'msg.replyAll', icon: 'reply-all' }))
    out.push(item({ group: 'Compose', label: t('palette.forward'), cmd: 'msg.forward', icon: 'forward' }))
  }

  // ---- Settings
  out.push(item({ group: 'Settings', label: t('palette.openSettings'), cmd: 'ui.settings', icon: 'settings', keywords: ['preferences', 'options'] }))
  out.push(item({ group: 'Settings', label: t('palette.shortcuts'), cmd: 'ui.help', icon: 'keyboard', keywords: ['help', 'cheat sheet', 'keys'] }))
  out.push(item({ group: 'Settings', label: c.sidebarCollapsed ? t('palette.showSidebar') : t('palette.hideSidebar'), cmd: 'ui.sidebar', icon: 'sidebar', keywords: ['toggle sidebar'] }))
  out.push(item({ group: 'Settings', label: t('palette.addAccount'), cmd: 'account.add', icon: 'user-plus', keywords: ['gmail', 'outlook', 'connect'] }))
  out.push(item({ group: 'Settings', label: t('palette.syncNow'), cmd: 'sync.now', icon: 'refresh', keywords: ['refresh', 'fetch'] }))
  for (const [th, label, icon] of [['system', t('palette.themeSystem'), 'monitor'], ['light', t('palette.themeLight'), 'sun'], ['dark', t('palette.themeDark'), 'moon']] as const) {
    if (c.theme !== th) out.push(item({ group: 'Settings', label: t('palette.theme', { name: label }), cmd: 'theme.set', arg: th, icon, keywords: ['appearance', 'dark mode', 'light mode'], secondary: true }))
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
