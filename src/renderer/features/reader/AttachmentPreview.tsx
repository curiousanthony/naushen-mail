import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, X } from 'lucide-react'
import type { Attachment } from '@shared/types'
import { formatBytes } from '@shared/sanitize'
import { Tooltip } from '@/features/tooltip'
import { attachmentKind } from './fileKinds'

interface Props {
  messageId: string
  attachment: Attachment
  onClose(): void
  onDownload(): void
}

/**
 * `data:<mime>;base64,<data>` -> Blob, decoded by hand rather than `fetch(dataUrl)`: Chromium's
 * `connect-src` CSP check applies to `fetch()` even for a `data:` target (this app's CSP has no
 * `data:` there, only `'self'`), so fetching one hung forever with no error to show for it. Pure
 * string/byte work sidesteps that entirely.
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(dataUrl)
  if (!m) throw new Error('Not a data: URL')
  const [, mime, isBase64, payload] = m
  if (!isBase64) return new Blob([decodeURIComponent(payload)], { type: mime || undefined })
  const binary = atob(payload)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime || undefined })
}

/**
 * In-app preview for an attachment — image/pdf/audio/video/text/code render directly, no
 * save-to-disk round trip. `Attachments.tsx` only opens this for kinds `isPreviewable()` allows;
 * anything else goes straight to the save dialog and never reaches this component.
 */
export function AttachmentPreview({ messageId, attachment, onClose, onDownload }: Props): JSX.Element {
  const { t } = useTranslation('reader')
  const kind = attachmentKind(attachment.mimeType, attachment.filename)
  const [dataUrl, setDataUrl] = useState<string | null | undefined>(undefined) // undefined = loading
  const [text, setText] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    setDataUrl(undefined)
    setText(null)

    if (kind === 'text' || kind === 'code') {
      void window.api.invoke('attachments.getText', messageId, attachment.id).then((res) => {
        if (cancelled) return
        setText(res); setDataUrl(res ? '' : null)
      }).catch(() => { if (!cancelled) setDataUrl(null) })
    } else {
      // The CSP intentionally has no `data:` in frame-src/media-src (unbounded inline content
      // in a source list), only `blob:` -- so a data: URI from IPC gets converted client-side
      // before it can be used as an <iframe>/<audio>/<video> src. Images alone could stay on
      // data: (img-src does allow it) but blob: is used uniformly for one code path.
      void window.api.invoke('attachments.getDataUrl', messageId, attachment.id).then((res) => {
        if (cancelled) return
        if (!res) { setDataUrl(null); return }
        objectUrl = URL.createObjectURL(dataUrlToBlob(res))
        setDataUrl(objectUrl)
      }).catch(() => { if (!cancelled) setDataUrl(null) })
    }
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [messageId, attachment.id, kind])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const body = (): JSX.Element => {
    if (dataUrl === undefined) return <div className="attprev__status">{t('preview.loading')}</div>
    if (dataUrl === null) return <div className="attprev__status">{t('preview.failed')}</div>
    switch (kind) {
      case 'image': return <img className="attprev__img" src={dataUrl} alt={attachment.filename} />
      case 'pdf': return <iframe className="attprev__frame" src={dataUrl} title={attachment.filename} />
      case 'audio': return <audio className="attprev__audio" controls src={dataUrl} />
      case 'video': return <video className="attprev__video" controls src={dataUrl} />
      case 'text': case 'code': return <pre className="attprev__text selectable">{text}</pre>
      default: return <div className="attprev__status">{t('preview.unavailable')}</div>
    }
  }

  return (
    <div className="attprev__scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="attprev" role="dialog" aria-modal="true" aria-label={attachment.filename}>
        <header className="attprev__head">
          <span className="attprev__title">
            <span className="attprev__name">{attachment.filename}</span>
            <span className="attprev__size">{formatBytes(attachment.size)}</span>
          </span>
          <Tooltip label={t('preview.download')}>
            <button className="attprev__btn" onClick={onDownload} aria-label={t('preview.download')}>
              <Download size={16} aria-hidden />
            </button>
          </Tooltip>
          <Tooltip label={t('preview.close')} shortcut="Esc">
            <button className="attprev__btn" onClick={onClose} aria-label={t('preview.closePreview')}>
              <X size={17} aria-hidden />
            </button>
          </Tooltip>
        </header>
        <div className="attprev__body">{body()}</div>
      </div>
    </div>
  )
}
