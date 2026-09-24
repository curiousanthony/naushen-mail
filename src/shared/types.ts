/**
 * Provider-agnostic domain model shared by main, preload and renderer.
 *
 * Local IDs are deterministic: `${accountId}:${remoteId}` (see makeId). Threads are
 * never merged across accounts. Timestamps are epoch milliseconds.
 */

export type ProviderKind = 'gmail' | 'outlook' | 'mock'

export interface Address {
  name?: string
  email: string
}

export interface Account {
  id: string
  provider: ProviderKind
  email: string
  name: string
  /** Hex colour used for the account avatar / dot (fallback when avatarUrl is absent). */
  color: string
  /** Profile photo from the provider (Google's userinfo `picture`, Graph's `/me/photo`), if any. */
  avatarUrl?: string
  createdAt: number
  /** Opaque incremental-sync cursor (Gmail historyId / Graph deltaLink bundle). */
  syncCursor: string | null
  lastSyncAt: number | null
  status: 'ok' | 'syncing' | 'error' | 'reauth'
  statusMessage?: string
}

export type SystemRole =
  | 'inbox'
  | 'sent'
  | 'drafts'
  | 'trash'
  | 'spam'
  | 'archive'
  | 'starred'
  | 'important'
  | 'all'

export interface Label {
  id: string
  accountId: string
  remoteId: string
  name: string
  /** One of the Notion-ish label colours (see LABEL_COLORS) or undefined. */
  color?: LabelColor
  kind: 'system' | 'user'
  role?: SystemRole
}

export const LABEL_COLORS = [
  'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'
] as const
export type LabelColor = (typeof LABEL_COLORS)[number]

export interface Attachment {
  id: string
  filename: string
  mimeType: string
  size: number
  /** For inline images referenced as cid: in the HTML body. */
  contentId?: string
  inline: boolean
}

export interface Message {
  id: string
  threadId: string
  accountId: string
  remoteId: string
  from: Address
  to: Address[]
  cc: Address[]
  bcc: Address[]
  replyTo?: Address
  subject: string
  date: number
  snippet: string
  /** Raw (unsanitised) HTML body. Sanitise in the renderer before display. */
  bodyHtml: string | null
  bodyText: string | null
  attachments: Attachment[]
  unread: boolean
  /** RFC 822 headers — the only cross-provider threading primitives. */
  messageIdHeader?: string
  inReplyTo?: string
  references?: string[]
  /** List-Unsubscribe header value when present. */
  listUnsubscribe?: string
  labelIds: string[]
  isDraft: boolean
}

export interface Thread {
  id: string
  accountId: string
  remoteId: string
  subject: string
  snippet: string
  lastMessageAt: number
  messageCount: number
  unread: boolean
  starred: boolean
  hasAttachments: boolean
  labelIds: string[]
  participants: Address[]
  /** Local-only: hidden from the inbox until this time. */
  snoozedUntil: number | null
  /** Local-only: "remind me if no reply" timestamp. */
  reminderAt: number | null
  /** Local-only: set once a "follow up if no reply" deadline passed without an inbound reply ("No reply yet"). */
  followUpFiredAt?: number | null
}

export interface ThreadWithMessages extends Thread {
  messages: Message[]
}

// ---------------------------------------------------------------- Views / queries

/** A "View" is a saved filter shown as a tab above the inbox and in the sidebar. */
export interface View {
  id: string
  name: string
  emoji?: string
  color?: LabelColor
  filter: ThreadFilter
  position: number
  showInSidebar: boolean
  showAsTab: boolean
}

export interface ThreadFilter {
  accountIds?: string[]
  /** Match threads having ANY of these label ids. */
  labelIds?: string[]
  role?: SystemRole
  from?: string[]
  to?: string[]
  subjectContains?: string[]
  hasAttachment?: boolean
  unread?: boolean
  starred?: boolean
  /** Full-text query (FTS over subject/snippet/body/participants). */
  text?: string
  /** true => include snoozed threads (Snoozed view). false/undefined => hide them. */
  includeSnoozed?: boolean
  onlySnoozed?: boolean
  after?: number
  before?: number
}

export interface ThreadQuery {
  filter: ThreadFilter
  limit?: number
  offset?: number
}

