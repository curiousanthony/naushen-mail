import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ImageOff } from 'lucide-react'
import type { Attachment, Message } from '@shared/types'
import { sanitizeEmailHtml } from '@shared/sanitize'
import { plainTextToHtml } from '@shared/sanitize/text'
import { buildBodyDocument, readThemeTokens, type ThemeTokens } from './bodyDocument'

/**
 * Whether a message is worth a `messages.inlineImages` round trip: it carries at least one
 * attachment the provider marked `inline`, which is how a `cid:` reference in the body gets its
 * bytes. Exported (pure, no I/O) so it can be unit tested without rendering the component.
 */
export function needsInlineImageResolution(attachments: Attachment[]): boolean {
  return attachments.some((a) => a.inline)
}

/** Re-read tokens whenever the OS/app colour scheme flips (main sets nativeTheme.themeSource). */
function useThemeTokens(): { tokens: ThemeTokens; dark: boolean } {
  const [state, setState] = useState(() => ({
    tokens: readThemeTokens(),
    dark: window.matchMedia('(prefers-color-scheme: dark)').matches
  }))
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const update = (): void => {
      // The token values are read from the stylesheet the new scheme just applied.
      requestAnimationFrame(() => setState({ tokens: readThemeTokens(), dark: mq.matches }))
    }
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return state
}

/** Keys the reader acts on, forwarded out of the body iframe. Mirrors Reader's own handler. */
const READER_KEYS = new Set(['Escape', 'r', 'a', 'f'])

/**
 * Height of the document's content.
 *
 * Deliberately measures `<body>`, never `documentElement`: the frame's height is driven from
 * out here, so `documentElement.scrollHeight` can never report *less* than the height we last
 * set — a one-line reply would keep whatever tall box a previous message left behind. `<body>`
 * is a flow-root in the injected CSS, so its scrollHeight is the real content height.
 */
function contentHeight(doc: Document): number {
  const body = doc.body
  if (!body) return doc.documentElement?.scrollHeight ?? 0
  return Math.max(body.scrollHeight, body.offsetHeight, body.getBoundingClientRect().height)
}

interface Props {
  message: Message
  /** App-level setting; a per-message override wins. */
  blockRemoteImages: boolean
}

/**
 * One message body, rendered in a sandboxed iframe.
 *
 * `sandbox="allow-same-origin allow-popups"` — deliberately **no** `allow-scripts`. Without a
 * script engine the same-origin grant cannot be abused, and it is what lets the parent measure
 * the content, intercept link clicks and toggle quoted text without reloading the document.
 */
