/**
 * Gmail `format=full` payloads -> Mailroom Message / Thread.
 * Pure functions (no network, no Electron) so the MIME walk is exhaustively unit-testable.
 */
import type { Address, Attachment, Message } from '@shared/types'
import { makeId } from '@shared/types'
import type { NormalizedThread } from '../types'
import type { GmailHeader, GmailMessage, GmailPart, GmailThread } from './api-types'
import { mapLabelIds } from './labels'
import { decodeBase64UrlBody, decodeEntities, decodeMimeWords, htmlToText, parseAddressList, parseHeaderValue } from './text'

// ------------------------------------------------------------------ headers

export function headerMap(headers: GmailHeader[] | undefined): Map<string, string> {
  const m = new Map<string, string>()
  for (const h of headers ?? []) {
    const k = h.name.toLowerCase()
    if (!m.has(k)) m.set(k, h.value)
  }
  return m
}

const stripAngles = (s: string): string => s.trim().replace(/^<|>$/g, '')

// ------------------------------------------------------------------ MIME walk

interface Collected {
  html: string[]
  text: string[]
  attachments: Attachment[]
}

const empty = (): Collected => ({ html: [], text: [], attachments: [] })

const EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'application/pdf': 'pdf',
  'text/calendar': 'ics', 'message/rfc822': 'eml', 'text/plain': 'txt', 'text/html': 'html'
}

export function attachmentIdOf(partId: string | undefined, attachmentId: string | undefined): string {
  return `${partId ?? ''}:${attachmentId ?? ''}`
}
/** Inverse of attachmentIdOf. Also accepts a bare Gmail attachmentId. */
export function splitAttachmentId(id: string): { partId: string; attachmentId: string } {
  const i = id.indexOf(':')
  return i < 0 ? { partId: '', attachmentId: id } : { partId: id.slice(0, i), attachmentId: id.slice(i + 1) }
}

function isBodyLeaf(part: GmailPart): 'html' | 'text' | null {
  const h = headerMap(part.headers)
  const ct = (part.mimeType ?? parseHeaderValue(h.get('content-type')).value).toLowerCase()
  const disp = parseHeaderValue(h.get('content-disposition'))
  if (disp.value === 'attachment' || part.filename) return null
  if (ct === 'text/html') return 'html'
  if (ct === 'text/plain') return 'text'
  return null
}

function charsetOf(part: GmailPart): string | undefined {
  return parseHeaderValue(headerMap(part.headers).get('content-type')).params['charset']
}

function walk(part: GmailPart): Collected {
  const h = headerMap(part.headers)
  const ct = (part.mimeType ?? parseHeaderValue(h.get('content-type')).value).toLowerCase()

  if (ct.startsWith('multipart/')) {
    const kids = (part.parts ?? []).map(walk)
    const out = empty()
    if (ct === 'multipart/alternative') {
      // RFC 2046: the last renderable alternative is the richest. Prefer html, keep text as its fallback.
      for (const k of kids) out.attachments.push(...k.attachments)
      const htmlKid = [...kids].reverse().find((k) => k.html.length)
      const textKid = [...kids].reverse().find((k) => k.text.length)
      if (htmlKid) out.html = htmlKid.html
      if (textKid) out.text = textKid.text
      else if (htmlKid?.text.length) out.text = htmlKid.text
      return out
    }
    for (const k of kids) { out.html.push(...k.html); out.text.push(...k.text); out.attachments.push(...k.attachments) }
    return out
  }

  const kind = isBodyLeaf(part)
  if (kind) {
    const data = part.body?.data
    const out = empty()
    if (data) {
      const s = decodeBase64UrlBody(data, charsetOf(part))
      ;(kind === 'html' ? out.html : out.text).push(s)
    }
    return out
  }

  // Everything else is an attachment / inline resource when it has an id, a filename or a Content-ID.
  const disp = parseHeaderValue(h.get('content-disposition'))
  const ctype = parseHeaderValue(h.get('content-type'))
  const filename = part.filename || disp.params['filename'] || ctype.params['name'] || ''
  const contentId = h.get('content-id') ? stripAngles(h.get('content-id')!) : undefined
  const hasPayload = !!(part.body?.attachmentId || part.body?.data)
  const out = empty()
  if (!hasPayload && !filename) return out
  if (!filename && !contentId && !part.body?.attachmentId && ct !== 'message/rfc822') return out // e.g. bare delivery-status noise
  const inline = disp.value === 'inline' || (!!contentId && disp.value !== 'attachment')
  out.attachments.push({
    id: attachmentIdOf(part.partId, part.body?.attachmentId),
    filename: decodeMimeWords(filename) || `${ct.startsWith('image/') ? 'image' : 'attachment'}${EXT[ct] ? '.' + EXT[ct] : ''}`,
    mimeType: ct || 'application/octet-stream',
    size: part.body?.size ?? 0,
    contentId,
    inline
  })
  return out
}

export interface ParsedPayload { html: string | null; text: string | null; attachments: Attachment[] }

