import type {
  Account, AppSettings, Contact, Counts, Draft, Label, OutgoingMessage, ProviderKind,
  ScheduledSend, SyncEvent, ThreadAction, ThreadListResult, ThreadQuery, ThreadWithMessages, View
} from './types'

/**
 * The full renderer -> main surface. Implemented in src/main/ipc.ts, exposed on
 * `window.api` by src/preload. Every method is async over IPC.
 *
 * Adding a method: add it here, add the name to API_METHODS, implement in main/ipc.ts.
 */
export interface MailApi {
  // accounts
  'accounts.list'(): Promise<Account[]>
  /** Starts the OAuth flow (opens system browser). `mock` adds a demo account. */
  'accounts.connect'(provider: ProviderKind): Promise<Account>
  'accounts.remove'(accountId: string): Promise<void>

  // labels & views
  'labels.list'(): Promise<Label[]>
  'labels.create'(accountId: string, name: string, color?: string): Promise<Label>
  'labels.update'(labelId: string, patch: { name?: string; color?: string }): Promise<void>
  'labels.delete'(labelId: string): Promise<void>
  'views.list'(): Promise<View[]>
  'views.save'(view: View): Promise<View>
  'views.delete'(viewId: string): Promise<void>

  // threads
  'threads.list'(query: ThreadQuery): Promise<ThreadListResult>
  'threads.get'(threadId: string): Promise<ThreadWithMessages | null>
  'threads.act'(threadIds: string[], action: ThreadAction): Promise<void>
  'threads.counts'(): Promise<Counts>
  'threads.search'(text: string, accountIds?: string[]): Promise<ThreadListResult>
  'attachments.save'(messageId: string, attachmentId: string): Promise<string | null>
  /**
   * Resolves every `inline: true` attachment on a message to a displayable `data:` URL, keyed
   * by `Content-ID` (bracket-stripped, matching what the sanitiser's `cidOf()` extracts from a
   * body's `cid:` src). Used by the reader to swap `cid:` image sources after sanitising —
   * see `sanitizeEmailHtml`'s `cidMap` option. Attachments with no match, or that fail to
   * fetch, are simply absent from the result; the caller leaves the sanitiser's placeholder.
   */
  'messages.inlineImages'(messageId: string): Promise<Record<string, string>>
  /** UTF-8 text of a small text attachment (e.g. a `.ics` meeting invite) without a save dialog. */
  'attachments.getText'(messageId: string, attachmentId: string): Promise<string | null>
  /** The attachment's bytes as a `data:` URL, for previewing in-app without a save dialog. */
  'attachments.getDataUrl'(messageId: string, attachmentId: string): Promise<string | null>
  /** Drag an attachment out to Finder/Desktop. `start: false` only pre-fetches (call on hover);
   *  `start: true` (from dragstart) begins the OS drag. Resolves true once the drag started/was cached. */
  'attachments.dragOut'(messageId: string, attachmentId: string, start: boolean): Promise<boolean>

  // compose
  'compose.send'(msg: OutgoingMessage): Promise<void>
  'compose.schedule'(msg: OutgoingMessage, sendAt: number): Promise<ScheduledSend>
  'compose.cancelScheduled'(id: string): Promise<void>
  'compose.listScheduled'(): Promise<ScheduledSend[]>
  'compose.retry'(id: string): Promise<void>
  'drafts.save'(draft: Draft): Promise<void>
  'drafts.list'(): Promise<Draft[]>
  'drafts.get'(id: string): Promise<Draft | null>
  'drafts.delete'(id: string): Promise<void>
  'contacts.suggest'(prefix: string): Promise<Contact[]>

  // sync / app
  'sync.now'(accountId?: string): Promise<void>
  'settings.get'(): Promise<AppSettings>
  'settings.set'(patch: Partial<AppSettings>): Promise<AppSettings>
  'app.openExternal'(url: string): Promise<void>
  'app.platform'(): Promise<{ platform: string; version: string }>
}

export type ApiMethod = keyof MailApi

export const API_METHODS: ApiMethod[] = [
  'accounts.list', 'accounts.connect', 'accounts.remove',
  'labels.list', 'labels.create', 'labels.update', 'labels.delete',
  'views.list', 'views.save', 'views.delete',
  'threads.list', 'threads.get', 'threads.act', 'threads.counts', 'threads.search', 'attachments.save',
  'messages.inlineImages', 'attachments.getText', 'attachments.getDataUrl',
  'compose.send', 'compose.schedule', 'compose.cancelScheduled', 'compose.listScheduled', 'compose.retry',
  'drafts.save', 'drafts.list', 'drafts.get', 'drafts.delete', 'contacts.suggest',
  'sync.now', 'settings.get', 'settings.set', 'app.openExternal', 'app.platform',
  'attachments.dragOut'
]

/** Parsed from an OS-level `mailto:` link (Naushen Mail registers the scheme). Unsupported mailto
 *  params (e.g. `body`) are dropped — the composer's `init` has no field for them yet. */
export interface MailtoInit {
  to: { email: string }[]
  cc: { email: string }[]
  bcc: { email: string }[]
  subject?: string
}

export interface RendererBridge {
  invoke<K extends ApiMethod>(method: K, ...args: Parameters<MailApi[K]>): ReturnType<MailApi[K]>
  /** Subscribe to main-process push events. Returns an unsubscribe function. */
  onEvent(cb: (e: SyncEvent) => void): () => void
  /** Native menu / global shortcut commands (e.g. 'compose', 'search'). */
  onMenuCommand(cb: (cmd: string) => void): () => void
  /** The OS opened Naushen Mail for a `mailto:` link. */
  onMailto(cb: (init: MailtoInit) => void): () => void
}
