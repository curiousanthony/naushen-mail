/**
 * Email HTML sanitiser.
 *
 * Email bodies are hostile input. This is defence layer 1 of 2: DOMPurify plus a set of
 * mail-specific passes (remote-image blocking, `cid:` resolution, quoted-text marking).
 * Layer 2 is the reader, which renders the result in an iframe with no `allow-scripts`, so
 * even a bypass here has no script engine to reach.
 *
 * Everything here is pure: same input, same output. See `tests/renderer/sanitize.test.ts`.
 */
import DOMPurify from 'dompurify'
import { attributeNames, type El } from './dom'
import { markQuotedText } from './quote'
import {
  TRANSPARENT_GIF, cidOf, isRemoteImageSrc, isSafeDataImage, isSafeLink,
  scrubInlineStyle, scrubStyleSheet
} from './urls'

export { TRANSPARENT_GIF, formatBytes } from './urls'
export type { El } from './dom'

export interface SanitizeOptions {
  /** Load `http(s)` images. When false they are replaced by a placeholder and counted. */
  allowRemoteImages?: boolean
  /** `Content-ID` → URL (data: or app-local) for inline attachments. */
  cidMap?: Record<string, string>
  /** Mark quoted history so the reader can collapse it. Default true. */
  detectQuotedText?: boolean
}

export interface SanitizedEmail {
  html: string
  /** Remote images found, whether or not they were loaded. */
  remoteImageCount: number
  /** Remote images replaced with a placeholder. */
  blockedImageCount: number
  /** Tracking-pixel-sized images removed outright. */
  blockedTrackerCount: number
  /** Inline `cid:` images that could not be resolved. */
  unresolvedCidCount: number
  /** The author set colours/backgrounds — the reader keeps such mail on a light surface. */
  hasAuthoredColors: boolean
  hasQuotedText: boolean
  /** Nothing renderable survived. */
  isEmpty: boolean
}

/**
 * Structural and interactive tags that have no place in a mail body. `<style>` is deliberately
 * kept (newsletters are unreadable without it) but its text is scrubbed — see scrubStyleSheet.
 */
const FORBID_TAGS = [
  'script', 'noscript', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet',
  'form', 'input', 'button', 'select', 'option', 'optgroup', 'textarea', 'fieldset', 'legend', 'label', 'output',
  'base', 'meta', 'link', 'title', 'head', 'html', 'body',
  'svg', 'math', 'template', 'slot', 'canvas', 'dialog', 'portal',
  'audio', 'video', 'source', 'track', 'object', 'param', 'marquee', 'blink'
]

/**
 * DOMPurify's default `FORBID_CONTENTS` empties `<style>`. Newsletters are unreadable without
 * their stylesheet, so `style` is taken off that list and its text is scrubbed in a hook
 * instead (see scrubStyleSheet). Safe here because the reader's iframe has no `allow-scripts`.
 */
const FORBID_CONTENTS = [
  'annotation-xml', 'audio', 'colgroup', 'desc', 'foreignobject', 'head', 'iframe', 'math', 'mi',
  'mn', 'mo', 'ms', 'mtext', 'noembed', 'noframes', 'noscript', 'plaintext', 'script', 'svg',
  'template', 'thead', 'title', 'video', 'xmp'
]

const FORBID_ATTR = [
  'srcset', 'sizes', 'ping', 'formaction', 'action', 'http-equiv', 'content',
  'usemap', 'longdesc', 'profile', 'autofocus', 'poster', 'xmlns', 'xlink:href', 'lowsrc', 'dynsrc'
]

interface Ctx {
  allowRemote: boolean
  cidMap: Record<string, string>
  remoteImages: number
  blockedImages: number
  blockedTrackers: number
  unresolvedCid: number
  authoredColors: boolean
}

let ctx: Ctx = newCtx(false, {})
let hooksInstalled = false

function newCtx(allowRemote: boolean, cidMap: Record<string, string>): Ctx {
  return {
    allowRemote, cidMap,
    remoteImages: 0, blockedImages: 0, blockedTrackers: 0, unresolvedCid: 0, authoredColors: false
  }
}

/** Width/height ≤ 3px in either an attribute or an inline style — i.e. an open-tracker beacon. */
function isTrackingPixel(node: El): boolean {
  const small = (v: string | null): boolean => {
    if (!v) return false
    const n = parseFloat(v)
    return Number.isFinite(n) && n <= 3
  }
  if (small(node.getAttribute('width')) || small(node.getAttribute('height'))) return true
  const style = node.getAttribute('style') ?? ''
  const w = /(?:^|;)\s*width\s*:\s*([\d.]+)\s*px/i.exec(style)
  const h = /(?:^|;)\s*height\s*:\s*([\d.]+)\s*px/i.exec(style)
  return (!!w && parseFloat(w[1]) <= 3) || (!!h && parseFloat(h[1]) <= 3)
}

