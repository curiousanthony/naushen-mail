import type { Account, Label, Message, OutgoingMessage, Thread, ThreadAction } from '@shared/types'

/**
 * A thread as normalised by an adapter. IDs are already final local IDs
 * (`makeId(accountId, remoteId)`); label IDs reference labels returned from listLabels().
 */
export interface NormalizedThread {
  thread: Omit<Thread, 'snoozedUntil' | 'reminderAt'>
  messages: Message[]
}

export interface SyncPage {
  threads: NormalizedThread[]
  /** Remote ids of threads that no longer exist (deleted permanently). */
  deletedRemoteThreadIds: string[]
  /** Cursor to persist. Pass back to the next `sync()` call. */
  cursor: string | null
  /** True when more pages are available right now (initial backfill). */
  hasMore: boolean
  /** When true, the sync engine must discard local state for this account first. */
  reset?: boolean
}

/**
 * One adapter instance per connected account. Shape is intentionally *incremental-sync*
 * oriented: Gmail `history.list` and Graph `messages/delta` both fit `sync(cursor)`.
 */
export interface ProviderAdapter {
  readonly kind: Account['provider']
  readonly accountId: string

  /** Fetch system + user labels (Outlook: folders as system labels, categories as user labels). */
  listLabels(): Promise<Label[]>

  /**
   * cursor === null => initial backfill (recent ~500 threads, newest first, paginated via
   * repeated calls that pass back the returned cursor while hasMore is true).
   * Otherwise => incremental changes since cursor.
   */
  sync(cursor: string | null): Promise<SyncPage>

  /** Fully hydrate a thread (all messages with bodies). */
  fetchThread(remoteThreadId: string): Promise<NormalizedThread>

  /** Apply remote-visible actions. Local-only actions (snooze/remind) never reach adapters. */
  applyAction(remoteThreadId: string, action: ThreadAction, ctx: { labels: Label[] }): Promise<void>

  send(msg: OutgoingMessage): Promise<void>
  saveDraft(msg: OutgoingMessage): Promise<{ remoteDraftId: string }>
  deleteDraft(remoteDraftId: string): Promise<void>

  fetchAttachment(remoteMessageId: string, attachmentId: string): Promise<Buffer>

  createLabel(name: string, color?: string): Promise<Label>
  updateLabel(remoteLabelId: string, patch: { name?: string; color?: string }): Promise<void>
  deleteLabel(remoteLabelId: string): Promise<void>

  /** Release resources. */
  dispose?(): void
}

/** Persisted OAuth material (encrypted with Electron safeStorage; see main/auth/tokens.ts). */
export interface StoredTokens {
  accessToken: string
  refreshToken: string
  /** epoch ms */
  expiresAt: number
  scope?: string
}

export interface AdapterFactoryDeps {
  account: Account
  getTokens(): StoredTokens | null
  saveTokens(t: StoredTokens): void
  getSettings(): import('@shared/types').AppSettings
  markReauthNeeded(message: string): void
}
