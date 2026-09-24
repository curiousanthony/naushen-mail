import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { ShieldAlert } from 'lucide-react'
import { cleanTrackingParams, describeLink, phishingHint, type PhishingHint } from '@shared/sanitize/links'
import { useApp } from '@/lib/store'
import { copyText } from './clipboard'
import './shield.css'

/**
 * Link hygiene for the message iframe.
 *
 * The frame is `sandbox="allow-same-origin allow-popups"` with no scripts, so nothing can run
 * *inside* it. But same-origin means this component, running in the parent, can attach ordinary
 * DOM listeners to the frame's document. Hover, click and context-menu are all handled from out
 * here: no bootstrap script, no postMessage, and the sandbox is untouched.
 */

export interface HoverLink { href: string; text: string }
export interface PendingLink { url: string; hint: PhishingHint }
export interface LinkMenuState { x: number; y: number; href: string }

const openExternal = (url: string): void => { void window.api.invoke('app.openExternal', url) }

interface Guard {
  hover: HoverLink | null
  pending: PendingLink | null
  menu: LinkMenuState | null
  openPending(): void
  cancelPending(): void
  closeMenu(): void
}

/** Bind hover / click / contextmenu handling to whichever document the frame currently holds. */
export function useLinkGuard(frame: RefObject<HTMLIFrameElement | null>, reloadKey: unknown, messageId: string): Guard {
  const [hover, setHover] = useState<HoverLink | null>(null)
  const [pending, setPending] = useState<PendingLink | null>(null)
  const [menu, setMenu] = useState<LinkMenuState | null>(null)

  // Another message: whatever was pending belongs to the old one.
  useEffect(() => { setPending(null); setMenu(null); setHover(null) }, [messageId])

  useEffect(() => {
    const el = frame.current
    if (!el) return
    let doc: Document | null = null
    let showTimer: ReturnType<typeof setTimeout> | null = null
    const clearTimer = (): void => { if (showTimer) { clearTimeout(showTimer); showTimer = null } }

    const anchorOf = (t: EventTarget | null): HTMLAnchorElement | null =>
      ((t as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null) ?? null

    const onClick = (e: Event): void => {
      const a = anchorOf(e.target)
      if (!a) return
      const href = a.getAttribute('href') ?? ''
      e.preventDefault()
      e.stopPropagation()
      clearTimer()
      setHover(null)
      if (!href || href.startsWith('#')) return
      const url = cleanTrackingParams(href).url
      const hint = phishingHint(a.textContent ?? '', href)
      if (hint) { setPending({ url, hint }); return }
      openExternal(url)
    }

    const onOver = (e: Event): void => {
      const a = anchorOf(e.target)
      clearTimer()
      if (!a) { setHover(null); return }
      const href = a.getAttribute('href') ?? ''
      if (!href || href.startsWith('#')) { setHover(null); return }
      // Short delay: sweeping across a paragraph of links should not strobe the pill.
      showTimer = setTimeout(() => setHover({ href, text: a.textContent ?? '' }), 90)
    }

    const onOut = (e: Event): void => {
      const to = (e as MouseEvent).relatedTarget as Element | null
      // Moving between children of the same anchor is not leaving it.
      if (to && anchorOf(e.target) && anchorOf(e.target) === anchorOf(to)) return
      clearTimer()
      setHover(null)
    }

    const onContext = (e: Event): void => {
      const a = anchorOf(e.target)
      if (!a) return
      const href = a.getAttribute('href') ?? ''
      if (!href || href.startsWith('#')) return
      e.preventDefault()
      const me = e as MouseEvent
      const r = el.getBoundingClientRect()
      clearTimer()
      setHover(null)
      setMenu({ x: r.left + me.clientX, y: r.top + me.clientY, href })
    }

    const attach = (): void => {
      detach()
      doc = el.contentDocument
      if (!doc) return
      doc.addEventListener('click', onClick, true)
      doc.addEventListener('auxclick', onClick, true)
      doc.addEventListener('mouseover', onOver)
      doc.addEventListener('mouseout', onOut)
      doc.addEventListener('contextmenu', onContext, true)
      doc.addEventListener('mouseleave', onOut)
    }
    const detach = (): void => {
      if (!doc) return
      doc.removeEventListener('click', onClick, true)
      doc.removeEventListener('auxclick', onClick, true)
      doc.removeEventListener('mouseover', onOver)
      doc.removeEventListener('mouseout', onOut)
      doc.removeEventListener('contextmenu', onContext, true)
      doc.removeEventListener('mouseleave', onOut)
      doc = null
    }

    el.addEventListener('load', attach)
    if (el.contentDocument?.readyState === 'complete') attach()
    return () => { el.removeEventListener('load', attach); detach(); clearTimer() }
  }, [frame, reloadKey])

  return {
    hover, pending, menu,
    openPending: useCallback(() => { setPending((p) => { if (p) openExternal(p.url); return null }) }, []),
    cancelPending: useCallback(() => setPending(null), []),
    closeMenu: useCallback(() => setMenu(null), [])
  }
}

// ---------------------------------------------------------------- hover pill

/**
 * Safari-style status pill: the true destination, bottom-left of the reader. The host is set
 * apart from the rest of the URL because the host is the part that says who you are talking to.
 * A link whose visible text names a different site gets the host in the warning colour.
 */
export function LinkPill({ link, host }: { link: HoverLink | null; host: HTMLElement | null }): JSX.Element | null {
  if (!link || !host) return null
  const parts = describeLink(link.href)
  const cleaned = cleanTrackingParams(link.href)
  const hint = phishingHint(link.text, link.href)
  return createPortal(
    <div className="linkpill" role="status" data-warn={hint ? 'true' : undefined}>
      {parts.scheme === 'http' && <span className="linkpill__insecure">http://</span>}
      {parts.scheme === 'mailto' && <span className="linkpill__scheme">mail to </span>}
      {parts.scheme === 'tel' && <span className="linkpill__scheme">call </span>}
      <span className="linkpill__host">{parts.host}</span>
      {parts.rest && <span className="linkpill__rest">{parts.rest}</span>}
      {cleaned.removed.length > 0 && (
        <span className="linkpill__note">{cleaned.removed.length === 1 ? '1 tracking parameter' : `${cleaned.removed.length} tracking parameters`} stripped on open</span>
      )}
    </div>,
    host
  )
}

// ---------------------------------------------------------------- phishing warning

export function LinkWarning({ pending, onOpen, onCancel }: {
  pending: PendingLink; onOpen(): void; onCancel(): void
}): JSX.Element {
  const cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => { cancel.current?.focus() }, [pending])
  return (
    <div className="linkwarn" role="alertdialog" aria-label="Check this link">
      <ShieldAlert size={15} aria-hidden />
      <span className="linkwarn__text">
        This link goes to <b>{pending.hint.actual}</b>, not <b>{pending.hint.shown}</b>.
      </span>
      <button type="button" className="linkwarn__btn" onClick={onOpen}>Open anyway</button>
      <button type="button" className="linkwarn__btn linkwarn__btn--primary" ref={cancel} onClick={onCancel}>Cancel</button>
    </div>
  )
}

// ---------------------------------------------------------------- context menu

/** Right-click on a link: open or copy it, without tracking parameters. */
export function LinkMenu({ menu, onClose }: { menu: LinkMenuState | null; onClose(): void }): JSX.Element | null {
  const root = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    if (!menu) { setPos(null); return }
    const w = root.current?.offsetWidth ?? 200
    const h = root.current?.offsetHeight ?? 72
    setPos({
      left: Math.max(8, Math.min(menu.x, window.innerWidth - w - 8)),
      top: Math.max(8, Math.min(menu.y, window.innerHeight - h - 8))
    })
  }, [menu])

  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent): void => { if (!root.current?.contains(e.target as Node)) onClose() }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation(); e.preventDefault(); onClose()
    }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onClose)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('resize', onClose)
    }
  }, [menu, onClose])

  if (!menu) return null
  const isMail = /^mailto:/i.test(menu.href)
  const cleaned = cleanTrackingParams(menu.href)

  const copy = async (): Promise<void> => {
    const text = isMail ? describeLink(menu.href).host : cleaned.url
    const ok = await copyText(text)
    useApp.getState().toast({
      message: !ok ? 'Could not copy the link' : cleaned.removed.length ? 'Link copied without tracking parameters' : isMail ? 'Address copied' : 'Link copied',
      duration: 2200
    })
    onClose()
  }

  return createPortal(
    <div
      className="linkmenu" role="menu" ref={root}
      style={{ left: pos?.left ?? menu.x, top: pos?.top ?? menu.y, visibility: pos ? 'visible' : 'hidden' }}
    >
      <button type="button" role="menuitem" className="linkmenu__item" onClick={() => { openExternal(cleaned.url); onClose() }}>
        {isMail ? 'Write to this address' : 'Open link'}
      </button>
      <button type="button" role="menuitem" className="linkmenu__item" onClick={() => void copy()}>
        {isMail ? 'Copy address' : cleaned.removed.length ? 'Copy link (no tracking)' : 'Copy link'}
      </button>
    </div>,
    document.body
  )
}
