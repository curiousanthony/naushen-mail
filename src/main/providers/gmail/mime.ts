/**
 * Outgoing RFC 5322 builder used by send()/saveDraft(). Local fallback on top of nodemailer's MailComposer;
 * the adapter takes a `buildRaw` dependency so the shared `src/main/mime` builder (feat/compose-blocks) can be
 * swapped in without touching adapter logic.
 */
import MailComposer from 'nodemailer/lib/mail-composer'
import type { Address, OutgoingMessage } from '@shared/types'

export interface RawContext {
  from: Address
  /** RFC 822 Message-ID of the message being replied to (with angle brackets). */
  inReplyTo?: string
  references?: string[]
}

export type RawBuilder = (msg: OutgoingMessage, ctx: RawContext) => Promise<Buffer>

const fmt = (a: Address): { name: string; address: string } => ({ name: a.name ?? '', address: a.email })

export const buildRaw: RawBuilder = async (msg, ctx) => {
  const attachments = (msg.attachments ?? []).map((a) => ({
    filename: a.filename,
    content: Buffer.from(a.dataBase64, 'base64'),
    contentType: a.mimeType,
    ...(a.inline && a.contentId ? { cid: a.contentId, contentDisposition: 'inline' } : { contentDisposition: 'attachment' })
  }))
  const composer = new MailComposer({
    from: fmt(ctx.from),
    to: msg.to.map(fmt),
    cc: msg.cc.map(fmt),
    bcc: msg.bcc.map(fmt),
    subject: msg.subject,
    text: msg.text,
    html: msg.html || undefined,
    attachments,
    ...(ctx.inReplyTo ? { inReplyTo: ctx.inReplyTo, references: ctx.references?.length ? ctx.references : [ctx.inReplyTo] } : {})
  })
  const node = composer.compile()
  node.keepBcc = true // Gmail strips Bcc on delivery but needs it in the raw message to address the recipients
  return node.build()
}

export const toBase64Url = (b: Buffer): string => b.toString('base64url')