export function MessageBody({ message, blockRemoteImages }: Props): JSX.Element {
  const { tokens, dark } = useThemeTokens()
  const [loadImages, setLoadImages] = useState(false)
  const [showQuote, setShowQuote] = useState(false)
  // Small, not zero: enough that a slow document is not invisible, small enough that the
  // correction after the first measure is not a visible jump.
  const [height, setHeight] = useState(28)
  const frame = useRef<HTMLIFrameElement>(null)
  // Content-ID -> `data:` URL for this message's inline attachments, resolved async below and
  // fed to the sanitiser's own `cidMap` option (see `@shared/sanitize`).
  const [cidMap, setCidMap] = useState<Record<string, string> | undefined>(undefined)

  // A new message id is a different body: drop per-message overrides.
  useEffect(() => { setLoadImages(false); setShowQuote(false) }, [message.id])

  // Resolve `cid:` inline images once the message is displayed. Only messages that actually
  // carry an inline attachment pay for the round trip; everything else skips it entirely. The
  // sanitiser already renders its blocked-cid placeholder on the first pass (cidMap undefined),
  // and this re-sanitises with the resolved map the same way toggling "Load images" does.
  useEffect(() => {
    setCidMap(undefined)
    if (!needsInlineImageResolution(message.attachments)) return
    let cancelled = false
    void window.api.invoke('messages.inlineImages', message.id).then((map) => {
      if (!cancelled) setCidMap(map)
    }).catch(() => {
      // Leave unresolved — the sanitiser's existing blocked-cid placeholder stands.
    })
    return () => { cancelled = true }
  }, [message.id, message.attachments])

  const allowRemote = !blockRemoteImages || loadImages

  const result = useMemo(() => {
    if (message.bodyHtml && message.bodyHtml.trim()) {
      return sanitizeEmailHtml(message.bodyHtml, { allowRemoteImages: allowRemote, cidMap })
    }
    const plain = plainTextToHtml(message.bodyText ?? '')
    return {
      html: plain.html, hasQuotedText: plain.hasQuotedText,
      hasAuthoredColors: false, hasAuthoredBackground: false,
      remoteImageCount: 0, blockedImageCount: 0, blockedTrackerCount: 0, unresolvedCidCount: 0,
      isEmpty: !(message.bodyText ?? '').trim()
    }
  }, [message.bodyHtml, message.bodyText, allowRemote, cidMap])

  const srcDoc = useMemo(
    () => buildBodyDocument({ html: result.html, tokens, dark, paper: dark && result.hasAuthoredBackground }),
    [result.html, tokens, dark]
  )

  // Measure content, intercept clicks. Re-runs on every srcdoc change (the iframe reloads).
  useEffect(() => {
    const el = frame.current
    if (!el) return
    let observer: ResizeObserver | null = null
    let timers: ReturnType<typeof setTimeout>[] = []

    const onClick = (e: Event): void => {
      const target = e.target as Element | null
      const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!anchor) return
      const href = anchor.getAttribute('href') ?? ''
      e.preventDefault()
      e.stopPropagation()
      if (!href || href.startsWith('#')) return
      void window.api.invoke('app.openExternal', href)
    }

    /**
     * A keypress inside the iframe never reaches the parent's window listener, so clicking into
     * a message body to select text would silently kill Esc and r/a/f. Re-dispatch the few keys
     * the reader owns; everything else (typing, find-in-page) is left to the document.
     */
    const onKeyIn = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (!READER_KEYS.has(e.key)) return
      window.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, bubbles: true }))
    }

    const onLoad = (): void => {
      const doc = el.contentDocument
      if (!doc) return
      const measure = (): void => {
        const h = contentHeight(doc)
        if (h > 0) setHeight(h)
      }
      measure()
      observer?.disconnect()
      observer = new ResizeObserver(measure)
      // `documentElement`'s box tracks the iframe (whose height we drive from out here), so on
      // its own it never reports content growth. `body` is the element that actually grows.
      if (doc.body) observer.observe(doc.body)
      if (doc.documentElement) observer.observe(doc.documentElement)
      doc.addEventListener('click', onClick, true)
      doc.addEventListener('auxclick', onClick, true)
      doc.addEventListener('keydown', onKeyIn, true)
      for (const img of Array.from(doc.images)) img.addEventListener('load', measure)
      // Fonts and late layout settle after the load event.
      timers = [setTimeout(measure, 80), setTimeout(measure, 400)]
    }

    el.addEventListener('load', onLoad)
    if (el.contentDocument?.readyState === 'complete') onLoad()
    return () => {
      el.removeEventListener('load', onLoad)
      el.contentDocument?.removeEventListener('click', onClick, true)
      el.contentDocument?.removeEventListener('auxclick', onClick, true)
      el.contentDocument?.removeEventListener('keydown', onKeyIn, true)
      observer?.disconnect()
      for (const t of timers) clearTimeout(t)
    }
  }, [srcDoc])

  // Toggling the quote is a class flip inside the document — no reload, no flash.
  useEffect(() => {
    const root = frame.current?.contentDocument?.documentElement
    if (!root) return
    root.classList.toggle('mr-show-quote', showQuote)
    const id = requestAnimationFrame(() => {
      const doc = frame.current?.contentDocument
      if (doc) setHeight(contentHeight(doc))
    })
    return () => cancelAnimationFrame(id)
  }, [showQuote, srcDoc])

  const blockedCount = result.blockedImageCount + result.blockedTrackerCount

  return (
    <div className="msgbody">
      {blockedCount > 0 && (
        <div className="msgbody__banner" role="status">
          <ImageOff size={15} aria-hidden />
          <span className="msgbody__banner-text">
            {blockedCount === 1 ? 'Remote image blocked' : `${blockedCount} remote images blocked`}
            {result.blockedTrackerCount > 0 && (
              <em className="msgbody__banner-note">
                {' · '}{result.blockedTrackerCount} {result.blockedTrackerCount === 1 ? 'tracker' : 'trackers'} removed
              </em>
            )}
          </span>
          <button className="msgbody__banner-btn" onClick={() => setLoadImages(true)}>Load images</button>
          <button
            className="msgbody__banner-btn"
            onClick={() => { setLoadImages(true); void alwaysLoadImages() }}
          >
            Always load
          </button>
        </div>
      )}

      {result.isEmpty ? (
        <p className="msgbody__empty">This message has no content.</p>
      ) : (
        <iframe
          ref={frame}
          className="msgbody__frame"
          title={`Message from ${message.from.name ?? message.from.email}`}
          sandbox="allow-same-origin allow-popups"
          srcDoc={srcDoc}
          style={{ height }}
        />
      )}

      {result.hasQuotedText && (
        <button
          className={`msgbody__quote${showQuote ? ' is-open' : ''}`}
          onClick={() => setShowQuote((v) => !v)}
          aria-expanded={showQuote}
          title={showQuote ? 'Hide quoted text' : 'Show quoted text'}
        >
          {showQuote ? <ChevronDown size={14} aria-hidden /> : <span className="msgbody__dots" aria-hidden>•••</span>}
          <span className="msgbody__quote-label">{showQuote ? 'Hide quoted text' : 'Show quoted text'}</span>
        </button>
      )}
    </div>
  )
}

/**
 * "Always load" flips the app-wide setting. Not a hook despite living beside one — deliberately
 * named so, since it is called from an onClick handler.
 */
async function alwaysLoadImages(): Promise<void> {
  const { useApp } = await import('@/lib/store')
  await useApp.getState().updateSettings({ blockRemoteImages: false })
}
