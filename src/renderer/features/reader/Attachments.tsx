import { useState } from 'react'
import {
  Download, Eye, File, FileArchive, FileAudio, FileCode, FileImage, FileSpreadsheet,
  FileText, FileType, FileVideo, Presentation
} from 'lucide-react'
import type { Attachment } from '@shared/types'
import { formatBytes } from '@shared/sanitize'
import { Tooltip } from '@/features/tooltip'
import { AttachmentPreview } from './AttachmentPreview'
import { attachmentKind, isPreviewable, visibleAttachments, type AttachmentKind } from './fileKinds'

const ICONS: Record<AttachmentKind, typeof File> = {
  image: FileImage,
  pdf: FileType,
  doc: FileText,
  sheet: FileSpreadsheet,
  slides: Presentation,
  archive: FileArchive,
  audio: FileAudio,
  video: FileVideo,
  code: FileCode,
  text: FileText,
  file: File
}

/** Chip tint per kind, so a run of attachments is scannable by shape and colour. */
const TINTS: Record<AttachmentKind, string> = {
  image: 'green', pdf: 'red', doc: 'blue', sheet: 'green', slides: 'orange',
  archive: 'yellow', audio: 'purple', video: 'pink', code: 'gray', text: 'gray', file: 'gray'
}

interface Props {
  messageId: string
  attachments: Attachment[]
}

/**
 * File chips. A previewable kind (image/pdf/audio/video/text/code) opens in-app instead of
 * downloading -- clicking the separate download icon within the chip still saves directly,
 * same as clicking anywhere on a non-previewable chip does.
 */
export function Attachments({ messageId, attachments }: Props): JSX.Element | null {
  const [busy, setBusy] = useState<string | null>(null)
  const [preview, setPreview] = useState<Attachment | null>(null)
  const list = visibleAttachments(attachments)
  if (!list.length) return null

  const save = async (a: Attachment): Promise<void> => {
    if (busy) return
    setBusy(a.id)
    try {
      await window.api.invoke('attachments.save', messageId, a.id)
    } finally {
      setBusy(null)
    }
  }

  const open = (a: Attachment): void => {
    if (isPreviewable(attachmentKind(a.mimeType, a.filename))) setPreview(a)
    else void save(a)
  }

  return (
    <div className="atts">
      {list.map((a) => {
        const kind = attachmentKind(a.mimeType, a.filename)
        const Icon = ICONS[kind]
        const tint = TINTS[kind]
        const previewable = isPreviewable(kind)
        return (
          <Tooltip key={a.id} label={previewable ? `Preview ${a.filename}` : `Download ${a.filename} — ${formatBytes(a.size)}`}>
            <button
              className="att"
              onClick={() => open(a)}
              disabled={busy === a.id}
            >
              <span
                className="att__icon"
                style={{ color: `var(--chip-${tint}-fg)`, background: `var(--chip-${tint}-bg)` }}
              >
                <Icon size={15} aria-hidden />
              </span>
              <span className="att__text">
                <span className="att__name">{a.filename}</span>
                <span className="att__size">{formatBytes(a.size)}</span>
              </span>
              {previewable ? <Eye className="att__dl" size={14} aria-hidden /> : <Download className="att__dl" size={14} aria-hidden />}
            </button>
          </Tooltip>
        )
      })}
      {preview && (
        <AttachmentPreview
          messageId={messageId}
          attachment={preview}
          onClose={() => setPreview(null)}
          onDownload={() => void save(preview)}
        />
      )}
    </div>
  )
}
