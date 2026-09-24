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
import { classifyTrackerUrl, parseHttpUrl, type TrackerHit } from './trackers'
import {
  TRANSPARENT_GIF, cidOf, isRemoteImageSrc, isSafeDataImage, isSafeLink,
  scrubInlineStyle, scrubStyleSheet
} from './urls'

export { TRANSPARENT_GIF, formatBytes } from './urls'
export type { El } from './dom'
export type { TrackerHit } from './trackers'

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
  /**
   * Tracking images removed outright (known tracker host or beacon path, 1x1 pixel, hidden
   * image). Unlike ordinary remote images these are dropped even when the user loads images.
   */
  blockedTrackerCount: number
  /** One entry per removed tracker, for the header's privacy shield. */
  trackers: TrackerHit[]
  /** Inline `cid:` images that could not be resolved. */
  unresolvedCidCount: number
  /** The author set a colour or a background of any kind. */
  hasAuthoredColors: boolean
  /**
   * The author set a *background*. This — not any authored colour — is the signal that the mail
   * was designed for a light page, so the reader shows it on the light "paper" surface in dark
   * mode. Mail that only sets a text colour is rendered on the app's own dark surface with that
   * colour neutralised, which looks native instead of boxed-in.
   */
  hasAuthoredBackground: boolean
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
  trackers: TrackerHit[]
  unresolvedCid: number
  authoredColors: boolean
  authoredBackground: boolean
}

let ctx: Ctx = newCtx(false, {})

/**
 * A DOMPurify instance of our own.
 *
 * `addHook` mutates whichever instance it is called on, so installing mail-specific hooks on the
 * shared default export would make them fire for every other caller in the app (the composer
 * sanitises paste HTML through the same library) with whatever `ctx` we happened to leave behind.
 * Calling the default export as a factory yields an isolated instance; the hooks below are ours
 * alone. Created lazily so importing this module in a DOM-less context does not throw.
 */
let purifier: typeof DOMPurify | null = null

function newCtx(allowRemote: boolean, cidMap: Record<string, string>): Ctx {
  return {
    allowRemote, cidMap,
    remoteImages: 0, blockedImages: 0, trackers: [], unresolvedCid: 0,
    authoredColors: false, authoredBackground: false
  }
}

/**
 * An open-tracker beacon by geometry: both dimensions ≤ 3px (or one is ≤ 3px and the other is
 * unset), declared in an attribute or an inline style. A lone `height="1"` beside a real width is
 * a spacer / rule image, not a beacon, and is left to the ordinary remote-image policy. An image
 * hidden with `display:none` / `visibility:hidden` / `opacity:0` has no purpose except being
 * fetched, so it counts too.
 */
function isTrackingPixel(node: El): boolean {
  const style = node.getAttribute('style') ?? ''
  if (/(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\.0+)?\s*(?:;|$))/i.test(style)) return true
  const num = (v: string | null | undefined): number | null => {
    if (!v) return null
    const n = parseFloat(v)
    return Number.isFinite(n) ? n : null
  }
  // A declared non-pixel size (`100%`, `auto`, `10em`) counts as "large": a full-width 1px rule.
  const px = (prop: string): number | null => {
    const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i').exec(style)
    if (!m) return null
    const v = /^\s*([\d.]+)\s*px\s*$/i.exec(m[1])
    return v ? num(v[1]) : 9999
  }
  const w = num(node.getAttribute('width')) ?? px('width')
  const h = num(node.getAttribute('height')) ?? px('height')
  const small = (n: number | null): boolean => n !== null && n <= 3
  if (small(w) && small(h)) return true
  return (small(w) && h === null) || (small(h) && w === null)
}

/**
 * Freeze a blocked image at the size its author declared.
 *
 * The placeholder `src` is a 1×1 GIF, and once it loads its 1:1 intrinsic ratio beats the
 * `width`/`height` attributes — a 520×200 banner would reserve a 520×520 hole. Copying the
 * declared dimensions into the inline style pins the box. Runs after the style scrub, and only
 * ever writes plain integers, so it cannot reintroduce anything the scrub removed.
 */
