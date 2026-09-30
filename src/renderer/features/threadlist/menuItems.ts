import type { SystemRole, Thread } from '@shared/types'
import i18n from '@/i18n'

/**
 * The right-click menu for a row. Pure: which entries exist for a thread in a given folder.
 * `cmd` is a command id (commands/runner.ts) so the menu behaves like the palette.
 */
export interface RowMenuItem {
  id: string
  label: string
  /** Icon key resolved in RowMenu.tsx. */
  icon: string
  cmd: string
  shortcut?: string
  danger?: boolean
  /** Draw a separator above this entry. */
  sep?: boolean
}

export function buildRowMenu(t: Pick<Thread, 'unread' | 'starred' | 'muted'>, role: SystemRole | null): RowMenuItem[] {
  const tr = i18n.getFixedT(null, 'threadlist')
  const out: RowMenuItem[] = []
  if (role === 'spam') out.push({ id: 'notSpam', label: tr('menu.notSpam'), icon: 'inbox', cmd: 'thread.inbox', shortcut: '⇧E' })
  else if (role === 'trash') out.push({ id: 'restore', label: tr('menu.restoreToInbox'), icon: 'inbox', cmd: 'thread.inbox', shortcut: '⇧E' })
  else out.push({ id: 'archive', label: tr('menu.archive'), icon: 'archive', cmd: 'thread.archive', shortcut: 'E' })
  out.push({ id: 'read', label: t.unread ? tr('menu.markRead') : tr('menu.markUnread'), icon: t.unread ? 'mail-open' : 'mail', cmd: t.unread ? 'thread.markRead' : 'thread.markUnread', shortcut: t.unread ? '⇧I' : 'U' })
  out.push({ id: 'star', label: t.starred ? tr('menu.removeStar') : tr('menu.star'), icon: 'star', cmd: 'thread.star', shortcut: 'S' })
  out.push({ id: 'remind', label: tr('menu.setReminder'), icon: 'clock', cmd: 'thread.remind', shortcut: 'H', sep: true })
  out.push({ id: 'label', label: tr('menu.label'), icon: 'tag', cmd: 'thread.label', shortcut: 'L' })
  out.push({ id: 'move', label: tr('menu.moveTo'), icon: 'folder', cmd: 'thread.move', shortcut: 'V' })
  out.push({ id: 'mute', label: t.muted ? tr('menu.unmute') : tr('menu.mute'), icon: 'bell-off', cmd: 'thread.mute', shortcut: 'M' })
  if (role !== 'spam' && role !== 'trash') out.push({ id: 'spam', label: tr('menu.reportSpam'), icon: 'spam', cmd: 'thread.spam', shortcut: '!', sep: true })
  out.push({ id: 'trash', label: tr('menu.delete'), icon: 'trash', cmd: 'thread.trash', shortcut: '#', danger: true, sep: role === 'spam' || role === 'trash' })
  return out
}
