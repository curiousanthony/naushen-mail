import type { Address, Attachment, Label, LabelColor, Message, SystemRole } from '@shared/types'
import { makeId } from '@shared/types'
import type { NormalizedThread } from '../types'
import type { GraphAttachment, GraphEmailAddress, GraphHeader, GraphMessage, WellKnown } from './types'

// ------------------------------------------------------------------ folders <-> roles

export const FOLDER_ROLE: Record<WellKnown, { role: SystemRole; name: string }> = {
  inbox: { role: 'inbox', name: 'Inbox' },
  sentitems: { role: 'sent', name: 'Sent' },
  drafts: { role: 'drafts', name: 'Drafts' },
  deleteditems: { role: 'trash', name: 'Trash' },
  junkemail: { role: 'spam', name: 'Spam' },
  archive: { role: 'archive', name: 'Archive' }
}

export const wellKnownForRole = (role: SystemRole): WellKnown | undefined =>
  (Object.keys(FOLDER_ROLE) as WellKnown[]).find((k) => FOLDER_ROLE[k].role === role)

export const CATEGORY_PREFIX = 'cat:'
export const categoryRemoteId = (displayName: string): string => `${CATEGORY_PREFIX}${displayName}`
export const categoryNameFromRemoteId = (remoteId: string): string | null =>
  remoteId.startsWith(CATEGORY_PREFIX) ? remoteId.slice(CATEGORY_PREFIX.length) : null

// ------------------------------------------------------------------ category colours

/**
 * Outlook category presets (preset0..preset24) -> our 9 Notion-ish label colours.
 * 0 Red 1 Orange 2 Brown 3 Yellow 4 Green 5 Teal 6 Olive 7 Blue 8 Purple 9 Cranberry 10 Steel 11 DarkSteel 12 Gray 13 DarkGray
 * 14 Black 15 DarkRed 16 DarkOrange 17 DarkBrown 18 DarkYellow 19 DarkGreen 20 DarkTeal 21 DarkOlive 22 DarkBlue 23 DarkPurple 24 DarkCranberry
 */
const PRESET_TO_COLOR: LabelColor[] = [
  'red', 'orange', 'brown', 'yellow', 'green', 'blue', 'green', 'blue', 'purple', 'pink',
  'gray', 'gray', 'gray', 'gray', 'gray', 'red', 'orange', 'brown', 'yellow', 'green',
  'blue', 'green', 'blue', 'purple', 'pink'
]

export function colorFromPreset(preset?: string | null): LabelColor | undefined {
  const m = /^preset(\d+)$/i.exec(preset ?? '')
  return m ? PRESET_TO_COLOR[Number(m[1])] : undefined
}

const COLOR_TO_PRESET: Record<LabelColor, string> = {
  red: 'preset0', orange: 'preset1', brown: 'preset2', yellow: 'preset3', green: 'preset4',
  blue: 'preset7', purple: 'preset8', pink: 'preset9', gray: 'preset12'
}

/** Our colour -> Outlook preset; unknown / undefined => 'none'. */
export function presetFromColor(color?: string): string {
  return (color && COLOR_TO_PRESET[color as LabelColor]) || 'none'
}

// ------------------------------------------------------------------ addresses

export function toAddress(a?: GraphEmailAddress): Address | null {
  const email = a?.emailAddress?.address?.trim()
  if (!email) return null
  const name = a?.emailAddress?.name?.trim()
  return name && name.toLowerCase() !== email.toLowerCase() ? { name, email } : { email }
}

export function toAddresses(list?: GraphEmailAddress[]): Address[] {
  return (list ?? []).map(toAddress).filter((x): x is Address => x !== null)
}

export const toGraphRecipient = (a: Address): GraphEmailAddress => ({ emailAddress: a.name ? { address: a.email, name: a.name } : { address: a.email } })

// ------------------------------------------------------------------ headers

export interface HeaderInfo { messageIdHeader?: string; inReplyTo?: string; references?: string[]; listUnsubscribe?: string }

export function parseHeaders(headers?: GraphHeader[]): HeaderInfo {
  const out: HeaderInfo = {}
  for (const h of headers ?? []) {
    switch (h.name.toLowerCase()) {
      case 'message-id': out.messageIdHeader = h.value.trim(); break
      case 'in-reply-to': out.inReplyTo = h.value.trim(); break
      case 'references': out.references = h.value.split(/\s+/).filter(Boolean); break
      case 'list-unsubscribe': out.listUnsubscribe = h.value.trim(); break
    }
  }
  return out
}

// ------------------------------------------------------------------ normalisation

export interface NormalizeContext {
  accountId: string
  /** Graph folder id -> role (only for the well-known folders we resolved). */
  folderRole: (folderId?: string) => { wk: WellKnown; role: SystemRole } | undefined
  /** Category display names that exist in masterCategories (=> we have a user label for them). */
  knownCategories: ReadonlySet<string>
}

const roleLabelId = (accountId: string, wk: WellKnown): string => makeId(accountId, wk)

const msTime = (m: GraphMessage): number => {
  const t = Date.parse(m.receivedDateTime ?? m.sentDateTime ?? m.createdDateTime ?? '')
  return Number.isNaN(t) ? 0 : t
}