function pinDeclaredSize(node: El): void {
  const dim = (name: string): string | null => {
    const m = /^\s*(\d{1,5})(?:px)?\s*$/i.exec(node.getAttribute(name) ?? '')
    return m ? `${m[1]}px` : null
  }
  const w = dim('width')
  const h = dim('height')
  if (!w && !h) return
  const decls = [w && `width:${w}`, h && `height:${h}`].filter(Boolean).join('; ')
  const existing = node.getAttribute('style')
  // Appended, so these win over anything the author set.
  node.setAttribute('style', existing ? `${existing}; ${decls}` : decls)
}

/** A legitimate HTML dimension: a number, optionally with `px` or `%`. */
const VALID_DIMENSION = /^\s*\d{1,5}(?:\.\d+)?\s*(?:px|%)?\s*$/i

/**
 * Drop `width`/`height` attributes that are not dimensions. A browser ignores them anyway, so
 * this changes no rendering — it just keeps junk like `height="expression(alert(1))"` from
 * sitting in the output and looking like something that got through.
 */
function normalizeDimensions(node: El): void {
  for (const name of ['width', 'height']) {
    const v = node.getAttribute(name)
    if (v !== null && !VALID_DIMENSION.test(v)) node.removeAttribute(name)
  }
}

function handleImage(node: El): void {
  normalizeDimensions(node)
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
      pinDeclaredSize(node)
      ctx.unresolvedCid++
    }
    return
  }

  if (isSafeDataImage(src)) return

  if (isRemoteImageSrc(src)) {
    ctx.remoteImages++
    // Trackers are dropped whether or not the user has allowed images: "Load images" means the
    // pictures, never the beacon that reports the open.
    const hit = classifyTrackerUrl(src) ?? (isTrackingPixel(node)
      ? { host: parseHttpUrl(src)?.host ?? 'unknown', service: null, reason: 'pixel' as const }
      : null)
    if (hit) { ctx.trackers.push(hit); node.remove(); return }
    if (ctx.allowRemote) return
    node.setAttribute('data-mr-blocked', '1')
    node.setAttribute('src', TRANSPARENT_GIF)
    pinDeclaredSize(node)
    ctx.blockedImages++
    return
  }

  // Relative, `data:` non-image, or an unknown scheme: nothing good can come of it.
  if (src) node.remove()
}