export interface ThreadListResult {
  threads: Thread[]
  total: number
}

export interface Counts {
  /** unread counts keyed by `${accountId|'all'}:${role|labelId}` */
  unread: Record<string, number>
}

// ---------------------------------------------------------------- Actions

export type ThreadAction =
  | { type: 'archive' }
  | { type: 'unarchive' } // move back to inbox
  | { type: 'trash' }
  | { type: 'untrash' }
  | { type: 'spam' }
  | { type: 'notSpam' }
  | { type: 'markRead' }
  | { type: 'markUnread' }
  | { type: 'star' }
  | { type: 'unstar' }
  | { type: 'addLabel'; labelId: string }
  | { type: 'removeLabel'; labelId: string }
  | { type: 'snooze'; until: number } // local only
  | { type: 'unsnooze' } // local only
  | { type: 'remind'; at: number | null } // local only
  | { type: 'deleteForever' }

// ---------------------------------------------------------------- Compose

export interface OutgoingAttachment {
  filename: string
  mimeType: string
  /** base64 (no data: prefix) */
  dataBase64: string
  contentId?: string
  inline?: boolean
}

export interface OutgoingMessage {
  accountId: string
  to: Address[]
  cc: Address[]
  bcc: Address[]
  subject: string
  html: string
  text: string
  attachments?: OutgoingAttachment[]
  /** When replying/forwarding. */
  inReplyTo?: { threadId: string; messageId: string; mode: 'reply' | 'replyAll' | 'forward' }
  /** Existing remote draft id to replace/send. */
  draftId?: string
  /** Local-only: arm "follow up if no reply" this many days after the message actually leaves. */
  followUpDays?: number
}

export interface Draft extends Omit<OutgoingMessage, 'html' | 'text'> {
  id: string
  /** TipTap JSON document so the editor can be restored losslessly. */
  doc: unknown
  html: string
  text: string
  updatedAt: number
}

export interface ScheduledSend {
  id: string
  message: OutgoingMessage
  sendAt: number
  status: 'pending' | 'sent' | 'failed' | 'cancelled'
  error?: string
}

// ---------------------------------------------------------------- Settings

/** How an opened thread is presented — Settings → Inbox → Thread style (research §1.5). */
export type ThreadStyle = 'side' | 'center' | 'full'

export interface AppSettings {
  theme: 'system' | 'light' | 'dark'
  /** Optional so settings saved before this existed still load; treat a missing value as 'side'. */
  threadStyle?: ThreadStyle
  /** Show threads grouped by date bucket. */
  groupByDate: boolean
  density: 'comfortable' | 'compact'
  blockRemoteImages: boolean
  /** Sender/recipient photos in the thread list and reader (via Gravatar; see lib/avatar.ts).
   *  Off by default -- Notion Mail itself never showed them, and it's one more thing quietly
   *  pinging an external service per contact. */
  showAvatars: boolean
  undoSendSeconds: 0 | 5 | 10 | 20 | 30
  signatureHtml: Record<string, string> // accountId -> html
  /** OAuth client configuration supplied by the user (never bundled). */
  oauth: {
    googleClientId: string
    googleClientSecret: string
    microsoftClientId: string
  }
  markReadOnOpen: boolean
  notifications: boolean
  /** How often each reminder / send-later / follow-up preset was picked (drives "most used" ordering). Optional: older settings lack it. */
  timePresetUsage?: Record<string, number>
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  threadStyle: 'side',
  groupByDate: true,
  density: 'comfortable',
  blockRemoteImages: true,
  showAvatars: false,
  undoSendSeconds: 10,
  signatureHtml: {},
  oauth: { googleClientId: '', googleClientSecret: '', microsoftClientId: '' },
  markReadOnOpen: true,
  notifications: true
}

// ---------------------------------------------------------------- Helpers

export const makeId = (accountId: string, remoteId: string): string => `${accountId}:${remoteId}`

/** Contact suggestion for the recipient autocomplete. */
export interface Contact extends Address {
  lastUsedAt: number
  useCount: number
}

export type SyncEvent =
  | { type: 'changed'; accountId?: string; threadIds?: string[] }
  | { type: 'account-status'; accountId: string }
  | { type: 'outbox'; id: string; status: ScheduledSend['status']; error?: string }
