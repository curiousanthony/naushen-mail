/**
 * Attachment helpers: reading picked/dropped files into the base64 payloads
 * `OutgoingMessage` wants, and the display bits (size, icon class, image test).
 *
 * The pure parts are exported separately from the `File`-reading part so they can be
 * unit-tested without a DOM.
 */

import type { OutgoingAttachment } from '@shared/types'

/** A paperclip attachment held by an open composer. */
export interface PendingAttachment extends OutgoingAttachment {
  /** Local id for React keys / removal. */
  id: string
  size: number
}

/** Gmail's limit; Outlook's is 20MB, so warn at the smaller one when it matters. */
export const MAX_TOTAL_BYTES = 25 * 1024 * 1024

/** `1.4 MB`, `812 KB`, `0 bytes` — the composer chip label. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 bytes'
  if (bytes < 1024) return `${Math.round(bytes)} ${bytes === 1 ? 'byte' : 'bytes'}`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++ }
  return `${value >= 10 || Number.isInteger(value) ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

export function totalBytes(list: { size: number }[]): number {
  return list.reduce((sum, a) => sum + (Number.isFinite(a.size) ? a.size : 0), 0)
}

/** True when the total exceeds what providers accept — shown as a warning, not a block. */
export function isOverSizeLimit(list: { size: number }[]): boolean {
  return totalBytes(list) > MAX_TOTAL_BYTES
}

export function isImageType(mimeType: string): boolean {
  return /^image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml)$/i.test(mimeType ?? '')
}

/** Short extension badge for the chip: `PDF`, `PNG`, `DOCX`, or `FILE`. */
export function extensionLabel(filename: string): string {
  const ext = /\.([A-Za-z0-9]{1,5})$/.exec(filename ?? '')?.[1]
  return (ext ?? 'file').toUpperCase().slice(0, 4)
}

/** ArrayBuffer -> base64 without blowing the call stack on large files. */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunk = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

let seq = 0
export const nextAttachmentId = (): string => `att-${Date.now().toString(36)}-${++seq}`

/** Read a picked/dropped `File` into a base64 attachment. */
export async function fileToAttachment(file: File): Promise<PendingAttachment> {
  const buffer = await file.arrayBuffer()
  return {
    id: nextAttachmentId(),
    filename: file.name || 'attachment',
    mimeType: file.type || 'application/octet-stream',
    dataBase64: arrayBufferToBase64(buffer),
    size: file.size,
    inline: false
  }
}

/** Read an image `File` into the `data:` URI the editor stores in an image node. */
export async function fileToDataUri(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  return `data:${file.type || 'image/png'};base64,${arrayBufferToBase64(buffer)}`
}

/**
 * Split a drop/paste into images (which become inline blocks in the body) and everything
 * else (which becomes paperclip attachments).
 */
export function partitionFiles(files: File[]): { images: File[]; others: File[] } {
  const images: File[] = []
  const others: File[] = []
  for (const f of files) (isImageType(f.type) ? images : others).push(f)
  return { images, others }
}
