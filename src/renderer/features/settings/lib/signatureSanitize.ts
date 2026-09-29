import DOMPurify from 'dompurify'
import { isSafeDataImage, scrubInlineStyle } from '@shared/sanitize/urls'

/**
 * Sanitiser for the signature editor only — separate from `sanitizeRich` (shared with
 * snippets) because a signature template needs a wider allowlist: real signature layouts
 * (see `signatureTemplates.ts`) use a `<table>` for the photo/name two-column layout, an
 * `<img>` for the avatar, and inline `style` for anything email clients don't get from CSS
 * classes (email HTML strips `<style>` and ignores classes — see
 * `src/shared/emailhtml/serialize.ts`). This is saved into `settings.signatureHtml` and later
 * dropped **verbatim** into the outgoing MIME body by `serializeToEmailHtml` — nothing between
 * here and the wire re-sanitises it, so this is the only choke point.
 *
 * Kept deliberately separate from `sanitize.ts`'s `sanitizeRich`, which snippets still use
 * unchanged, and from `@shared/sanitize` (the *incoming*-mail sanitiser, which runs behind a
 * sandboxed iframe and can afford to be far more permissive).
 */

const ALLOWED_TAGS = [
  'a', 'b', 'strong', 'i', 'em', 'u', 'br', 'p', 'div', 'span', 'ul', 'ol', 'li',
  // Structural additions for real signature layouts (a "photo left" signature that will
  // actually render in Outlook/Gmail must be a <table>, not flexbox/grid — CLAUDE.md and
  // docs/05-email-html-contract.md).
  'table', 'tbody', 'tr', 'td', 'img', 'hr'
]

const ALLOWED_ATTR = [
  'href', 'src', 'alt', 'width', 'height', 'style',
  'cellpadding', 'cellspacing', 'border', 'valign', 'align'
]

/** https/mailto links, and inline `<img>` sources that are either https or a non-SVG data URI. */
const ALLOWED_URI_REGEXP = /^(?:https?:|mailto:|data:image\/(?!svg\+xml))/i

/**
 * CSS a signature template may set. Deliberately narrow: this fragment renders straight into
 * the app's own unsandboxed document (settings preview + the composer's signature preview,
 * see `sanitizeFragment`'s doc comment), so anything that could restyle the app around it
 * (position, z-index, …) is left off even though DOMPurify already strips script vectors.
 */
const ALLOWED_STYLE_PROPS = new Set([
  'color', 'background', 'background-color', 'font-weight', 'font-style', 'font-size',
  'font-family', 'text-align', 'text-decoration', 'line-height', 'vertical-align',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'border', 'border-top', 'border-bottom', 'border-left', 'border-right',
  'border-collapse', 'border-radius', 'width', 'height', 'display', 'object-fit', 'white-space'
])

function scrubStyleAttr(value: string): string {
  // Reuses the shared CSS scrubber (drops expression()/javascript:/@import/etc. and, with
  // `blockRemote: true`, any url()) before applying our own property allowlist on top.
  const { style } = scrubInlineStyle(value, true)
  if (!style) return ''
  return style
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .filter((d) => ALLOWED_STYLE_PROPS.has(d.slice(0, d.indexOf(':')).trim().toLowerCase()))
    .join('; ')
}

/** Signature HTML is user-authored (and template-authored) but is re-sanitised on every save and preview. */
export function sanitizeSignature(html: string): string {
  const clean = DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR, ALLOWED_URI_REGEXP })
  const probe = document.createElement('div')
  probe.innerHTML = clean

  probe.querySelectorAll<HTMLElement>('[style]').forEach((el) => {
    const scrubbed = scrubStyleAttr(el.getAttribute('style') ?? '')
    if (scrubbed) el.setAttribute('style', scrubbed)
    else el.removeAttribute('style')
  })

  // Belt and braces on top of ALLOWED_URI_REGEXP: drop any <img> whose src still isn't a
  // plain https URL or a non-SVG data: image (e.g. a bare relative path DOMPurify let through).
  probe.querySelectorAll<HTMLImageElement>('img').forEach((img) => {
    const src = img.getAttribute('src') ?? ''
    if (!/^https:\/\//i.test(src) && !isSafeDataImage(src)) img.remove()
  })

  const hasContent = !!probe.textContent?.trim() || !!probe.querySelector('a, img')
  return hasContent ? probe.innerHTML : ''
}
