/** URL / CSS predicates shared by the sanitiser. Pure string work — unit-tested directly. */

/** A 1×1 transparent GIF. Used to keep layout when a remote image is blocked. */
export const TRANSPARENT_GIF =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

/**
 * Strip the characters browsers ignore when resolving a URL, so that
 * `java\tscript:alert(1)` and `  JaVaScRiPt:…` cannot smuggle a scheme past a prefix test.
 */
export const normalizeUrl = (raw: string): string =>
  // Whitespace (incl. NBSP, LS, PS, BOM) and C0/C1 controls are ignored by URL parsers.
  raw.replace(/\s+/g, '').replace(/[\x00-\x1f\x7f-\x9f]/g, '')

const SAFE_LINK_SCHEME = /^(?:https?|mailto|tel|sms|callto|webcal|feed):/i
/** Same-document / relative references we leave alone (they cannot leave the iframe). */
const RELATIVE = /^(?:#|\/|\.\/|\.\.\/)/
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i

/** True when an `href` is safe to keep on an `<a>`. */
export function isSafeLink(raw: string | null | undefined): boolean {
  if (!raw) return false
  const url = normalizeUrl(raw)
  if (!url) return false
  if (SAFE_LINK_SCHEME.test(url)) return true
  if (RELATIVE.test(url)) return true
  // Scheme-relative (`//host/x`) resolves to https inside the srcdoc document.
  if (url.startsWith('//')) return true
  // Anything else with an explicit scheme (javascript:, data:, vbscript:, file:…) is rejected.
  return !HAS_SCHEME.test(url)
}

/** True when loading this image would hit the network. */
export function isRemoteImageSrc(raw: string | null | undefined): boolean {
  if (!raw) return false
  const url = normalizeUrl(raw)
  return /^https?:\/\//i.test(url) || url.startsWith('//')
}

/** `cid:` references point at an attachment of the same message. */
export function cidOf(raw: string | null | undefined): string | null {
  if (!raw) return null
  const url = normalizeUrl(raw)
  if (!/^cid:/i.test(url)) return null
  return decodeURIComponent(url.slice(4)).replace(/^<|>$/g, '')
}

const SAFE_DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|bmp|avif)\s*;\s*base64\s*,/i

/** Inline images are allowed, except SVG (it is a script container). */
export const isSafeDataImage = (raw: string | null | undefined): boolean =>
  !!raw && SAFE_DATA_IMAGE.test(normalizeUrl(raw))

// ---------------------------------------------------------------- inline CSS

/** Declarations that can execute code or phone home even without scripts. */
const DANGEROUS_CSS = /(?:expression\s*\(|javascript\s*:|vbscript\s*:|-moz-binding|behaviou?r\s*:|@import)/i

/** Split `a:b;c:d` on top-level semicolons only — `url(data:…;base64,…)` must survive. */
export function splitDeclarations(style: string): string[] {
  const out: string[] = []
  let depth = 0
  let quote: string | null = null
  let start = 0
  for (let i = 0; i < style.length; i++) {
    const c = style[i]
    if (quote) {
      if (c === quote && style[i - 1] !== '\\') quote = null
      continue
    }
    if (c === '"' || c === "'") quote = c
    else if (c === '(') depth++
    else if (c === ')') depth = Math.max(0, depth - 1)
    else if (c === ';' && depth === 0) {
      out.push(style.slice(start, i))
      start = i + 1
    }
  }
  out.push(style.slice(start))
  return out.map((d) => d.trim()).filter(Boolean)
}

const URL_IN_CSS = /url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi

/** Every `url(...)` target inside a declaration or stylesheet. */
export function cssUrls(css: string): string[] {
  const out: string[] = []
  for (const m of css.matchAll(URL_IN_CSS)) out.push(normalizeUrl(m[2]))
  return out
}

export interface StyleScrubResult {
  style: string
  /** A remote `url()` was dropped. */
  blockedRemote: boolean
  /** The author set a colour or background — relevant to dark-mode handling. */
  authoredColor: boolean
  /** The author set a *text* colour specifically. Unreadable on a dark surface, so the reader
   *  neutralises it when the message is not being shown on the light paper surface. */
  authoredTextColor: boolean
  /** The author set a background — the signal that this mail is designed for a light page. */
  authoredBackground: boolean
}

/**
 * Scrub an inline `style` attribute: drop declarations that can execute, and (when remote
 * content is blocked) drop declarations that would fetch something.
 */
export function scrubInlineStyle(style: string, blockRemote: boolean): StyleScrubResult {
  let blockedRemote = false
  let authoredTextColor = false
  let authoredBackground = false
  const kept: string[] = []
  for (const decl of splitDeclarations(style)) {
    if (DANGEROUS_CSS.test(decl)) continue
    const prop = decl.slice(0, decl.indexOf(':')).trim().toLowerCase()
    const urls = cssUrls(decl)
    if (urls.length) {
      const remote = urls.some((u) => /^https?:\/\//i.test(u) || u.startsWith('//'))
      const unsafeInline = urls.some((u) => /^(?:data:|cid:)/i.test(u) && !isSafeDataImage(u))
      if (unsafeInline) continue
      if (remote && blockRemote) { blockedRemote = true; continue }
    }
    if (prop === 'color') authoredTextColor = true
    else if (prop === 'background' || prop === 'background-color' || prop === 'background-image') {
      authoredBackground = true
    }
    kept.push(decl)
  }
  return {
    style: kept.join('; '),
    blockedRemote,
    authoredColor: authoredTextColor || authoredBackground,
    authoredTextColor,
    authoredBackground
  }
}

/** Scrub the text of a `<style>` element. Returns null when nothing usable is left. */
export function scrubStyleSheet(css: string, blockRemote: boolean): string | null {
  let out = css
    .replace(/<\/?\s*(?:script|style|iframe)/gi, '')
    .replace(/@import[^;]*;?/gi, '')
    .replace(/expression\s*\([^)]*\)/gi, '')
    .replace(/(?:javascript|vbscript)\s*:/gi, '')
    .replace(/-moz-binding\s*:[^;}]*/gi, '')
    .replace(/behaviou?r\s*:[^;}]*/gi, '')
  if (blockRemote) out = out.replace(URL_IN_CSS, (m, _q: string, u: string) => (
    /^https?:\/\//i.test(normalizeUrl(u)) || normalizeUrl(u).startsWith('//') ? 'none' : m
  ))
  return out.trim() ? out : null
}

// ---------------------------------------------------------------- misc

/** Bytes → "1.2 MB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB'
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
  const mb = kb / 1024
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
}
