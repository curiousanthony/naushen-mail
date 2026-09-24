import { create } from 'zustand'
import type {
  Account, AppSettings, Counts, Draft, Label, SystemRole, Thread, ThreadAction, ThreadFilter, View
} from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { parseSearchQuery } from './searchQuery'
import { expandLabelIds } from './labels'

/** What the list area is currently showing. */
export type Nav =
  | { kind: 'role'; role: SystemRole }
  | { kind: 'view'; viewId: string }
  | { kind: 'label'; labelId: string }
  | { kind: 'snoozed' }
  | { kind: 'search'; text: string }

export interface Toast {
  id: number
  message: string
  actionLabel?: string
  onAction?: () => void
  /** ms; 0 = sticky */
  duration?: number
}

/** A compose window. `draft` seeds the editor; feature code owns the rest. */
export interface ComposerState {
  id: string
  accountId: string
  mode: 'new' | 'reply' | 'replyAll' | 'forward'
  /** For replies/forwards. */
  threadId?: string
  messageId?: string
  /** Optional initial recipients / subject (e.g. mailto:). */
  init?: Partial<Pick<Draft, 'to' | 'cc' | 'bcc' | 'subject'>>
  /** Restoring a saved draft. */
  draftId?: string
  /** Inline (in reader) vs floating window. */
  placement: 'window' | 'inline'
}

interface AppState {
  ready: boolean
  accounts: Account[]
  labels: Label[]
  views: View[]
  settings: AppSettings
  counts: Counts
  /** 'all' or an account id. */
  accountId: string
  nav: Nav
  threads: Thread[]
  total: number
  loading: boolean
  /** keyboard cursor */
  focusedId: string | null
  selectedIds: string[]
  /** thread shown in the peek/reader */
  openThreadId: string | null
  composers: ComposerState[]
  toasts: Toast[]
  overlay: null | 'palette' | 'settings' | 'shortcuts' | 'snooze' | 'label-picker' | 'view-editor' | 'followup'
  sidebarCollapsed: boolean

  init(): Promise<void>
  refreshMeta(): Promise<void>
  refreshThreads(): Promise<void>
  setNav(nav: Nav): void
  setAccount(id: string): void
  focus(id: string | null): void
  toggleSelect(id: string): void
  clearSelection(): void
  openThread(id: string | null): void
  /** Run an action on threads with an undo toast. Uses selection/focus when ids omitted. */
  act(action: ThreadAction, ids?: string[], toastText?: string): Promise<void>
  openComposer(init?: Partial<ComposerState>): string
  closeComposer(id: string): void
  toast(t: Omit<Toast, 'id'>): void
  dismissToast(id: number): void
  setOverlay(o: AppState['overlay']): void
  updateSettings(patch: Partial<AppSettings>): Promise<void>
}

/** Translate the current nav to a ThreadFilter. Pure; exported for tests and for features. */
export function navToFilter(nav: Nav, accountId: string, views: View[], labels: Label[] = []): ThreadFilter {
  const base: ThreadFilter = accountId === 'all' ? {} : { accountIds: [accountId] }
  switch (nav.kind) {
    case 'role': return { ...base, role: nav.role }
    case 'label': return { ...base, labelIds: expandLabelIds(labels, nav.labelId, accountId) }
    case 'snoozed': return { ...base, onlySnoozed: true }
    case 'search': {
      // Gmail/Notion-Mail-style operators (from:, to:, subject:, has:attachment, is:unread,
      // is:starred, label:, before:, after:) layered on the plain FTS text search.
      const parsed = parseSearchQuery(nav.text, labels)
      return { ...base, ...parsed.filter, text: parsed.text }
    }
    case 'view': {
      const v = views.find((x) => x.id === nav.viewId)
      return { ...(v?.filter ?? {}), ...(accountId === 'all' ? {} : { accountIds: [accountId] }) }
    }
  }
}

let toastSeq = 1
let refreshTimer: ReturnType<typeof setTimeout> | null = null