/** Stable chronological order: received time, then conversationIndex (grows with each reply), then id. */
export function sortMessages(ms: GraphMessage[]): GraphMessage[] {
  return [...ms].sort((a, b) => msTime(a) - msTime(b) || (a.conversationIndex ?? '').length - (b.conversationIndex ?? '').length || a.id.localeCompare(b.id))
}

function toAttachments(list?: GraphAttachment[]): Attachment[] {
  return (list ?? [])
    .filter((a) => a['@odata.type'] === undefined || /fileAttachment|itemAttachment|referenceAttachment/i.test(a['@odata.type']))
    .map((a) => ({
      id: a.id, filename: a.name ?? 'attachment', mimeType: a.contentType ?? 'application/octet-stream', size: a.size ?? 0,
      contentId: a.contentId ? a.contentId.replace(/^<|>$/g, '') : undefined, inline: !!a.isInline
    }))
}

export function normalizeMessage(m: GraphMessage, threadId: string, ctx: NormalizeContext): Message {
  const folder = ctx.folderRole(m.parentFolderId)
  const labelIds: string[] = []
  if (folder) labelIds.push(roleLabelId(ctx.accountId, folder.wk))
  for (const c of m.categories ?? []) if (ctx.knownCategories.has(c)) labelIds.push(makeId(ctx.accountId, categoryRemoteId(c)))
  const contentType = (m.body?.contentType ?? 'html').toLowerCase()
  const hdr: HeaderInfo = parseHeaders(m.internetMessageHeaders)
  const replyTo = toAddress(m.replyTo?.[0]) ?? undefined
  return {
    id: makeId(ctx.accountId, m.id), threadId, accountId: ctx.accountId, remoteId: m.id,
    from: toAddress(m.from) ?? toAddress(m.sender) ?? { email: '' },
    to: toAddresses(m.toRecipients), cc: toAddresses(m.ccRecipients), bcc: toAddresses(m.bccRecipients),
    replyTo, subject: m.subject ?? '', date: msTime(m), snippet: (m.bodyPreview ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
    bodyHtml: m.body ? (contentType === 'html' ? m.body.content ?? '' : null) : null,
    bodyText: m.body ? (contentType === 'html' ? null : m.body.content ?? '') : null,
    attachments: toAttachments(m.attachments),
    unread: m.isRead === false && !m.isDraft,
    messageIdHeader: hdr.messageIdHeader ?? m.internetMessageId,
    inReplyTo: hdr.inReplyTo, references: hdr.references, listUnsubscribe: hdr.listUnsubscribe,
    labelIds, isDraft: !!m.isDraft
  }
}

/**
 * Build a NormalizedThread from every message of one conversation.
 *
 * Label rules (thread labels are the union over "live" messages, i.e. not in Trash/Spam):
 *  - if at least one message is live, Trash/Spam messages are dropped from the thread entirely (they'd otherwise
 *    hide the whole conversation from Inbox in the store's view filters);
 *  - if every message is in Deleted Items => thread gets the trash label; if every message is in Junk => spam label.
 * Returns null when the conversation has no messages (deleted).
 */
export function buildThread(conversationId: string, msgs: GraphMessage[], ctx: NormalizeContext): NormalizedThread | null {
  if (!msgs.length) return null
  const sorted = sortMessages(msgs)
  const roleOf = (m: GraphMessage): SystemRole | undefined => ctx.folderRole(m.parentFolderId)?.role
  const live = sorted.filter((m) => { const r = roleOf(m); return r !== 'trash' && r !== 'spam' })
  const shown = live.length ? live : sorted
  const threadId = makeId(ctx.accountId, conversationId)
  const messages = shown.map((m) => normalizeMessage(m, threadId, ctx))

  const labelIds = new Set<string>()
  if (live.length) {
    for (const m of messages) for (const l of m.labelIds) labelIds.add(l)
  } else {
    const anyTrash = sorted.some((m) => roleOf(m) === 'trash')
    labelIds.add(roleLabelId(ctx.accountId, anyTrash ? 'deleteditems' : 'junkemail'))
    for (const m of messages) for (const l of m.labelIds) if (l.includes(`:${CATEGORY_PREFIX}`)) labelIds.add(l)
  }

  const first = messages[0]
  const last = [...messages].reverse().find((m) => !m.isDraft) ?? messages[messages.length - 1]
  const participants: Address[] = []
  for (const m of messages) for (const a of [m.from, ...m.to]) if (a.email && !participants.some((p) => p.email.toLowerCase() === a.email.toLowerCase())) participants.push(a)

  return {
    thread: {
      id: threadId, accountId: ctx.accountId, remoteId: conversationId,
      subject: first.subject || last.subject || '(no subject)', snippet: last.snippet, lastMessageAt: Math.max(...messages.map((m) => m.date)),
      messageCount: messages.length, unread: messages.some((m) => m.unread),
      starred: shown.some((m) => m.flag?.flagStatus === 'flagged'),
      hasAttachments: shown.some((m, i) => (messages[i].attachments.length ? messages[i].attachments.some((a) => !a.inline) : !!m.hasAttachments)),
      labelIds: [...labelIds], participants
    },
    messages
  }
}
