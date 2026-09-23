/**
 * RFC 5322 / MIME assembly for outgoing mail.
 *
 * Both provider adapters need the same bytes: Gmail's `messages.send` takes a base64url
 * `raw` message, Microsoft Graph's `sendMail` can take `text/plain` MIME as base64. So the
 * composer's `OutgoingMessage` is turned into a real MIME message exactly once, here.
 *
 * Structure produced (nodemailer/lib/mail-composer):
 *   multipart/mixed          (only when there are non-inline attachments)
 *     multipart/related      (only when there are inline `cid:` images)
 *       multipart/alternative
 *         text/plain
 *         text/html
 *       image/*  (Content-ID, inline)
 *     application/*          (attachments)
 */

import MailComposer from 'nodemailer/lib/mail-composer'
import { randomUUID } from 'node:crypto'
import type { Address, OutgoingAttachment, OutgoingMessage } from '@shared/types'

export interface BuildRfc822Options {
  /** `Message-ID` for this message. Generated when omitted. */
  messageId?: string
  /** `In-Reply-To`: the RFC 822 Message-ID header of the message being replied to. */
  inReplyTo?: string
  /** `References` chain of the parent, newest last. The parent's id is appended automatically. */
  references?: string[]
  /** Overrides `Date:`; used by tests and by scheduled sends. */
  date?: Date | number
  /** `Reply-To` when it differs from `from`. */
  replyTo?: Address
  /** Extra headers (e.g. `X-Mailer`). */
  headers?: Record<string, string>
}

export interface BuiltMessage {
  raw: Buffer
  messageId: string
  references: string[]
}

/** `foo@bar` -> `<foo@bar>`; already-bracketed values pass through. */
export function angle(id: string): string {
  const t = id.trim()
  if (!t) return t
  return t.startsWith('<') && t.endsWith('>') ? t : `<${t}>`
}

/** A Message-ID whose right-hand side is the sender's domain, as mail servers expect. */
export function generateMessageId(fromEmail: string): string {
  const domain = fromEmail.split('@')[1]?.trim() || 'mailroom.local'
  return `<${randomUUID()}@${domain}>`
}

/**
 * Compose the full RFC 822 message. Returns the bytes plus the headers the caller must
 * persist so the next reply can continue the `References` chain.
 */
export async function buildRfc822(
  msg: OutgoingMessage,
  from: Address,
  opts: BuildRfc822Options = {}
): Promise<BuiltMessage> {
  const messageId = angle(opts.messageId ?? generateMessageId(from.email))
  const parent = opts.inReplyTo ? angle(opts.inReplyTo) : undefined
  const references = dedupe([...(opts.references ?? []).map(angle), ...(parent ? [parent] : [])])

  const composer = new MailComposer({
    from: addr(from),
    to: addrs(msg.to),
    cc: addrs(msg.cc),
    bcc: addrs(msg.bcc),
    replyTo: opts.replyTo ? addr(opts.replyTo) : undefined,
    subject: msg.subject ?? '',
    // Both alternatives are always present: some clients (and most screen readers) take the
    // text/plain part, and spam filters penalise HTML-only mail.
    text: msg.text && msg.text.trim() ? msg.text : stripTags(msg.html ?? ''),
    html: msg.html ?? '',
    attachments: (msg.attachments ?? []).map(toNodemailerAttachment),
    messageId,
    inReplyTo: parent,
    references: references.length ? references : undefined,
    date: opts.date ? new Date(opts.date) : new Date(),
    headers: opts.headers,
    // Keep the transfer encoding predictable: quoted-printable for text, base64 for binary.
    encoding: 'quoted-printable',
    textEncoding: 'quoted-printable',
    disableFileAccess: true,
    disableUrlAccess: true
  })

  const raw: Buffer = await new Promise((resolve, reject) => {
    composer.compile().build((err: Error | null, message: Buffer) => (err ? reject(err) : resolve(message)))
  })
  return { raw, messageId, references }
}

/** Gmail `users.messages.send` wants base64url with no padding. */
export function toBase64Url(raw: Buffer): string {
  return raw.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Microsoft Graph `sendMail` with `Content-Type: text/plain` wants plain base64. */
export function toBase64(raw: Buffer): string {
  return raw.toString('base64')
}

// ------------------------------------------------------------------ helpers

interface NodemailerAttachment {
  filename: string
  content: Buffer
  contentType: string
  cid?: string
  contentDisposition?: 'inline' | 'attachment'
}

function toNodemailerAttachment(a: OutgoingAttachment): NodemailerAttachment {
  // `cid` makes nodemailer emit Content-ID and wrap the body in multipart/related.
  const cid = a.contentId ? a.contentId.replace(/^<|>$/g, '') : undefined
  return {
    filename: a.filename || 'attachment',
    content: Buffer.from(a.dataBase64 ?? '', 'base64'),
    contentType: a.mimeType || 'application/octet-stream',
    ...(a.inline && cid ? { cid, contentDisposition: 'inline' as const } : { contentDisposition: 'attachment' as const })
  }
}

const addr = (a: Address): { name: string; address: string } => ({ name: a.name ?? '', address: a.email })
const addrs = (list: Address[] | undefined): { name: string; address: string }[] | undefined =>
  list?.length ? list.filter((a) => a?.email).map(addr) : undefined

function dedupe(ids: string[]): string[] {
  const seen = new Set<string>()
  return ids.filter((id) => (id && !seen.has(id) ? (seen.add(id), true) : false))
}

/** Last-resort text alternative when the caller gave us none. */
function stripTags(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|li|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
