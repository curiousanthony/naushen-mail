/**
 * Single source of truth for every keyboard shortcut. `useGlobalShortcuts` binds from it,
 * the shortcut sheet renders it, and the command palette shows its keycaps.
 *
 * Source: docs/research/01-notion-mail-ui-spec.md §3 (Mac; `mod` = Cmd).
 * `owner` says who executes the binding: 'commands' (this feature) or another feature/native
 * menu, in which case the entry is documentation only (shown in the sheet, never bound here).
 */

import i18n from '@/i18n'

export type ShortcutOwner = 'commands' | 'reader' | 'compose' | 'menu' | 'list'

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

/** `section` stays an English identifier (grouping key); this is the heading the user reads. */
export function sectionText(section: string): string {
  switch (section) {
    case 'Navigation': return i18n.t('commands:section.navigation')
    case 'Threads': return i18n.t('commands:section.threads')
    case 'Selection': return i18n.t('commands:section.selection')
    case 'Messages': return i18n.t('commands:section.messages')
    case 'Compose window': return i18n.t('commands:section.composeWindow')
    case 'Global': return i18n.t('commands:section.global')
    default: return section
  }
}

const ACCOUNT_KEYS = ['ctrl+1', 'ctrl+2', 'ctrl+3', 'ctrl+4', 'ctrl+5', 'ctrl+6', 'ctrl+7', 'ctrl+8', 'ctrl+9', 'ctrl+0']

type ShortcutRow = Omit<ShortcutDef, 'label'>