function getPurifier(): typeof DOMPurify {
  if (purifier) return purifier

  const win = (globalThis as { window?: unknown }).window
  const factory = DOMPurify as unknown as (w: unknown) => typeof DOMPurify
  purifier = win ? factory(win) : DOMPurify

  purifier.addHook('afterSanitizeElements', (n) => {
    const node = n as unknown as El
    if (!node.tagName) return
    if (node.tagName.toUpperCase() !== 'STYLE') return
    const cleaned = scrubStyleSheet(node.textContent ?? '', !ctx.allowRemote)
    if (!cleaned) { node.remove(); return }
    node.textContent = cleaned
    if (/(?:^|[;{\s])(?:color|background(?:-color|-image)?)\s*:/i.test(cleaned)) {
      ctx.authoredColors = true
      // A message shipping its own stylesheet is a designed one; keep it on paper rather than
      // trying to re-colour rules we cannot attribute to individual elements.
      ctx.authoredBackground = true
    }
  })

  purifier.addHook('afterSanitizeAttributes', (n) => {
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
      if (res.authoredBackground) ctx.authoredBackground = true
      // Tagged so the reader can neutralise author text colours on its dark surface.
      if (res.authoredTextColor) node.setAttribute('data-mr-fg', '1')
      if (res.style) node.setAttribute('style', res.style)
      else node.removeAttribute('style')
    }
    if (node.hasAttribute('bgcolor')) { ctx.authoredColors = true; ctx.authoredBackground = true }

    // Legacy `<font color>` is still common in forwarded mail and needs the same treatment as
    // an inline `color:` declaration.
    if (tag === 'FONT' && node.hasAttribute('color')) {
      ctx.authoredColors = true
      node.setAttribute('data-mr-fg', '1')
    }

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

  return purifier
}

/**
 * Sanitise an email body for display.
 *
 * @param html  the raw `text/html` part
 * @param opts  remote-image policy, `cid:` resolution map
 */
export function sanitizeEmailHtml(html: string, opts: SanitizeOptions = {}): SanitizedEmail {
  const empty: SanitizedEmail = {
    html: '', remoteImageCount: 0, blockedImageCount: 0, blockedTrackerCount: 0, trackers: [],
    unresolvedCidCount: 0, hasAuthoredColors: false, hasAuthoredBackground: false,
    hasQuotedText: false, isEmpty: true
  }
  if (!html || !html.trim()) return empty

  const purify = getPurifier()
  ctx = newCtx(opts.allowRemoteImages === true, opts.cidMap ?? {})

  // Wrapping forces the parser to treat the input as body content. Without it a leading
  // `<style>` is hoisted into `<head>` and lost, which is most of a newsletter's layout.
  const body = purify.sanitize(`<div data-mr-root="1">${html}</div>`, {
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
    blockedTrackerCount: ctx.trackers.length,
    trackers: ctx.trackers,
    unresolvedCidCount: ctx.unresolvedCid,
    hasAuthoredColors: ctx.authoredColors,
    hasAuthoredBackground: ctx.authoredBackground,
    hasQuotedText,
    isEmpty
  }
}

/**
 * A DOMPurify instance for `sanitizeFragment`, separate from `getPurifier()`'s.
 *
 * The email instance's hooks read the module-level `ctx` and actively rewrite `<img>` src
 * (blocking remote images, resolving `cid:`) — correct for the reader's sandboxed iframe, wrong
 * for a fragment that is either (a) rendered straight into the app's own unsandboxed document, or
 * (b) fed back into an *outgoing* message (the composer's quote/forward preview: see
 * `buildOutgoing` in `src/renderer/features/compose/send.ts`, which drops `quoted.html` and
 * `signatureHtml` verbatim into the MIME body). Rewriting images there would silently corrupt
 * mail the user is about to send. This instance only strips danger; it never rewrites content.
 */
let fragmentPurifier: typeof DOMPurify | null = null

function getFragmentPurifier(): typeof DOMPurify {
  if (fragmentPurifier) return fragmentPurifier

  const win = (globalThis as { window?: unknown }).window
  const factory = DOMPurify as unknown as (w: unknown) => typeof DOMPurify
  fragmentPurifier = win ? factory(win) : DOMPurify

  // Belt and braces, same as the email instance: an mXSS bypass would not get an `on*` handler
  // past this second sweep.
  fragmentPurifier.addHook('afterSanitizeAttributes', (n) => {
    const node = n as unknown as El
    if (!node.tagName) return
    for (const name of attributeNames(node)) {
      if (/^on/i.test(name)) node.removeAttribute(name)
    }
    if (node.tagName.toUpperCase() === 'A') {
      const href = node.getAttribute('href')
      if (isSafeLink(href)) {
        node.setAttribute('target', '_blank')
        node.setAttribute('rel', 'noopener noreferrer nofollow')
      } else {
        node.removeAttribute('href')
      }
      node.removeAttribute('ping')
    }
  })

  return fragmentPurifier
}

/**
 * Sanitise a small HTML fragment that is either rendered directly into the app's own document
 * (no sandboxed-iframe boundary) or reused verbatim in an outgoing message. Used by the composer
 * for: the read-only preview of a quoted/forwarded message, and the signature preview.
 *
 * Unlike `sanitizeEmailHtml`, this does not touch `<img src>`, does not resolve `cid:`, and does
 * not mark quoted text — it must not change what the fragment renders as or what gets sent.
 * `<style>` is additionally forbidden (on top of the shared `FORBID_TAGS`/`FORBID_ATTR`): an
 * email's stylesheet is safe only behind the reader's iframe, and would otherwise restyle the
 * app's own page.
 */
export function sanitizeFragment(html: string): string {
  if (!html || !html.trim()) return ''
  const purify = getFragmentPurifier()
  return purify.sanitize(html, {
    FORBID_TAGS: [...FORBID_TAGS, 'style'],
    FORBID_ATTR
  }) as unknown as string
}
