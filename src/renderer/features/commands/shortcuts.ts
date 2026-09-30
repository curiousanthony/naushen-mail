/**
 * Single source of truth for every keyboard shortcut. `useGlobalShortcuts` binds from it,
 * the shortcut sheet renders it, and the command palette shows its keycaps.
 *
 * Source: docs/research/01-notion-mail-ui-spec.md §3 (Mac; `mod` = Cmd).
 * `owner` says who executes the binding: 'commands' (this feature) or another feature/native
 * menu, in which case the entry is documentation only (shown in the sheet, never bound here).
 */

export type ShortcutOwner = 'commands' | 'reader' | 'compose' | 'menu'

export interface ShortcutDef {
  /** Command id; see runner.ts for the implementations. */
  id: string
  label: string
  section: string
  /** Bindings; the first is the primary (displayed) one. Space separates a sequence step. */
  keys: string[]
  owner?: ShortcutOwner
  /** Fires even while typing in an input / editor (only for modifier combos). */
  global?: boolean
  /** Extra words for search filtering. */
  keywords?: string[]
  /** Override for what the sheet shows, as steps of keycaps. */
  display?: string[][]
}

export const SECTIONS = ['Navigation', 'Threads', 'Selection', 'Messages', 'Compose window', 'Global'] as const

const ACCOUNT_KEYS = ['ctrl+1', 'ctrl+2', 'ctrl+3', 'ctrl+4', 'ctrl+5', 'ctrl+6', 'ctrl+7', 'ctrl+8', 'ctrl+9', 'ctrl+0']

