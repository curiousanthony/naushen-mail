/**
 * Turning a composer into an `OutgoingMessage`, and deciding *how* to send it.
 *
 * Both pure: the component owns the IPC calls and the toast, this owns the decisions —
 * which is what needs testing.
 */

import type { Address, OutgoingAttachment, OutgoingMessage } from '@shared/types'
import type { InlineImage, QuotedOriginal } from '@shared/emailhtml'
import { serializeToEmailHtml } from '@shared/emailhtml'

/**
 * `compose.send` applies the undo window itself but returns `void`, so there is no id to
 * cancel with. To offer Undo we schedule the message ourselves for `now + undoSendSeconds`
 * and keep the returned `ScheduledSend.id`.
 */
export type SendPlan =
  /** No undo window configured: fire and forget through `compose.send`. */
  | { kind: 'send' }
  /** Queue at `at`, show "Message sent" + Undo until it leaves. */
  | { kind: 'undoable'; at: number; undoSeconds: number }
  /** Explicit "Schedule send": queue at `at`, toast says when. */
  | { kind: 'scheduled'; at: number }

export function planSend(opts: { undoSendSeconds: number; scheduledAt?: number | null; now?: number }): SendPlan {
  const now = opts.now ?? Date.now()
  if (opts.scheduledAt != null && opts.scheduledAt > now) return { kind: 'scheduled', at: opts.scheduledAt }
  const seconds = Number.isFinite(opts.undoSendSeconds) ? Math.max(0, Math.trunc(opts.undoSendSeconds)) : 0
  if (seconds <= 0) return { kind: 'send' }
  return { kind: 'undoable', at: now + seconds * 1000, undoSeconds: seconds }
}

/** Inline images produced by the serializer become inline MIME parts referenced by `cid:`. */
export function inlineImagesToAttachments(images: InlineImage[]): OutgoingAttachment[] {
  return images.map((img) => ({
    filename: img.filename,
    mimeType: img.mimeType,
    dataBase64: img.dataBase64,
    contentId: img.cid,
    inline: true
  }))
}

export interface BuildOutgoingInput {
  accountId: string
  to: Address[]
  cc: Address[]
  bcc: Address[]
  subject: string
  /** TipTap JSON. */
  doc: unknown
  /** Sanitised signature HTML, already resolved for the selected account (omit when off). */
  signatureHtml?: string
  quoted?: QuotedOriginal
  /** Paperclip attachments (inline images are appended automatically). */
  attachments?: OutgoingAttachment[]
  inReplyTo?: OutgoingMessage['inReplyTo']
  draftId?: string
  /** Deterministic content-ids for tests. */
  cidPrefix?: string
}

/**
 * Serialise once and assemble the message. Inline images are discovered by the serializer
 * (it rewrites `data:` URIs to `cid:` references) and appended to the attachment list, so
 * nothing else in the app needs to know about content-ids.
 */
export function buildOutgoing(input: BuildOutgoingInput): { message: OutgoingMessage; text: string } {
  const { html, text, inlineImages } = serializeToEmailHtml(input.doc, {
    signatureHtml: input.signatureHtml,
    quoted: input.quoted,
    ...(input.cidPrefix ? { cidPrefix: input.cidPrefix } : {})
  })
  const attachments = [...(input.attachments ?? []), ...inlineImagesToAttachments(inlineImages)]
  const message: OutgoingMessage = {
    accountId: input.accountId,
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    subject: input.subject,
    html,
    text,
    ...(attachments.length ? { attachments } : {}),
    ...(input.inReplyTo ? { inReplyTo: input.inReplyTo } : {}),
    ...(input.draftId ? { draftId: input.draftId } : {})
  }
  return { message, text }
}