export function parsePayload(payload: GmailPart | undefined): ParsedPayload {
  if (!payload) return { html: null, text: null, attachments: [] }
  const c = walk(payload)
  const html = c.html.length ? c.html.join('') : null
  const text = c.text.length ? c.text.join('\n') : html ? htmlToText(html) : null
  // An "inline" resource that the HTML never references (Outlook does this) is really a downloadable attachment.
  const attachments = c.attachments.map((a) => {
    if (a.inline && a.contentId && html !== null && !html.toLowerCase().includes(`cid:${a.contentId.toLowerCase()}`)) return { ...a, inline: false }
    if (a.inline && !a.contentId) return { ...a, inline: false }
    return a
  })
  return { html, text, attachments }
}

/**
 * Text/HTML body parts that Gmail returned by reference (`body.attachmentId`, no inline data) because they are
 * large. The adapter downloads them and injects `body.data` before normalising.
 */
export function findLargeBodyParts(payload: GmailPart | undefined): GmailPart[] {
  const out: GmailPart[] = []
  const rec = (p: GmailPart): void => {
    if (p.parts?.length) { p.parts.forEach(rec); return }
    if (isBodyLeaf(p) && !p.body?.data && p.body?.attachmentId) out.push(p)
  }
  if (payload) rec(payload)
  return out
}

// ------------------------------------------------------------------ message

export function normalizeMessage(accountId: string, gm: GmailMessage): Message {
  const h = headerMap(gm.payload?.headers)
  const parsed = parsePayload(gm.payload)
  const labels = gm.labelIds ?? []
  const dateHeader = h.get('date') ? Date.parse(h.get('date')!) : NaN
  const date = gm.internalDate ? Number(gm.internalDate) : Number.isNaN(dateHeader) ? 0 : dateHeader
  const from = parseAddressList(h.get('from'))[0] ?? { email: '' }
  const replyTo = parseAddressList(h.get('reply-to'))[0]
  const refs = h.get('references')?.split(/\s+/).map((s) => s.trim()).filter(Boolean)
  const msg: Message = {
    id: makeId(accountId, gm.id),
    threadId: makeId(accountId, gm.threadId),
    accountId,
    remoteId: gm.id,
    from,
    to: parseAddressList(h.get('to')),
    cc: parseAddressList(h.get('cc')),
    bcc: parseAddressList(h.get('bcc')),
    subject: decodeMimeWords(h.get('subject') ?? '').trim(),
    date,
    snippet: decodeEntities(gm.snippet ?? ''),
    bodyHtml: parsed.html,
    bodyText: parsed.text,
    attachments: parsed.attachments,
    unread: labels.includes('UNREAD'),
    labelIds: mapLabelIds(accountId, labels),
    isDraft: labels.includes('DRAFT')
  }
  if (replyTo) msg.replyTo = replyTo
  const mid = h.get('message-id')?.trim()
  if (mid) msg.messageIdHeader = mid
  const irt = h.get('in-reply-to')?.trim()
  if (irt) msg.inReplyTo = irt
  if (refs?.length) msg.references = refs
  const lu = h.get('list-unsubscribe')?.trim()
  if (lu) msg.listUnsubscribe = lu
  return msg
}

// ------------------------------------------------------------------ thread

const has = (m: GmailMessage, l: string): boolean => (m.labelIds ?? []).includes(l)

function uniqAddresses(list: Address[]): Address[] {
  const seen = new Set<string>()
  const out: Address[] = []
  for (const a of list) {
    const k = a.email.toLowerCase()
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(a)
  }
  return out
}

/**
 * Build the local thread. Gmail keeps trashed/spam messages inside a live conversation but hides them in its own
 * UI; we do the same (unless *every* message is trashed/spam, then the thread itself is).
 */
export function normalizeThread(accountId: string, ownerEmail: string, gt: GmailThread): NormalizedThread | null {
  const all = gt.messages ?? []
  if (!all.length) return null
  const live = all.filter((m) => !has(m, 'TRASH') && !has(m, 'SPAM'))
  const kept = live.length ? live : all
  const messages = kept.map((m) => normalizeMessage(accountId, m))
  const sendable = messages.filter((m) => !m.isDraft)
  const ordering = sendable.length ? sendable : messages
  const last = ordering.reduce((a, b) => (b.date >= a.date ? b : a))
  const first = ordering.reduce((a, b) => (b.date < a.date ? b : a))
  const owner = ownerEmail.toLowerCase()

  const froms = uniqAddresses(ordering.slice().sort((a, b) => a.date - b.date).map((m) => m.from))
  let participants = froms
  if (froms.length && froms.every((a) => a.email.toLowerCase() === owner)) {
    participants = uniqAddresses([...froms, ...ordering.flatMap((m) => m.to)])
  }

  const labelIds = new Set<string>()
  for (const m of messages) for (const l of m.labelIds) labelIds.add(l)
  const starred = kept.some((m) => has(m, 'STARRED'))

  return {
    thread: {
      id: makeId(accountId, gt.id),
      accountId,
      remoteId: gt.id,
      subject: first.subject || '(no subject)',
      snippet: last.snippet || (last.bodyText ?? '').slice(0, 140),
      lastMessageAt: last.date,
      messageCount: messages.length,
      unread: messages.some((m) => m.unread),
      starred,
      hasAttachments: messages.some((m) => m.attachments.some((a) => !a.inline)),
      labelIds: [...labelIds],
      participants
    },
    messages
  }
}
