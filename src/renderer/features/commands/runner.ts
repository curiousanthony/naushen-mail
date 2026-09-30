import type { SystemRole, Thread, ThreadAction } from '@shared/types'
import { LABEL_COLORS } from '@shared/types'
import { useApp } from '@/lib/store'
import { extendSelection, lastMessage, moveFocus, targetIds } from './selection'
import { UndoStack, invertAction, toastText } from './undo'
import { parseListUnsubscribe } from './unsubscribe'
import { useCommandUi } from './ui-store'
import { copyVerificationCode } from '@/features/reader/codeCommand'
import { bundleStops, collapseBundleAt, expandBundleAt } from '../threadlist/bundleNav'
import { archiveAllFrom, blockSender, openRuleForFocused, toggleLabelBundle, toggleSenderBundle, unsubscribeAndArchive } from '../rules/actions'
import { toggleSenderInfo } from '../people'

/**
 * Command implementations, keyed by the ids in shortcuts.ts. Used by the keyboard hook, the
 * command palette and native menu commands, so all three behave identically.
 */

export interface RunCtx {
  /** Extra argument (view id, label id, account id, role, theme...). */
  arg?: string
  /** The combo that triggered the command (account.switch reads the digit). */
  combo?: string
}
type Handler = (ctx: RunCtx) => void | Promise<void>

const S = useApp.getState
export const undoStack = new UndoStack(20)

// ------------------------------------------------------------------ helpers

/** Threads currently targeted by an action (selection > open > cursor), resolved against the list. */
export function targetThreads(): { ids: string[]; threads: Thread[] } {
  const s = S()
  const ids = targetIds(s)
  const byId = new Map(s.threads.map((t) => [t.id, t]))
  return { ids, threads: ids.map((i) => byId.get(i)).filter((t): t is Thread => !!t) }
}

function reveal(id: string | null): void {
  if (!id || typeof document === 'undefined') return
  requestAnimationFrame(() => {
    const esc = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id
    document.querySelector(`[data-thread-id="${esc}"], [data-id="${esc}"]`)?.scrollIntoView({ block: 'nearest' })
  })
}

/** Apply an action with an undo-able toast and record it on the undo stack. */
export async function perform(action: ThreadAction, message: string | null, opts: { ids?: string[]; silent?: boolean } = {}): Promise<void> {
  const s = S()
  const ids = opts.ids ?? targetIds(s)
  if (!ids.length) return
  const inverse = invertAction(action)
  await s.act(action, ids)
  const entry = inverse ? undoStack.push(ids, inverse, message ?? '') : null
  if (opts.silent || !message) return
  S().toast({ message, actionLabel: entry ? 'Undo' : undefined, onAction: entry ? () => void undoEntry(entry.id) : undefined })
}

/**
 * Apply several actions as ONE undoable step (Move to label = add label + archive). Each step
 * targets its own ids; a single toast / `z` reverses them all, last step first.
 */
export async function performSteps(steps: { ids: string[]; action: ThreadAction }[], message: string): Promise<void> {
  const live = steps.filter((st) => st.ids.length)
  if (!live.length) return
  const inverses: { ids: string[]; action: ThreadAction }[] = []
  for (const st of live) {
    await S().act(st.action, st.ids)
    const inv = invertAction(st.action)
    if (inv) inverses.unshift({ ids: st.ids, action: inv })
  }
  const [first, ...rest] = inverses
  const entry = first ? undoStack.push(first.ids, first.action, message, rest) : null
  S().toast({ message, actionLabel: entry ? 'Undo' : undefined, onAction: entry ? () => void undoEntry(entry.id) : undefined })
}

async function undoEntry(entryId: number): Promise<void> {
  const entry = undoStack.take(entryId)
  if (entry) await applyUndo(entry)
}

async function applyUndo(entry: { ids: string[]; inverse: ThreadAction; extra?: { ids: string[]; action: ThreadAction }[] }): Promise<void> {
  await window.api.invoke('threads.act', entry.ids, entry.inverse)
  for (const x of entry.extra ?? []) await window.api.invoke('threads.act', x.ids, x.action)
  await S().refreshThreads()
  if (entry.ids[0]) { S().focus(entry.ids[0]); reveal(entry.ids[0]) }
}

