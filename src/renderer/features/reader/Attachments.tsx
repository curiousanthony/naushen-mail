import { useState } from 'react'
import {
  Download, File, FileArchive, FileAudio, FileCode, FileImage, FileSpreadsheet,
  FileText, FileType, FileVideo, Presentation
} from 'lucide-react'
import type { Attachment } from '@shared/types'
import { formatBytes } from '@shared/sanitize'
import { attachmentKind, visibleAttachments, type AttachmentKind } from './fileKinds'

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

/** File chips. Clicking one asks main for a save dialog and writes the file. */
export function Attachments({ messageId, attachments }: Props): JSX.Element | null {
  const [busy, setBusy] = useState<string | null>(null)
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

  return (
    <div className="atts">
      {list.map((a) => {
        const kind = attachmentKind(a.mimeType, a.filename)
        const Icon = ICONS[kind]
        const tint = TINTS[kind]
        return (
          <button
            key={a.id}
            className="att"
            onClick={() => void save(a)}
            disabled={busy === a.id}
            title={`${a.filename} — ${formatBytes(a.size)}`}
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
            <Download className="att__dl" size={14} aria-hidden />
          </button>
        )
      })}
    </div>
  )
}