export const useApp = create<AppState>((set, get) => ({
  ready: false, accounts: [], labels: [], views: [], settings: DEFAULT_SETTINGS, counts: { unread: {} },
  accountId: 'all', nav: { kind: 'role', role: 'inbox' }, threads: [], total: 0, loading: false,
  focusedId: null, selectedIds: [], openThreadId: null, composers: [], toasts: [], overlay: null, sidebarCollapsed: false,

  async init() {
    await get().refreshMeta()
    await get().refreshThreads()
    set({ ready: true })
    window.api.onEvent((e) => {
      if (e.type === 'outbox' && e.status === 'failed') {
        get().toast({
          message: e.error ? `Couldn't send: ${e.error}` : "Couldn't send the message.",
          actionLabel: 'Retry',
          duration: 0, // sticky: a swallowed send failure is exactly what must never go unnoticed
          onAction: () => void window.api.invoke('compose.retry', e.id)
        })
      }
      // Coalesce bursts of sync events.
      if (refreshTimer) return
      refreshTimer = setTimeout(() => { refreshTimer = null; void get().refreshMeta(); void get().refreshThreads() }, 150)
    })
  },

  async refreshMeta() {
    const [accounts, labels, views, settings, counts] = await Promise.all([
      window.api.invoke('accounts.list'), window.api.invoke('labels.list'), window.api.invoke('views.list'),
      window.api.invoke('settings.get'), window.api.invoke('threads.counts')
    ])
    set({ accounts, labels, views, settings, counts })
  },

  async refreshThreads() {
    const { nav, accountId, views, labels } = get()
    set({ loading: true })
    const res = await window.api.invoke('threads.list', { filter: navToFilter(nav, accountId, views, labels), limit: 300 })
    // Drop stale selection.
    const ids = new Set(res.threads.map((t) => t.id))
    set((s) => ({
      threads: res.threads, total: res.total, loading: false,
      selectedIds: s.selectedIds.filter((i) => ids.has(i)),
      focusedId: s.focusedId && ids.has(s.focusedId) ? s.focusedId : res.threads[0]?.id ?? null
    }))
  },

  setNav(nav) { set({ nav, selectedIds: [], openThreadId: null, focusedId: null }); void get().refreshThreads() },
  setAccount(id) { set({ accountId: id, selectedIds: [], openThreadId: null }); void get().refreshThreads() },
  focus(id) { set({ focusedId: id }) },
  toggleSelect(id) { set((s) => ({ selectedIds: s.selectedIds.includes(id) ? s.selectedIds.filter((x) => x !== id) : [...s.selectedIds, id] })) },
  clearSelection() { set({ selectedIds: [] }) },
  openThread(id) { set({ openThreadId: id, focusedId: id ?? get().focusedId }) },

  async act(action, idsArg, toastText) {
    const s = get()
    const ids = idsArg ?? (s.selectedIds.length ? s.selectedIds : s.openThreadId ? [s.openThreadId] : s.focusedId ? [s.focusedId] : [])
    if (!ids.length) return
    // Auto-advance: if the open thread leaves the list, move to the next one.
    const leaving = ['archive', 'trash', 'spam', 'snooze', 'deleteForever'].includes(action.type)
    if (leaving && s.openThreadId && ids.includes(s.openThreadId)) {
      const idx = s.threads.findIndex((t) => t.id === s.openThreadId)
      const next = s.threads.filter((t) => !ids.includes(t.id))[Math.min(idx, s.threads.length - ids.length - 1)]
      set({ openThreadId: next?.id ?? null, focusedId: next?.id ?? null })
    }
    set((st) => ({ selectedIds: st.selectedIds.filter((i) => !ids.includes(i)) }))
    await window.api.invoke('threads.act', ids, action)
    const inverse = INVERSE[action.type]
    if (toastText) get().toast({ message: toastText, actionLabel: inverse ? 'Undo' : undefined, onAction: inverse ? () => void window.api.invoke('threads.act', ids, inverse(action)) : undefined })
  },

  openComposer(init) {
    // Replying/forwarding a thread that already has a composer open for it (e.g. two keyboard
    // or menu paths both firing for one keypress) reuses that composer instead of stacking a
    // duplicate. Plain 'new' composers are exempt — opening several blank drafts is intentional.
    if (init?.mode && init.mode !== 'new' && init.threadId) {
      const existing = get().composers.find((c) => c.mode === init.mode && c.threadId === init.threadId)
      if (existing) return existing.id
    }
    const id = crypto.randomUUID()
    const accountId = init?.accountId ?? (get().accountId !== 'all' ? get().accountId : get().accounts[0]?.id ?? '')
    set((s) => ({ composers: [...s.composers, { mode: 'new', placement: 'window', ...init, id, accountId }] }))
    return id
  },
  closeComposer(id) { set((s) => ({ composers: s.composers.filter((c) => c.id !== id) })) },

  toast(t) {
    const id = toastSeq++
    set((s) => ({ toasts: [...s.toasts, { duration: 5000, ...t, id }] }))
    const d = t.duration ?? 5000
    if (d > 0) setTimeout(() => get().dismissToast(id), d)
  },
  dismissToast(id) { set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })) },
  setOverlay(o) { set({ overlay: o }) },
  async updateSettings(patch) { set({ settings: await window.api.invoke('settings.set', patch) }) }
}))

const INVERSE: Partial<Record<ThreadAction['type'], (a: ThreadAction) => ThreadAction>> = {
  archive: () => ({ type: 'unarchive' }), unarchive: () => ({ type: 'archive' }),
  trash: () => ({ type: 'untrash' }), untrash: () => ({ type: 'trash' }),
  spam: () => ({ type: 'notSpam' }), notSpam: () => ({ type: 'spam' }),
  markRead: () => ({ type: 'markUnread' }), markUnread: () => ({ type: 'markRead' }),
  star: () => ({ type: 'unstar' }), unstar: () => ({ type: 'star' }),
  snooze: () => ({ type: 'unsnooze' })
}
