import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ImageOff, Moon, Sun } from 'lucide-react'
import type { Attachment, Message } from '@shared/types'
import { sanitizeEmailHtml, type TrackerHit } from '@shared/sanitize'
import { plainTextToHtml } from '@shared/sanitize/text'
import { Tooltip } from '@/features/tooltip'
import { buildBodyDocument, readThemeTokens, type ThemeTokens } from './bodyDocument'
import { LinkMenu, LinkPill, LinkWarning, useLinkGuard } from './linkGuard'
import './shield.css'

/**
 * Per-machine preference for dark mode: show mail that ships its own light page as designed
 * ("Original") or re-coloured to the dark surface ("Adapted"). Same store as the peek width
 * (`mailroom.reader.*` in localStorage): a UI preference, not app data.
 */
const ADAPT_KEY = 'mailroom.reader.adaptDark'
function loadAdapt(): boolean {
  try { return localStorage.getItem(ADAPT_KEY) === '1' } catch { return false }
}
function saveAdapt(on: boolean): void {
  try { localStorage.setItem(ADAPT_KEY, on ? '1' : '0') } catch { /* private mode: session only */ }
}

/**
 * Scale a wider-than-the-peek document down to fit, instead of a horizontal scrollbar.
 * `zoom` (unlike `transform`) is layout-affecting, so the height the parent measures stays true.
 * Bounded below: past ~55% the text is unreadable and scrolling is the better failure.
 */
export const MIN_FIT_SCALE = 0.55
export function fitScale(contentWidth: number, viewWidth: number): number {
  if (!(contentWidth > 0) || !(viewWidth > 0) || contentWidth <= viewWidth + 1) return 1
  // One pixel of slack, rounded down: otherwise sub-pixel rounding leaves a 1px overflow and a
  // horizontal scrollbar appears for content that "fits".
  return Math.max(MIN_FIT_SCALE, Math.floor(((viewWidth - 1) / contentWidth) * 1000) / 1000)
}

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
  // Under `zoom` (fit-to-width) scrollHeight/offsetHeight stay in the body's own unscaled units
  // while the frame needs the visual height; getBoundingClientRect() is the one that is scaled.
  if (body.style.zoom) return Math.ceil(body.getBoundingClientRect().height)
  return Math.max(body.scrollHeight, body.offsetHeight, body.getBoundingClientRect().height)
}

interface Props {
  message: Message
  /** App-level setting; a per-message override wins. */
  blockRemoteImages: boolean
  /** Reports the trackers removed from this body (for the header's shield). */
  onTrackers?(trackers: TrackerHit[]): void
}

/**
 * One message body, rendered in a sandboxed iframe.
 *
 * `sandbox="allow-same-origin allow-popups"` — deliberately **no** `allow-scripts`. Without a
 * script engine the same-origin grant cannot be abused, and it is what lets the parent measure
 * the content, intercept link clicks and toggle quoted text without reloading the document.
 */
