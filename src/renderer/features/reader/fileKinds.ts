/**
 * Attachment presentation helpers. Pure — the chip component only maps the result to an icon.
 */
import type { Attachment } from '@shared/types'

export type AttachmentKind = 'image' | 'pdf' | 'doc' | 'sheet' | 'slides' | 'archive' | 'audio' | 'video' | 'code' | 'text' | 'file'

const BY_EXTENSION: Record<string, AttachmentKind> = {
  pdf: 'pdf',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image',
  svg: 'image', avif: 'image', heic: 'image', heif: 'image', tif: 'image', tiff: 'image',
  mp3: 'audio', wav: 'audio', m4a: 'audio', aac: 'audio', flac: 'audio', ogg: 'audio',
  mp4: 'video', mov: 'video', avi: 'video', mkv: 'video', webm: 'video', m4v: 'video',
  doc: 'doc', docx: 'doc', rtf: 'doc', odt: 'doc', pages: 'doc',
  xls: 'sheet', xlsx: 'sheet', csv: 'sheet', tsv: 'sheet', ods: 'sheet', numbers: 'sheet',
  ppt: 'slides', pptx: 'slides', odp: 'slides', key: 'slides',
  zip: 'archive', gz: 'archive', tgz: 'archive', bz2: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive',
  txt: 'text', md: 'text', log: 'text',
  js: 'code', ts: 'code', tsx: 'code', jsx: 'code', json: 'code', html: 'code', css: 'code',
  py: 'code', rb: 'code', go: 'code', rs: 'code', sh: 'code', xml: 'code', yml: 'code', yaml: 'code'
}

/** The file extension, lower-cased, or '' when there is none. */
export function extensionOf(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

/**
 * Classify by MIME type first, then by extension. Real mail routinely ships
 * `application/octet-stream` for everything, so the filename is the better signal there.
 */
export function attachmentKind(mimeType: string, filename = ''): AttachmentKind {
  const mime = (mimeType || '').toLowerCase()
  const ext = extensionOf(filename)

  // A generic MIME type tells us nothing; trust the name.
  const generic = !mime || mime === 'application/octet-stream' || mime === 'binary/octet-stream'
  if (!generic) {
    if (mime.startsWith('image/')) return 'image'
    if (mime.startsWith('audio/')) return 'audio'
    if (mime.startsWith('video/')) return 'video'
    if (mime === 'application/pdf') return 'pdf'
    if (mime.includes('spreadsheet') || mime.includes('excel') || mime === 'text/csv') return 'sheet'
    if (mime.includes('presentation') || mime.includes('powerpoint')) return 'slides'
    if (mime.includes('word') || mime.includes('opendocument.text')) return 'doc'
    if (mime.includes('zip') || mime.includes('compressed') || mime.includes('tar')) return 'archive'
  }

  if (ext && BY_EXTENSION[ext]) return BY_EXTENSION[ext]
  if (!generic && mime.startsWith('text/')) return 'text'
  return 'file'
}

/** Attachments worth showing as chips: inline images referenced by the body are not. */
export const visibleAttachments = (list: Attachment[]): Attachment[] =>
  list.filter((a) => !(a.inline && a.contentId))

/** Kinds the reader can render inline in the preview dialog, without a save-to-disk round trip. */
export const isPreviewable = (kind: AttachmentKind): boolean =>
  kind === 'image' || kind === 'pdf' || kind === 'audio' || kind === 'video' || kind === 'text' || kind === 'code'
