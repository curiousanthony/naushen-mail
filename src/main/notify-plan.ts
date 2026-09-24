/**
 * Pure planning logic for native notifications / Dock badge / window bounds. No Electron imports,
 * so it is unit-tested directly (tests/main/native.test.ts).
 */

export type NotifyMode = 'off' | 'all' | 'people'

export interface InboxSnapshotEntry {
  threadId: string
  lastMessageAt: number
}

export interface Candidate {
  threadId: string
  accountId: string
  lastMessageAt: number
  unread: boolean
  fromName: string
  fromEmail: string
  subject: string
  snippet: string
  /** Sender is one of the user's own addresses (a reply they sent, a sent-to-self copy). */
  fromSelf: boolean
  /** List-Unsubscribe present or a noreply-style sender: a machine, not a person. */
  automated: boolean
}

export interface ViewState {
  windowFocused: boolean
  /** 'all' or an account id. */
  accountId: string
  /** True when the visible list is the Inbox. */
  inInbox: boolean
}

/** What has changed since the last look at the inbox: threads that are new, or have a newer message. */
export function diffInbox(
  seen: Map<string, number>, current: InboxSnapshotEntry[]
): { fresh: InboxSnapshotEntry[]; next: Map<string, number> } {
  const next = new Map<string, number>()
  const fresh: InboxSnapshotEntry[] = []
  for (const e of current) {
    next.set(e.threadId, e.lastMessageAt)
    const prev = seen.get(e.threadId)
    if (prev === undefined || e.lastMessageAt > prev) fresh.push(e)
  }
  return { fresh, next }
}

const AUTOMATED_SENDER = /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|notifications?|mailer-daemon|newsletter|news|updates?|digest|bounce)/i
export function looksAutomated(email: string, hasListUnsubscribe: boolean): boolean {
  return hasListUnsubscribe || AUTOMATED_SENDER.test(email.split('@')[0] ?? '')
}

export function shouldSuppressForView(c: Pick<Candidate, 'accountId'>, v: ViewState): boolean {
  return v.windowFocused && v.inInbox && (v.accountId === 'all' || v.accountId === c.accountId)
}

export type NotifyPlan =
  | { kind: 'none' }
  | { kind: 'single'; threadId: string; accountId: string; title: string; body: string }
  | { kind: 'burst'; count: number; title: string; body: string; threadId: string }

/** Plain text only: notification bodies never carry HTML or long runs of whitespace. */
export function cleanSnippet(s: string, max = 140): string {
  const t = s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/[​-‏͏­]/g, '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

export function planNotification(candidates: Candidate[], mode: NotifyMode, view: ViewState): NotifyPlan {
  if (mode === 'off') return { kind: 'none' }
  const eligible = candidates
    .filter((c) => c.unread && !c.fromSelf)
    .filter((c) => mode === 'all' || !c.automated)
    .filter((c) => !shouldSuppressForView(c, view))
    .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
  if (eligible.length === 0) return { kind: 'none' }
  const top = eligible[0]
  if (eligible.length === 1) {
    return {
      kind: 'single', threadId: top.threadId, accountId: top.accountId,
      title: top.fromName || top.fromEmail, body: [top.subject || '(no subject)', cleanSnippet(top.snippet)].filter(Boolean).join('\n')
    }
  }
  const senders = [...new Set(eligible.map((c) => c.fromName || c.fromEmail))]
  const shown = senders.slice(0, 3).join(', ')
  return {
    kind: 'burst', count: eligible.length, threadId: top.threadId,
    title: `${eligible.length} new messages`,
    body: senders.length > 3 ? `${shown} and ${senders.length - 3} more` : shown
  }
}

/** Dock badge text for an unread Inbox count ('' clears it). */
export function badgeText(unread: number, enabled: boolean): string {
  if (!enabled || !Number.isFinite(unread) || unread <= 0) return ''
  return unread > 9999 ? '9999+' : String(Math.floor(unread))
}

// ---------------------------------------------------------------- window bounds

export interface SavedBounds { x: number; y: number; width: number; height: number; maximized?: boolean }
export interface Rect { x: number; y: number; width: number; height: number }

/** Saved bounds if still (mostly) on a connected display, else undefined so the OS centres the window. */
export function restoreBounds(saved: unknown, workAreas: Rect[], min = { width: 900, height: 560 }): SavedBounds | undefined {
  if (!saved || typeof saved !== 'object') return undefined
  const s = saved as SavedBounds
  if (![s.x, s.y, s.width, s.height].every((n) => Number.isFinite(n))) return undefined
  const width = Math.max(min.width, Math.round(s.width))
  const height = Math.max(min.height, Math.round(s.height))
  const onScreen = workAreas.some((a) => {
    const ox = Math.min(s.x + width, a.x + a.width) - Math.max(s.x, a.x)
    const oy = Math.min(s.y + height, a.y + a.height) - Math.max(s.y, a.y)
    return ox >= 200 && oy >= 120
  })
  return onScreen ? { x: Math.round(s.x), y: Math.round(s.y), width, height, maximized: !!s.maximized } : undefined
}

// ---------------------------------------------------------------- files

/** Attachment filename made safe to use as a path component (drops separators, control chars, dots-only). */
export function safeFileName(name: string, fallback = 'attachment'): string {
  const base = (name.replace(/\\/g, '/').split('/').pop() ?? '').replace(/[\u0000-\u001f<>:"|?*]/g, '_').trim()
  return base && !/^\.+$/.test(base) ? base.slice(0, 200) : fallback
}