export function MessageBody({ message, blockRemoteImages, onTrackers }: Props): JSX.Element {
  const { t } = useTranslation('reader')
  const { tokens, dark } = useThemeTokens()
  const [loadImages, setLoadImages] = useState(false)
  const [showQuote, setShowQuote] = useState(false)
  const [adapt, setAdapt] = useState(loadAdapt)
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
      remoteImageCount: 0, blockedImageCount: 0, blockedTrackerCount: 0, trackers: [], unresolvedCidCount: 0,
      isEmpty: !(message.bodyText ?? '').trim()
    }
  }, [message.bodyHtml, message.bodyText, allowRemote, cidMap])

  const paper = dark && result.hasAuthoredBackground
  const srcDoc = useMemo(
    () => buildBodyDocument({ html: result.html, tokens, dark, paper, adapt: paper && adapt }),
    [result.html, tokens, dark, paper, adapt]
  )

  useEffect(() => { onTrackers?.(result.trackers) }, [result.trackers, onTrackers])

  const guard = useLinkGuard(frame, srcDoc, message.id)
  const [pillHost, setPillHost] = useState<HTMLElement | null>(null)
  useEffect(() => { setPillHost((frame.current?.closest('.reader') as HTMLElement | null) ?? null) }, [srcDoc])

  // Measure content, intercept clicks. Re-runs on every srcdoc change (the iframe reloads).
  useEffect(() => {
    const el = frame.current
    if (!el) return
    let observer: ResizeObserver | null = null
    let frameObserver: ResizeObserver | null = null
    let timers: ReturnType<typeof setTimeout>[] = []
    let imgs: HTMLImageElement[] = []

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

    // Named (not per-onLoad-call anonymous) so cleanup can unbind the exact same reference
    // from every image it was attached to -- the previous version attached a fresh `measure`
    // closure per image and never removed it, leaking one listener per image per message open.
    const measure = (): void => {
      const doc = el.contentDocument
      if (!doc) return
      const h = contentHeight(doc)
      if (h > 0) setHeight(h)
    }

    // Wide mail (fixed 800px tables, unresponsive layouts) is scaled to the frame's width. Reset,
    // measure the natural width, then apply — so widening the peek scales back up again.
    const fit = (): void => {
      const doc = el.contentDocument
      const body = doc?.body
      if (!doc || !body) return
      body.style.zoom = ''
      const scale = fitScale(doc.documentElement.scrollWidth, doc.documentElement.clientWidth)
      if (scale < 1) body.style.zoom = String(scale)
      measure()
    }

    const onLoad = (): void => {
      const doc = el.contentDocument
      if (!doc) return
      fit()
      observer?.disconnect()
      observer = new ResizeObserver(measure)
      frameObserver?.disconnect()
      // Only a change of *width* re-fits. Our own height updates also resize this element and
      // must not re-enter fit (that is a feedback loop waiting to happen).
      let lastW = el.clientWidth
      frameObserver = new ResizeObserver(() => {
        if (el.clientWidth === lastW) return
        lastW = el.clientWidth
        fit()
      })
      frameObserver.observe(el)
      // `documentElement`'s box tracks the iframe (whose height we drive from out here), so on
      // its own it never reports content growth. `body` is the element that actually grows.
      if (doc.body) observer.observe(doc.body)
      if (doc.documentElement) observer.observe(doc.documentElement)
      doc.addEventListener('keydown', onKeyIn, true)
      for (const img of imgs) img.removeEventListener('load', fit) // a re-fired load event: drop the old set first
      imgs = Array.from(doc.images)
      for (const img of imgs) img.addEventListener('load', fit)
      // Fonts and late layout settle after the load event.
      timers = [setTimeout(fit, 80), setTimeout(fit, 400)]
    }

    el.addEventListener('load', onLoad)
    if (el.contentDocument?.readyState === 'complete') onLoad()
    return () => {
      el.removeEventListener('load', onLoad)
      el.contentDocument?.removeEventListener('keydown', onKeyIn, true)
      for (const img of imgs) img.removeEventListener('load', fit)
      observer?.disconnect()
      frameObserver?.disconnect()
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

  const blockedCount = result.blockedImageCount

  return (
    <div className="msgbody">
      {guard.pending && <LinkWarning pending={guard.pending} onOpen={guard.openPending} onCancel={guard.cancelPending} />}
      {blockedCount > 0 && (
        <div className="msgbody__banner" role="status">
          <ImageOff size={15} aria-hidden />
          <span className="msgbody__banner-text">
            {t('body.remoteImageBlocked', { count: blockedCount })}
          </span>
          <button className="msgbody__banner-btn" onClick={() => setLoadImages(true)}>{t('body.loadImages')}</button>
          <button
            className="msgbody__banner-btn"
            onClick={() => { setLoadImages(true); void alwaysLoadImages() }}
          >
            {t('body.alwaysLoad')}
          </button>
        </div>
      )}

      {result.isEmpty ? (
        <p className="msgbody__empty">{t('body.empty')}</p>
      ) : (
        <iframe
          ref={frame}
          className="msgbody__frame"
          title={t('body.frameTitle', { sender: message.from.name ?? message.from.email })}
          sandbox="allow-same-origin allow-popups"
          srcDoc={srcDoc}
          style={{ height }}
        />
      )}

      {paper && !result.isEmpty && (
        <Tooltip label={adapt ? t('body.showAsDesigned') : t('body.adaptToDark')}>
          <button
            type="button"
            className="msgbody__adapt"
            aria-pressed={adapt}
            aria-label={adapt ? t('body.showOriginalColours') : t('body.adaptColours')}
            onClick={() => { const next = !adapt; setAdapt(next); saveAdapt(next) }}
          >
            {adapt ? <Sun size={13} aria-hidden /> : <Moon size={13} aria-hidden />}
            <span>{adapt ? t('body.original') : t('body.adapt')}</span>
          </button>
        </Tooltip>
      )}

      <LinkPill link={guard.hover} host={pillHost} />
      <LinkMenu menu={guard.menu} onClose={guard.closeMenu} />

      {result.hasQuotedText && (
        // The label span is visually hidden while collapsed (see msgbody__quote-label in
        // reader.css) — collapsed, this is an icon-only "•••" button, so it still needs a
        // tooltip even though there's a text node in the DOM.
        <Tooltip label={showQuote ? t('body.hideQuote') : t('body.showQuote')}>
          <button
            className={`msgbody__quote${showQuote ? ' is-open' : ''}`}
            onClick={() => setShowQuote((v) => !v)}
            aria-expanded={showQuote}
          >
            {showQuote ? <ChevronDown size={14} aria-hidden /> : <span className="msgbody__dots" aria-hidden>•••</span>}
            <span className="msgbody__quote-label">{showQuote ? t('body.hideQuote') : t('body.showQuote')}</span>
          </button>
        </Tooltip>
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