function handleImage(node: El): void {
  node.removeAttribute('srcset')
  node.removeAttribute('sizes')
  node.removeAttribute('loading')
  const src = node.getAttribute('src')

  const cid = cidOf(src)
  if (cid !== null) {
    const resolved = ctx.cidMap[cid]
    if (resolved) node.setAttribute('src', resolved)
    else {
      node.setAttribute('src', TRANSPARENT_GIF)
      node.setAttribute('data-mr-cid', cid)
      ctx.unresolvedCid++
    }
    return
  }

  if (isSafeDataImage(src)) return

  if (isRemoteImageSrc(src)) {
    ctx.remoteImages++
    if (ctx.allowRemote) return
    if (isTrackingPixel(node)) { ctx.blockedTrackers++; node.remove(); return }
    node.setAttribute('data-mr-blocked', '1')
    node.setAttribute('src', TRANSPARENT_GIF)
    ctx.blockedImages++
    return
  }

  // Relative, `data:` non-image, or an unknown scheme: nothing good can come of it.
  if (src) node.remove()
}

function installHooks(): void {
  if (hooksInstalled) return
  hooksInstalled = true

  DOMPurify.addHook('afterSanitizeElements', (n) => {
    const node = n as unknown as El
    if (!node.tagName) return
    if (node.tagName.toUpperCase() !== 'STYLE') return
    const cleaned = scrubStyleSheet(node.textContent ?? '', !ctx.allowRemote)
    if (!cleaned) { node.remove(); return }
    node.textContent = cleaned
    if (/(?:^|[;{\s])(?:color|background(?:-color|-image)?)\s*:/i.test(cleaned)) ctx.authoredColors = true
  })

  DOMPurify.addHook('afterSanitizeAttributes', (n) => {
    const node = n as unknown as El
    if (!node.tagName) return
    const tag = node.tagName.toUpperCase()

    // Belt and braces: DOMPurify already drops these, but an mXSS bypass would not get a
    // handler past this second sweep.
    for (const name of attributeNames(node)) {
      if (/^on/i.test(name)) node.removeAttribute(name)
    }

    if (node.hasAttribute('style')) {
      const res = scrubInlineStyle(node.getAttribute('style') ?? '', !ctx.allowRemote)
      if (res.authoredColor) ctx.authoredColors = true
      if (res.style) node.setAttribute('style', res.style)
      else node.removeAttribute('style')
    }
    if (node.hasAttribute('bgcolor')) ctx.authoredColors = true

    // `background="http://…"` on table cells is a second image channel.
    const bg = node.getAttribute('background')
    if (bg) {
      if (isRemoteImageSrc(bg)) {
        ctx.remoteImages++
        if (!ctx.allowRemote) { node.removeAttribute('background'); ctx.blockedImages++ }
      } else if (!isSafeDataImage(bg)) node.removeAttribute('background')
    }

    if (tag === 'A') {
      const href = node.getAttribute('href')
      if (isSafeLink(href)) {
        node.setAttribute('target', '_blank')
        node.setAttribute('rel', 'noopener noreferrer nofollow')
      } else {
        node.removeAttribute('href')
        node.removeAttribute('target')
      }
      node.removeAttribute('ping')
      node.removeAttribute('download')
    }

    if (tag === 'IMG') handleImage(node)
  })
}

/**
 * Sanitise an email body for display.
 *
 * @param html  the raw `text/html` part
 * @param opts  remote-image policy, `cid:` resolution map
 */
export function sanitizeEmailHtml(html: string, opts: SanitizeOptions = {}): SanitizedEmail {
  const empty: SanitizedEmail = {
    html: '', remoteImageCount: 0, blockedImageCount: 0, blockedTrackerCount: 0,
    unresolvedCidCount: 0, hasAuthoredColors: false, hasQuotedText: false, isEmpty: true
  }
  if (!html || !html.trim()) return empty

  installHooks()
  ctx = newCtx(opts.allowRemoteImages === true, opts.cidMap ?? {})

  // Wrapping forces the parser to treat the input as body content. Without it a leading
  // `<style>` is hoisted into `<head>` and lost, which is most of a newsletter's layout.
  const body = DOMPurify.sanitize(`<div data-mr-root="1">${html}</div>`, {
    RETURN_DOM: true,
    WHOLE_DOCUMENT: false,
    ALLOW_DATA_ATTR: true,
    ADD_TAGS: ['style'],
    ADD_ATTR: ['target', 'rel', 'bgcolor', 'background', 'align', 'valign', 'border', 'cellpadding', 'cellspacing'],
    FORBID_TAGS,
    FORBID_ATTR,
    FORBID_CONTENTS,
    // Keep the text of removed wrappers (e.g. a stray <form>) rather than losing the message.
    KEEP_CONTENT: true
  }) as unknown as El

  // Unwrap, unless unbalanced markup made the wrapper close early and leave siblings behind.
  const first = body.firstElementChild
  const root = body.children.length === 1 && first && first.hasAttribute('data-mr-root') ? first : body
  root.removeAttribute('data-mr-root')

  const hasQuotedText = opts.detectQuotedText === false ? false : markQuotedText(root)
  const out = root.innerHTML
  const isEmpty = !(root.textContent ?? '').trim() && root.querySelectorAll('img,table,hr,br').length === 0

  return {
    html: out,
    remoteImageCount: ctx.remoteImages,
    blockedImageCount: ctx.blockedImages,
    blockedTrackerCount: ctx.blockedTrackers,
    unresolvedCidCount: ctx.unresolvedCid,
    hasAuthoredColors: ctx.authoredColors,
    hasQuotedText,
    isEmpty
  }
}
