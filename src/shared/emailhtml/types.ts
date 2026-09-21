/**
 * Minimal structural types for the TipTap / ProseMirror JSON that the composer produces.
 *
 * These are deliberately loose: the serializer must never throw on a node it does not
 * know (a future extension, or a draft written by an older build) — unknown nodes fall
 * back to rendering their children, unknown marks are ignored.
 */

export interface DocNode {
  type: string
  attrs?: Record<string, unknown>
  content?: DocNode[]
  marks?: DocMark[]
  text?: string
}

export interface DocMark {
  type: string
  attrs?: Record<string, unknown>
}

/** An image that must be attached to the outgoing MIME message and referenced by `cid:`. */
export interface InlineImage {
  /** Value used in `cid:<cid>` (no angle brackets). */
  cid: string
  filename: string
  mimeType: string
  /** base64 payload, no `data:` prefix. */
  dataBase64: string
}

export interface QuotedOriginal {
  /** Attribution line, e.g. `On 12 Mar 2026 at 09:14, Ada Lovelace wrote:` */
  attribution: string
  /** Original message HTML (already sanitised by the reader) or plain text. */
  html?: string
  text?: string
}

export interface SerializeOptions {
  /** Appended after a spacer, before the quote. Sanitised HTML from settings. */
  signatureHtml?: string
  /** Reply/forward quoting, appended last as `<blockquote type="cite">`. */
  quoted?: QuotedOriginal
  /**
   * Prefix for generated content-ids. Defaults to a random token; pass a fixed value
   * for deterministic output (tests).
   */
  cidPrefix?: string
  /** Max width of the body container in px. Default 640. */
  maxWidth?: number
}

export interface SerializeResult {
  html: string
  text: string
  inlineImages: InlineImage[]
}