/** `z`: undo the newest reversible action. */
export async function undoLast(): Promise<void> {
  const entry = undoStack.pop()
  if (!entry) { S().toast({ message: 'Nothing to undo', duration: 2500 }); return }
  await applyUndo(entry)
  S().toast({ message: 'Undone', duration: 2500 })
}

async function composeFor(mode: 'reply' | 'replyAll' | 'forward'): Promise<void> {
  const s = S()
  const id = s.openThreadId ?? s.focusedId
  if (!id) return
  const t = await window.api.invoke('threads.get', id)
  const m = t ? lastMessage(t.messages) : undefined
  if (!t || !m) return
  if (s.openThreadId !== id) s.openThread(id)
  S().openComposer({ mode, threadId: id, messageId: m.id, accountId: t.accountId, placement: 'inline' })
}

async function unsubscribe(): Promise<void> {
  const s = S()
  const id = s.openThreadId ?? s.focusedId
  if (!id) return
  const t = await window.api.invoke('threads.get', id)
  const m = t ? lastMessage(t.messages.filter((x) => x.listUnsubscribe)) ?? lastMessage(t.messages) : undefined
  const targets = parseListUnsubscribe(m?.listUnsubscribe)
  if (!t || !m || (!targets.https && !targets.mailto)) {
    S().toast({ message: 'No unsubscribe link found in this conversation', duration: 3500 })
    return
  }
  if (targets.https) {
    await window.api.invoke('app.openExternal', targets.https)
    S().toast({ message: 'Opened the unsubscribe page in your browser', duration: 4000 })
  } else if (targets.mailto) {
    S().openComposer({ mode: 'new', accountId: t.accountId, init: { to: [{ email: targets.mailto.to }], subject: targets.mailto.subject ?? 'Unsubscribe' } })
    S().toast({ message: 'Unsubscribe request drafted. Send it to finish.', duration: 4000 })
  }
}

function goRole(role: SystemRole): void { closeOverlay(); S().setNav({ kind: 'role', role }) }
function closeOverlay(): void { if (S().overlay) S().setOverlay(null) }

function togglePalette(): void {
  if (S().overlay === 'palette') S().setOverlay(null)
  else useCommandUi.getState().openPalette('commands')
}

const unreadTarget = (): boolean => { const { threads } = targetThreads(); return threads.length > 0 && threads.every((t) => t.unread) }
const mutedTarget = (): boolean => { const { threads } = targetThreads(); return threads.length > 0 && threads.every((t) => t.muted) }
const starredTarget = (): boolean => { const { threads } = targetThreads(); return threads.length > 0 && threads.every((t) => t.starred) }

function move(delta: number): void {
  const s = S()
  // With inbox bundles on, a collapsed bundle is a single stop (see threadlist/bundleNav).
  const stops = bundleStops(s.threads.map((t) => t.id), s.focusedId)
  const id = moveFocus(stops.ids, stops.focusedId, delta)
  if (!id) return
  s.focus(id)
  if (s.openThreadId) s.openThread(id)
  else useCommandUi.getState().setListKbd(true)
  reveal(id)
}

function extend(delta: 1 | -1): void {
  const s = S()
  const r = extendSelection(s.threads.map((t) => t.id), s.focusedId, s.selectedIds, delta)
  useApp.setState({ focusedId: r.focusedId, selectedIds: r.selectedIds })
  reveal(r.focusedId)
}

/** `g l`: put the keyboard cursor on the list (first row if none) without opening anything. */
function focusList(): void {
  const s = S()
  if (s.overlay) s.setOverlay(null)
  ;(document.activeElement as HTMLElement | null)?.blur?.()
  if (!s.focusedId || !s.threads.some((t) => t.id === s.focusedId)) { const id = s.threads[0]?.id ?? null; if (id) s.focus(id) }
  useCommandUi.getState().setListKbd(true)
  reveal(S().focusedId)
}

export const THEMES = ['system', 'light', 'dark'] as const

// ------------------------------------------------------------------ registry