const ROWS: ShortcutRow[] = [
  // ---- Navigation
  { id: 'nav.next', section: 'Navigation', keys: ['j'], keywords: ['down', 'move'] },
  { id: 'nav.prev', section: 'Navigation', keys: ['k'], keywords: ['up', 'move'] },
  { id: 'nav.open', section: 'Navigation', keys: ['enter'], keywords: ['read'] },
  { id: 'nav.arrows', section: 'Navigation', keys: ['down', 'up'], owner: 'list', keywords: ['cursor', 'focus', 'keyboard'], display: [['↑', '↓']] },
  { id: 'nav.openO', section: 'Navigation', keys: ['o'], owner: 'list', keywords: ['read'] },
  { id: 'nav.list', section: 'Navigation', keys: ['g l'], keywords: ['cursor', 'rows', 'conversations', 'list'] },
  { id: 'nav.back', section: 'Navigation', keys: ['esc'], keywords: ['dismiss', 'clear selection'] },
  { id: 'nav.top', section: 'Navigation', keys: ['mod+up'], keywords: ['first'] },
  { id: 'nav.bottom', section: 'Navigation', keys: ['mod+down'], keywords: ['last'] },
  { id: 'go.inbox', section: 'Navigation', keys: ['g i'] },
  { id: 'go.sent', section: 'Navigation', keys: ['g t'] },
  { id: 'go.drafts', section: 'Navigation', keys: ['g d'] },
  { id: 'go.all', section: 'Navigation', keys: ['g a'], keywords: ['archive'] },
  { id: 'account.switch', section: 'Navigation', keys: ACCOUNT_KEYS, keywords: ['all accounts'], display: [['⌃', '1–9']] },

  // ---- Threads
  { id: 'thread.archive', section: 'Threads', keys: ['e'], keywords: ['done'] },
  { id: 'thread.trash', section: 'Threads', keys: ['#', 'delete', 'backspace'], keywords: ['trash', 'remove'] },
  { id: 'thread.spam', section: 'Threads', keys: ['!'], keywords: ['junk'] },
  { id: 'thread.unread', section: 'Threads', keys: ['u'], keywords: ['read'] },
  { id: 'thread.inbox', section: 'Threads', keys: ['shift+e'], keywords: ['unarchive', 'restore'] },
  { id: 'thread.undo', section: 'Threads', keys: ['z'], keywords: ['revert'] },
  { id: 'thread.remind', section: 'Threads', keys: ['h'], keywords: ['snooze', 'later'] },
  { id: 'thread.followup', section: 'Threads', keys: ['w'], keywords: ['remind', 'waiting', 'nudge', 'no response'] },
  { id: 'thread.label', section: 'Threads', keys: ['l'], keywords: ['tag', 'labels'] },
  { id: 'thread.star', section: 'Threads', keys: ['s'], keywords: ['favorite'] },
  { id: 'thread.unsubscribe', section: 'Threads', keys: ['mod+u'], keywords: ['newsletter', 'mailing list'] },
  { id: 'rule.create', section: 'Threads', keys: ['mod+alt+r'], keywords: ['filter', 'automate', 'sender', 'skip inbox'] },
  { id: 'thread.move', section: 'Threads', keys: ['v'], keywords: ['folder', 'label', 'file', 'archive to'] },
  { id: 'thread.mute', section: 'Threads', keys: ['m'], keywords: ['silence', 'ignore', 'skip inbox'] },
  { id: 'thread.markRead', section: 'Threads', keys: ['shift+i'], keywords: ['read', 'seen'] },

  // ---- Selection
  { id: 'sel.toggle', section: 'Selection', keys: ['x'], keywords: ['check', 'multi'] },
  { id: 'sel.extendDown', section: 'Selection', keys: ['shift+down'], keywords: ['multi-select'] },
  { id: 'sel.extendUp', section: 'Selection', keys: ['shift+up'], keywords: ['multi-select'] },
  { id: 'sel.all', section: 'Selection', keys: ['mod+a'], keywords: ['everything', 'multi-select'] },

  // ---- Messages
  { id: 'msg.reply', section: 'Messages', keys: ['r'] },
  { id: 'msg.replyAll', section: 'Messages', keys: ['a'] },
  { id: 'msg.forward', section: 'Messages', keys: ['f'] },
  { id: 'msg.next', section: 'Messages', keys: ['n'], owner: 'reader' },
  { id: 'msg.prev', section: 'Messages', keys: ['p'], owner: 'reader' },
  { id: 'msg.toggle', section: 'Messages', keys: ['o'], owner: 'reader' },
  { id: 'msg.toggleAll', section: 'Messages', keys: ['shift+o'], owner: 'reader' },
  { id: 'person.info', section: 'Messages', keys: ['i'], keywords: ['contact', 'person', 'who', 'profile'] },
  { id: 'msg.attachments', section: 'Messages', keys: ['mod+o'], owner: 'reader' },
  { id: 'msg.copyCode', section: 'Messages', keys: ['shift+c'], keywords: ['otp', 'one-time', 'passcode', '2fa', 'code'] },

  // ---- Compose window (handled by the compose feature; listed for reference)
  { id: 'compose.send', section: 'Compose window', keys: ['mod+enter'], owner: 'compose' },
  { id: 'compose.sendArchive', section: 'Compose window', keys: ['mod+shift+enter'], owner: 'compose' },
  { id: 'compose.exit', section: 'Compose window', keys: ['esc'], owner: 'compose' },
  { id: 'compose.discard', section: 'Compose window', keys: ['mod+shift+d'], owner: 'compose' },
  { id: 'compose.cc', section: 'Compose window', keys: ['mod+shift+c'], owner: 'compose' },
  { id: 'compose.bcc', section: 'Compose window', keys: ['mod+shift+b'], owner: 'compose' },
  { id: 'compose.from', section: 'Compose window', keys: ['mod+shift+f'], owner: 'compose' },
  { id: 'compose.subject', section: 'Compose window', keys: ['mod+shift+p'], owner: 'compose' },
  { id: 'compose.recipient', section: 'Compose window', keys: ['mod+shift+o'], owner: 'compose' },
  { id: 'compose.body', section: 'Compose window', keys: ['mod+shift+y'], owner: 'compose' },
  { id: 'compose.attach', section: 'Compose window', keys: ['mod+shift+a'], owner: 'compose' },
  { id: 'compose.h', section: 'Compose window', keys: ['mod+alt+0'], owner: 'compose', display: [['⌘', '⌥', '0–3']] },
  { id: 'compose.lists', section: 'Compose window', keys: ['mod+alt+4'], owner: 'compose', display: [['⌘', '⌥', '4–7']] },
  { id: 'compose.link', section: 'Compose window', keys: ['mod+shift+l'], owner: 'compose' },

  // ---- Global
  { id: 'compose.new', section: 'Global', keys: ['c'], keywords: ['new message', 'write'] },
  { id: 'ui.palette', section: 'Global', keys: ['mod+k', 'mod+p'], global: true, keywords: ['palette', 'commands'] },
  { id: 'ui.search', section: 'Global', keys: ['/'], keywords: ['find'] },
  { id: 'ui.help', section: 'Global', keys: ['?'], keywords: ['help', 'cheat sheet'] },
  { id: 'ui.sidebar', section: 'Global', keys: ['mod+\\'], global: true, keywords: ['hide', 'show'] },
  { id: 'sync.now', section: 'Global', keys: ['mod+r'], global: true, keywords: ['refresh', 'reload', 'check mail', 'fetch'] },
  { id: 'ui.settings', section: 'Global', keys: ['mod+,'], owner: 'menu', keywords: ['preferences'] }
]

/**
 * The table above is language-neutral (ids, sections, bindings). `label` is resolved from
 * `commands:shortcut.<id>` at read time, so it follows the UI language; ids are stable, so the
 * keys in commands.json mirror them one to one (`nav.next` -> `shortcut.nav.next`).
 */
export const SHORTCUTS: ShortcutDef[] = ROWS.map((r) => ({
  ...r,
  get label(): string { return i18n.t(`commands:shortcut.${r.id}`) }
}))

export const primaryBinding = (id: string): string | undefined => SHORTCUTS.find((s) => s.id === id)?.keys[0]

/** Bindings executed by this feature, for KeyMatcher. */
export function activeBindings(table: ShortcutDef[] = SHORTCUTS): { binding: string; id: string }[] {
  return table.filter((s) => (s.owner ?? 'commands') === 'commands').flatMap((s) => s.keys.map((binding) => ({ binding, id: s.id })))
}

export const isGlobalBinding = (id: string, table: ShortcutDef[] = SHORTCUTS): boolean => !!table.find((s) => s.id === id)?.global
