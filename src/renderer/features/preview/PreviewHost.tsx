import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Paperclip, Star } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ThreadWithMessages } from '@shared/types'
import { sanitizeEmailHtml } from '@shared/sanitize'
import { plainTextToHtml } from '@shared/sanitize/text'
import { useApp } from '@/lib/store'
import { displayName, fullDate, initials } from '@/lib/format'
import { chipStyle } from '@/lib/labels'
import { gravatarUrl } from '@/lib/avatar'
import { rowLabels } from '../threadlist/lib'
import { peekThread, fetchThread } from '../gestures/threadCache'
import { buildBodyDocument, readThemeTokens, type ThemeTokens } from '../reader/bodyDocument'
import { usePreviewStore } from './previewStore'
import { computePreviewPosition, type Point, type Size } from './position'
import './preview.css'

/** Re-read tokens whenever the OS/app colour scheme flips. Same idea as the reader's own hook
 *  (MessageBody.tsx's useThemeTokens), kept separate so this feature doesn't reach into another
 *  one's internals for a private hook. */
function useThemeTokens(): { tokens: ThemeTokens; dark: boolean } {
  const [state, setState] = useState(() => ({
    tokens: readThemeTokens(),
    dark: window.matchMedia('(prefers-color-scheme: dark)').matches
  }))
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const update = (): void => { requestAnimationFrame(() => setState({ tokens: readThemeTokens(), dark: mq.matches })) }
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return state
}

/**
 * The body preview's own srcdoc: the thread's latest message, sanitised the same way the reader
 * sanitises it (trackers stripped outright, remote images gated by the same setting) — never a
 * second, looser pass. No `cid:` resolution here (that's a round trip through `messages
 * .inlineImages`, not worth paying for a preview that's dismissed the moment the mouse moves on);
 * an unresolved inline image just shows the reader's existing "blocked" placeholder.
 */
function bodySrcDoc(thread: ThreadWithMessages, tokens: ThemeTokens, dark: boolean, blockRemoteImages: boolean): string {
  const message = thread.messages[thread.messages.length - 1]
  let html: string
  let paper = false
  if (message?.bodyHtml?.trim()) {
    const result = sanitizeEmailHtml(message.bodyHtml, { allowRemoteImages: !blockRemoteImages })
    html = result.html
    paper = dark && result.hasAuthoredBackground
  } else {
    html = plainTextToHtml(message?.bodyText ?? '').html
  }
  return buildBodyDocument({ html, tokens, dark, paper })
}

/**
 * The one preview-card DOM node for the whole app (mounted once in App.tsx, alongside
 * <TooltipHost/>). Thread rows never render their own card — they just push
 * { threadId, x, y } into the shared store (see previewStore.ts) and this host looks the thread
 * up, measures the card, positions it, and renders it.
 *
 * The header (sender/date/labels) is built entirely from data already in the thread-list store,
 * so hovering rapidly down a long list costs nothing beyond a local lookup. The body is the real
 * rendered message — not just the snippet — read from the same warm cache Row.tsx already fills
 * on hover-intent (features/gestures/threadCache.ts); by the show delay it's normally there. A
 * thread that never got warmed (a very fast, deliberate hover) falls back to the plain-text
 * snippet rather than paying for a fetch just as the card is about to appear.
 *
 * Two-pass sizing: the card is rendered off-screen (`visibility: hidden`) whenever its content
 * could have changed size, measured, then repositioned on every cursor update using that cached
 * size — so tracking the mouse never re-triggers a layout read on each mousemove, only the
 * (much rarer) content changes do. Same measure-then-place trick as tooltip/TooltipHost.tsx.
 */
export function PreviewHost(): JSX.Element | null {
  const { t } = useTranslation('preview')
  const visible = usePreviewStore((s) => s.visible)
  const threadId = usePreviewStore((s) => s.threadId)
  const x = usePreviewStore((s) => s.x)
  const y = usePreviewStore((s) => s.y)

  const thread = useApp((s) => (threadId ? s.threads.find((t) => t.id === threadId) : undefined))
  const labels = useApp((s) => s.labels)
  const accounts = useApp((s) => s.accounts)
  const showAvatars = useApp((s) => s.settings.showAvatars)
  const blockRemoteImages = useApp((s) => s.settings.blockRemoteImages)
  const { tokens, dark } = useThemeTokens()

  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<Size | null>(null)
  const [pos, setPos] = useState<Point | null>(null)
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null)
  const [full, setFull] = useState<ThreadWithMessages | null>(null)

  const myEmails = useMemo(() => new Set(accounts.map((a) => a.email.toLowerCase())), [accounts])
  const show = visible && !!thread

  // Pull the warmed body in, or fetch it if this hover was never warmed. `full` is left stale
  // (the previous thread's) for one frame while a fetch is in flight -- fine, it's replaced by
  // the fallback snippet below until it matches `thread.id`, never shown mismatched.
  useEffect(() => {
    if (!show || !thread) return undefined
    let cancelled = false
    const apply = (t: ThreadWithMessages | null | undefined): void => { if (!cancelled && t) setFull(t) }
    const cached = peekThread(thread.id)
    if (cached) apply(cached)
    else void fetchThread(thread.id).then(apply).catch(() => undefined)
    return () => { cancelled = true }
  }, [show, thread?.id])

  const srcDoc = useMemo(() => {
    if (!full || full.id !== thread?.id || !full.messages.length) return null
    return bodySrcDoc(full, tokens, dark, blockRemoteImages)
  }, [full, thread?.id, tokens, dark, blockRemoteImages])

  // Re-measure only when the card's own content could have changed its footprint.
  useLayoutEffect(() => {
    if (!show || !ref.current) { setSize(null); return }
    const r = ref.current.getBoundingClientRect()
    setSize({ width: r.width, height: r.height })
  }, [show, thread?.id, thread?.subject, thread?.snippet, thread?.labelIds.join(','), !!srcDoc])

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
      const n = myEmails.has(p.email.toLowerCase()) ? t('me') : displayName(p)
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
        {thread.unread && <span className="preview__unread" aria-label={t('unread')} />}
        {thread.subject || t('common:noSubject')}
        {thread.messageCount > 1 && <span className="preview__count">{thread.messageCount}</span>}
      </div>

      {srcDoc ? (
        // sandbox has no allow-scripts (same as the reader's own iframe, bodyDocument.ts) and
        // the whole card is pointer-events:none (preview.css), so this is inert either way.
        <div className="preview__body">
          <iframe className="preview__frame" title={t('frameTitle')} srcDoc={srcDoc} sandbox="allow-same-origin" scrolling="no" tabIndex={-1} />
          <div className="preview__fade" aria-hidden />
        </div>
      ) : thread.snippet ? (
        <p className="preview__snippet">{thread.snippet}</p>
      ) : null}

      {(chips.length > 0 || thread.hasAttachments || thread.starred) && (
        <div className="preview__meta">
          {chips.map((l) => (
            <span key={l.id} className="preview__chip" style={chipStyle(l.color)}>{l.name}</span>
          ))}
          {thread.hasAttachments && (
            <span className="preview__icon"><Paperclip size={12} /> {t('attachment')}</span>
          )}
          {thread.starred && (
            <span className="preview__icon preview__icon--star"><Star size={12} fill="currentColor" /> {t('starred')}</span>
          )}
        </div>
      )}
    </div>
  )
}
