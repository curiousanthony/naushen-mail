import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Paperclip, Star } from 'lucide-react'
import { useApp } from '@/lib/store'
import { displayName, fullDate, initials } from '@/lib/format'
import { chipStyle } from '@/lib/labels'
import { gravatarUrl } from '@/lib/avatar'
import { rowLabels } from '../threadlist/lib'
import { usePreviewStore } from './previewStore'
import { computePreviewPosition, type Point, type Size } from './position'
import './preview.css'

/**
 * The one preview-card DOM node for the whole app (mounted once in App.tsx, alongside
 * <TooltipHost/>). Thread rows never render their own card — they just push
 * { threadId, x, y } into the shared store (see previewStore.ts) and this host looks the thread
 * up, measures the card, positions it, and renders it.
 *
 * Built entirely from data already in the thread-list store (subject/snippet/participants/etc.)
 * — never fetches a thread's full body on hover, so hovering rapidly down a long list costs
 * nothing beyond the local lookup.
 *
 * Two-pass sizing: the card is rendered off-screen (`visibility: hidden`) whenever its content
 * could have changed size, measured, then repositioned on every cursor update using that cached
 * size — so tracking the mouse never re-triggers a layout read on each mousemove, only the
 * (much rarer) content changes do. Same measure-then-place trick as tooltip/TooltipHost.tsx.
 */
export function PreviewHost(): JSX.Element | null {
  const visible = usePreviewStore((s) => s.visible)
  const threadId = usePreviewStore((s) => s.threadId)
  const x = usePreviewStore((s) => s.x)
  const y = usePreviewStore((s) => s.y)

  const thread = useApp((s) => (threadId ? s.threads.find((t) => t.id === threadId) : undefined))
  const labels = useApp((s) => s.labels)
  const accounts = useApp((s) => s.accounts)
  const showAvatars = useApp((s) => s.settings.showAvatars)

  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<Size | null>(null)
  const [pos, setPos] = useState<Point | null>(null)
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null)

  const myEmails = useMemo(() => new Set(accounts.map((a) => a.email.toLowerCase())), [accounts])
  const show = visible && !!thread

  // Re-measure only when the card's own content could have changed its footprint.
  useLayoutEffect(() => {
    if (!show || !ref.current) { setSize(null); return }
    const r = ref.current.getBoundingClientRect()
    setSize({ width: r.width, height: r.height })
  }, [show, thread?.id, thread?.subject, thread?.snippet, thread?.labelIds.join(',')])

  // Reposition on every cursor update, reusing the last measured size.
  useLayoutEffect(() => {
    if (!show || !size) { setPos(null); return }
    setPos(computePreviewPosition({ x, y }, size, { width: window.innerWidth, height: window.innerHeight }))
  }, [show, size, x, y])

  // Hide on scroll (capture: most scroll containers don't bubble) and Escape, from anywhere.
  useEffect(() => {
    if (!visible) return
    const onScroll = (): void => usePreviewStore.getState().hide()
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') usePreviewStore.getState().hide() }
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [visible])

  if (!show || !thread) return null

  const chips = rowLabels(thread, labels, 4)
  const lead = thread.participants.find((p) => !myEmails.has(p.email.toLowerCase())) ?? thread.participants[0]
  const names = (() => {
    const seen: string[] = []
    for (const p of thread.participants) {
      const n = myEmails.has(p.email.toLowerCase()) ? 'Me' : displayName(p)
      if (!seen.includes(n)) seen.push(n)
    }
    return seen.join(', ')
  })()
  const avatarEmail = lead?.email ?? null
  const avatarFailed = failedAvatar === avatarEmail

  return (
    <div
      ref={ref}
      className="preview"
      role="presentation"
      style={{ left: pos ? pos.x : -9999, top: pos ? pos.y : -9999, visibility: pos ? 'visible' : 'hidden' }}
    >
      <div className="preview__header">
        {showAvatars && (
          <span className="preview__avatar">
            {lead ? initials(lead) : '—'}
            {avatarEmail && !avatarFailed && (
              <img
                className="preview__avatarimg" src={gravatarUrl(avatarEmail, 64)} alt=""
                loading="lazy" onError={() => setFailedAvatar(avatarEmail)}
              />
            )}
          </span>
        )}
        <div className="preview__from">
          <span className="preview__names">{names || thread.subject}</span>
          {lead && <span className="preview__email">{lead.email}</span>}
        </div>
        <span className="preview__date">{fullDate(thread.lastMessageAt)}</span>
      </div>

      <div className="preview__subject">
        {thread.unread && <span className="preview__unread" aria-label="Unread" />}
        {thread.subject || '(no subject)'}
        {thread.messageCount > 1 && <span className="preview__count">{thread.messageCount}</span>}
      </div>

      {thread.snippet && <p className="preview__snippet">{thread.snippet}</p>}

      {(chips.length > 0 || thread.hasAttachments || thread.starred) && (
        <div className="preview__meta">
          {chips.map((l) => (
            <span key={l.id} className="preview__chip" style={chipStyle(l.color)}>{l.name}</span>
          ))}
          {thread.hasAttachments && (
            <span className="preview__icon"><Paperclip size={12} /> Attachment</span>
          )}
          {thread.starred && (
            <span className="preview__icon preview__icon--star"><Star size={12} fill="currentColor" /> Starred</span>
          )}
        </div>
      )}
    </div>
  )
}