export const HANDLERS: Record<string, Handler> = {
  'nav.next': () => move(1),
  'nav.prev': () => move(-1),
  'nav.open': () => { const s = S(); if (s.focusedId && !expandBundleAt(s.focusedId)) s.openThread(s.focusedId) },
  'nav.back': () => {
    const s = S()
    // A modal overlay (palette, settings, a picker) sits above a floating composer, so it closes
    // first. Only once nothing modal is in front does esc reach the composer ("Exit draft: esc"
    // in the shortcuts sheet), then the reader, then a selection.
    if (s.overlay) s.setOverlay(null)
    else if (s.composers.length) s.closeComposer(s.composers[s.composers.length - 1].id)
    else if (s.openThreadId) s.openThread(null)
    else if (s.selectedIds.length) s.clearSelection()
    else if (!collapseBundleAt(s.focusedId)) useCommandUi.getState().setListKbd(false)
  },
  'nav.list': focusList,
  'nav.top': () => { const s = S(); const id = s.threads[0]?.id ?? null; if (id) { s.focus(id); if (s.openThreadId) s.openThread(id); reveal(id) } },
  'nav.bottom': () => { const s = S(); const id = s.threads[s.threads.length - 1]?.id ?? null; if (id) { s.focus(id); if (s.openThreadId) s.openThread(id); reveal(id) } },
  'go.role': ({ arg }) => { if (arg) goRole(arg as SystemRole) },
  'go.inbox': () => goRole('inbox'),
  'go.sent': () => goRole('sent'),
  'go.drafts': () => goRole('drafts'),
  'go.all': () => goRole('all'),
  'go.starred': () => goRole('starred'),
  'go.spam': () => goRole('spam'),
  'go.trash': () => goRole('trash'),
  'go.reminders': () => { closeOverlay(); S().setNav({ kind: 'snoozed' }) },
  'go.view': ({ arg }) => { if (arg) { closeOverlay(); S().setNav({ kind: 'view', viewId: arg }) } },
  'go.label': ({ arg }) => { if (arg) { closeOverlay(); S().setNav({ kind: 'label', labelId: arg }) } },
  'go.account': ({ arg }) => { if (arg) { closeOverlay(); S().setAccount(arg) } },
  'account.switch': ({ combo }) => {
    const n = Number(combo?.split('+').pop())
    if (Number.isNaN(n)) return
    if (n === 0) { S().setAccount('all'); return }
    const acc = S().accounts[n - 1]
    if (acc) S().setAccount(acc.id)
  },
  'ui.palette': togglePalette,
  'ui.search': () => useCommandUi.getState().openPalette('search'),
  'ui.help': () => S().setOverlay(S().overlay === 'shortcuts' ? null : 'shortcuts'),
  'ui.sidebar': () => useApp.setState((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  'ui.settings': () => S().setOverlay('settings'),
  'account.add': () => {
    S().setOverlay('settings')
    // Convention for the settings feature: jump to a section when this event is handled.
    window.dispatchEvent(new CustomEvent('mailroom:settings-section', { detail: 'accounts' }))
  },
  'sync.now': async () => { await window.api.invoke('sync.now'); S().toast({ message: 'Syncing…', duration: 1800 }) },
  'theme.set': ({ arg }) => { if (arg) void S().updateSettings({ theme: arg as (typeof THEMES)[number] }) },

  'sel.toggle': () => { const s = S(); if (s.focusedId) s.toggleSelect(s.focusedId) },
  'sel.extendDown': () => extend(1),
  'sel.extendUp': () => extend(-1),
  'sel.all': () => {
    const s = S()
    if (s.overlay) return
    // Focus in the reader (not a text field, those never reach here): behave like the OS.
    const ae = typeof document !== 'undefined' ? document.activeElement : null
    if (ae && ae.closest('.reader')) { document.execCommand('selectAll'); return }
    const ids = s.threads.map((t) => t.id)
    if (!ids.length) return
    // Second press clears, like Finder / Gmail's select-all toggle.
    const all = ids.every((i) => s.selectedIds.includes(i))
    useApp.setState({ selectedIds: all ? [] : ids })
    // The native Edit > Select All menu item also fires on a real ⌘A and would paint the whole page blue.
    requestAnimationFrame(() => window.getSelection()?.removeAllRanges())
  },

  'thread.archive': () => { const n = targetIds(S()).length; if (n) return perform({ type: 'archive' }, toastText('archive', n)) },
  'thread.trash': () => { const n = targetIds(S()).length; if (n) return perform({ type: 'trash' }, toastText('trash', n)) },
  'thread.spam': () => { const n = targetIds(S()).length; if (n) return perform({ type: 'spam' }, toastText('spam', n)) },
  'thread.unread': () => { const n = targetIds(S()).length; if (!n) return; return unreadTarget() ? perform({ type: 'markRead' }, toastText('read', n)) : perform({ type: 'markUnread' }, toastText('unread', n)) },
  'thread.markRead': () => { const n = targetIds(S()).length; if (n) return perform({ type: 'markRead' }, toastText('read', n)) },
  'thread.markUnread': () => { const n = targetIds(S()).length; if (n) return perform({ type: 'markUnread' }, toastText('unread', n)) },
  'thread.inbox': () => {
    const s = S()
    const n = targetIds(s).length
    if (!n) return
    const role = s.nav.kind === 'role' ? s.nav.role : null
    if (role === 'trash') return perform({ type: 'untrash' }, toastText('untrash', n))
    if (role === 'spam') return perform({ type: 'notSpam' }, toastText('notSpam', n))
    return perform({ type: 'unarchive' }, toastText('unarchive', n))
  },
  'thread.undo': undoLast,
  'thread.remind': () => { if (targetIds(S()).length) S().setOverlay('snooze') },
  'thread.followup': () => { if (targetIds(S()).length) S().setOverlay('followup') },
  'thread.label': () => { if (targetIds(S()).length) S().setOverlay('label-picker') },
  'thread.star': () => {
    const n = targetIds(S()).length
    if (!n) return
    return starredTarget() ? perform({ type: 'unstar' }, toastText('unstar', n), { silent: true }) : perform({ type: 'star' }, toastText('star', n), { silent: true })
  },
  'thread.unsubscribe': unsubscribe,
  // Local rules, sender-level actions and inbox bundles (features/rules)
  'rule.create': () => openRuleForFocused(),
  'sender.archiveAll': ({ arg }) => archiveAllFrom(arg).then(() => undefined),
  'sender.block': ({ arg }) => blockSender(arg),
  'sender.unsubscribeArchive': ({ arg }) => unsubscribeAndArchive(arg),
  'bundle.label': ({ arg }) => toggleLabelBundle(arg),
  'bundle.sender': ({ arg }) => toggleSenderBundle(arg),
  'thread.move': () => { if (targetIds(S()).length) S().setOverlay('move-picker') },
  'thread.mute': () => {
    const n = targetIds(S()).length
    if (!n) return
    return mutedTarget() ? perform({ type: 'unmute' }, toastText('unmute', n)) : perform({ type: 'mute' }, toastText('mute', n))
  },

  'msg.reply': () => composeFor('reply'),
  'msg.replyAll': () => composeFor('replyAll'),
  'msg.forward': () => composeFor('forward'),
  'msg.copyCode': copyVerificationCode,
  'compose.new': () => { S().openComposer() },
  'person.info': toggleSenderInfo
}

/** Run a command by id. Unknown ids are ignored. */
export function runCommand(id: string, ctx: RunCtx = {}): void {
  const h = HANDLERS[id]
  if (!h) return
  void Promise.resolve(h(ctx)).catch((e) => console.error(`[commands] ${id} failed`, e))
}

/** Native menu command (src/main/menu.ts) -> command id. */
export const MENU_COMMANDS: Record<string, string> = {
  compose: 'compose.new',
  settings: 'ui.settings',
  'command-menu': 'ui.palette',
  search: 'ui.search',
  'toggle-sidebar': 'ui.sidebar',
  'go-inbox': 'go.inbox',
  sync: 'sync.now',
  'add-account': 'account.add'
}

/** Rotate through label colours so new labels are visually distinct. */
export const nextLabelColor = (existing: number): (typeof LABEL_COLORS)[number] => LABEL_COLORS[existing % LABEL_COLORS.length]

export { unreadTarget, starredTarget, mutedTarget }