export const SHORTCUTS: ShortcutDef[] = [
  // ---- Navigation
  { id: 'nav.next', label: 'Next thread', section: 'Navigation', keys: ['j'], keywords: ['down', 'move'] },
  { id: 'nav.prev', label: 'Previous thread', section: 'Navigation', keys: ['k'], keywords: ['up', 'move'] },
  { id: 'nav.open', label: 'Open thread', section: 'Navigation', keys: ['enter'], keywords: ['read'] },
  { id: 'nav.back', label: 'Close thread / back', section: 'Navigation', keys: ['esc'], keywords: ['dismiss', 'clear selection'] },
  { id: 'nav.top', label: 'Jump to top', section: 'Navigation', keys: ['mod+up'], keywords: ['first'] },
  { id: 'nav.bottom', label: 'Jump to bottom', section: 'Navigation', keys: ['mod+down'], keywords: ['last'] },
  { id: 'go.inbox', label: 'Go to Inbox', section: 'Navigation', keys: ['g i'] },
  { id: 'go.sent', label: 'Go to Sent', section: 'Navigation', keys: ['g t'] },
  { id: 'go.drafts', label: 'Go to Drafts', section: 'Navigation', keys: ['g d'] },
  { id: 'go.all', label: 'Go to All Mail', section: 'Navigation', keys: ['g a'], keywords: ['archive'] },
  { id: 'account.switch', label: 'Switch account', section: 'Navigation', keys: ACCOUNT_KEYS, keywords: ['all accounts'], display: [['⌃', '1–9']] },

  // ---- Threads
  { id: 'thread.archive', label: 'Archive', section: 'Threads', keys: ['e'], keywords: ['done'] },
  { id: 'thread.trash', label: 'Delete', section: 'Threads', keys: ['#', 'delete', 'backspace'], keywords: ['trash', 'remove'] },
  { id: 'thread.spam', label: 'Report spam', section: 'Threads', keys: ['!'], keywords: ['junk'] },
  { id: 'thread.unread', label: 'Mark as unread', section: 'Threads', keys: ['u'], keywords: ['read'] },
  { id: 'thread.inbox', label: 'Move to Inbox', section: 'Threads', keys: ['shift+e'], keywords: ['unarchive', 'restore'] },
  { id: 'thread.undo', label: 'Undo', section: 'Threads', keys: ['z'], keywords: ['revert'] },
  { id: 'thread.remind', label: 'Set reminder', section: 'Threads', keys: ['h'], keywords: ['snooze', 'later'] },
  { id: 'thread.followup', label: 'Follow up if no reply', section: 'Threads', keys: ['w'], keywords: ['remind', 'waiting', 'nudge', 'no response'] },
  { id: 'thread.label', label: 'Label / remove label', section: 'Threads', keys: ['l'], keywords: ['tag', 'labels'] },
  { id: 'thread.star', label: 'Star / unstar', section: 'Threads', keys: ['s'], keywords: ['favorite'] },
  { id: 'thread.unsubscribe', label: 'Unsubscribe', section: 'Threads', keys: ['mod+u'], keywords: ['newsletter', 'mailing list'] },
  { id: 'rule.create', label: 'Create rule from thread', section: 'Threads', keys: ['mod+alt+r'], keywords: ['filter', 'automate', 'sender', 'skip inbox'] },
  { id: 'thread.move', label: 'Move to…', section: 'Threads', keys: ['v'], keywords: ['folder', 'label', 'file', 'archive to'] },
  { id: 'thread.mute', label: 'Mute / unmute conversation', section: 'Threads', keys: ['m'], keywords: ['silence', 'ignore', 'skip inbox'] },
  { id: 'thread.markRead', label: 'Mark as read', section: 'Threads', keys: ['shift+i'], keywords: ['read', 'seen'] },

  // ---- Selection
  { id: 'sel.toggle', label: 'Select / unselect conversation', section: 'Selection', keys: ['x'], keywords: ['check', 'multi'] },
  { id: 'sel.extendDown', label: 'Extend selection down', section: 'Selection', keys: ['shift+down'], keywords: ['multi-select'] },
  { id: 'sel.extendUp', label: 'Extend selection up', section: 'Selection', keys: ['shift+up'], keywords: ['multi-select'] },
  { id: 'sel.all', label: 'Select all conversations', section: 'Selection', keys: ['mod+a'], keywords: ['everything', 'multi-select'] },

  // ---- Messages
  { id: 'msg.reply', label: 'Reply', section: 'Messages', keys: ['r'] },
  { id: 'msg.replyAll', label: 'Reply all', section: 'Messages', keys: ['a'] },
  { id: 'msg.forward', label: 'Forward', section: 'Messages', keys: ['f'] },
  { id: 'msg.next', label: 'Next message in thread', section: 'Messages', keys: ['n'], owner: 'reader' },
  { id: 'msg.prev', label: 'Previous message in thread', section: 'Messages', keys: ['p'], owner: 'reader' },
  { id: 'msg.toggle', label: 'Expand / collapse message', section: 'Messages', keys: ['o'], owner: 'reader' },
  { id: 'msg.toggleAll', label: 'Expand / collapse all', section: 'Messages', keys: ['shift+o'], owner: 'reader' },
  { id: 'person.info', label: 'Sender info', section: 'Messages', keys: ['i'], keywords: ['contact', 'person', 'who', 'profile'] },
  { id: 'msg.attachments', label: 'Open attachments', section: 'Messages', keys: ['mod+o'], owner: 'reader' },
  { id: 'msg.copyCode', label: 'Copy verification code', section: 'Messages', keys: ['shift+c'], keywords: ['otp', 'one-time', 'passcode', '2fa', 'code'] },

  // ---- Compose window (handled by the compose feature; listed for reference)
  { id: 'compose.send', label: 'Send', section: 'Compose window', keys: ['mod+enter'], owner: 'compose' },
  { id: 'compose.sendArchive', label: 'Send and archive', section: 'Compose window', keys: ['mod+shift+enter'], owner: 'compose' },
  { id: 'compose.exit', label: 'Exit draft', section: 'Compose window', keys: ['esc'], owner: 'compose' },
  { id: 'compose.discard', label: 'Discard draft', section: 'Compose window', keys: ['mod+shift+d'], owner: 'compose' },
  { id: 'compose.cc', label: 'Add Cc', section: 'Compose window', keys: ['mod+shift+c'], owner: 'compose' },
  { id: 'compose.bcc', label: 'Add Bcc', section: 'Compose window', keys: ['mod+shift+b'], owner: 'compose' },
  { id: 'compose.from', label: 'Edit From', section: 'Compose window', keys: ['mod+shift+f'], owner: 'compose' },
  { id: 'compose.subject', label: 'Edit subject', section: 'Compose window', keys: ['mod+shift+p'], owner: 'compose' },
  { id: 'compose.recipient', label: 'Edit recipient', section: 'Compose window', keys: ['mod+shift+o'], owner: 'compose' },
  { id: 'compose.body', label: 'Focus message body', section: 'Compose window', keys: ['mod+shift+y'], owner: 'compose' },
  { id: 'compose.attach', label: 'Add attachment', section: 'Compose window', keys: ['mod+shift+a'], owner: 'compose' },
  { id: 'compose.h', label: 'Text / Heading 1–3', section: 'Compose window', keys: ['mod+alt+0'], owner: 'compose', display: [['⌘', '⌥', '0–3']] },
  { id: 'compose.lists', label: 'Checklist / bullets / numbered / quote', section: 'Compose window', keys: ['mod+alt+4'], owner: 'compose', display: [['⌘', '⌥', '4–7']] },
  { id: 'compose.link', label: 'Insert or edit link', section: 'Compose window', keys: ['mod+shift+l'], owner: 'compose' },

  // ---- Global
  { id: 'compose.new', label: 'Compose', section: 'Global', keys: ['c'], keywords: ['new message', 'write'] },
  { id: 'ui.palette', label: 'Command menu', section: 'Global', keys: ['mod+k', 'mod+p'], global: true, keywords: ['palette', 'commands'] },
  { id: 'ui.search', label: 'Search', section: 'Global', keys: ['/'], keywords: ['find'] },
  { id: 'ui.help', label: 'Keyboard shortcuts', section: 'Global', keys: ['?'], keywords: ['help', 'cheat sheet'] },
  { id: 'ui.sidebar', label: 'Toggle sidebar', section: 'Global', keys: ['mod+\\'], global: true, keywords: ['hide', 'show'] },
  { id: 'sync.now', label: 'Sync now (refresh mail)', section: 'Global', keys: ['mod+r'], global: true, keywords: ['refresh', 'reload', 'check mail', 'fetch'] },
  { id: 'ui.settings', label: 'Open settings', section: 'Global', keys: ['mod+,'], owner: 'menu', keywords: ['preferences'] }
]

export const primaryBinding = (id: string): string | undefined => SHORTCUTS.find((s) => s.id === id)?.keys[0]

/** Bindings executed by this feature, for KeyMatcher. */
export function activeBindings(table: ShortcutDef[] = SHORTCUTS): { binding: string; id: string }[] {
  return table.filter((s) => (s.owner ?? 'commands') === 'commands').flatMap((s) => s.keys.map((binding) => ({ binding, id: s.id })))
}

export const isGlobalBinding = (id: string, table: ShortcutDef[] = SHORTCUTS): boolean => !!table.find((s) => s.id === id)?.global
