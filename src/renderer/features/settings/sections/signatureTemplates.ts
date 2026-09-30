import type { Account } from '@shared/types'
import { escapeAttr, escapeHtml, safeColor } from '@shared/emailhtml/escape'
import { isSafeDataImage, normalizeUrl } from '@shared/sanitize/urls'

/**
 * Signature template gallery: a handful of common business-signature layouts, filled in with
 * whatever the app already knows about the account (name, email, and — for "Photo left" —
 * `avatarUrl`) and left as obvious, editable placeholder text for anything it doesn't
 * (title/role, company, phone).
 *
 * `body` is plain HTML with `{{name}}` / `{{email}}` / `{{photo}}` tokens, filled in by
 * `renderSignatureTemplate` below (string substitution — no generation). The result still goes
 * through `sanitizeSignature` (`../lib/signatureSanitize.ts`) before it is applied, same as any
 * other edit to the signature editor.
 *
 * Colours here are literal hex, not CSS custom properties on purpose: this HTML is dropped
 * verbatim into the outgoing MIME body by `serializeToEmailHtml` (`src/shared/emailhtml`),
 * which cannot use `var(--…)` — email clients strip `<style>` and ignore most CSS — so it
 * already renders the rest of a composed message with fixed light-mode hex values (see `INK` /
 * `INK_MUTED` / `LINK` / `RULE` there). The values below match those exactly so a templated
 * signature looks like part of the same message, not a mismatched insert. Primary text (the
 * name) deliberately has *no* inline colour: `serializeToEmailHtml` already wraps the whole
 * signature in `color:${INK}` for the email, and leaving it unset lets the settings/composer
 * preview inherit the app's own light/dark text token instead of a hardcoded value.
 */

const INK_MUTED = '#6b6a66'
const LINK = '#2383e2'
const RULE = '#e3e2e0'

export type SignaturePreviewKind = 'minimal' | 'photo' | 'compact' | 'classic'

export interface SignatureTemplate {
  id: string
  label: string
  description: string
  preview: SignaturePreviewKind
  body: string
}

const MINIMAL = `
<p style="margin:0;font-weight:600">{{name}}</p>
<p style="margin:2px 0 0;color:${INK_MUTED};font-style:italic">Your Title</p>
`.trim()

const PHOTO_LEFT = `
<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr>
<td style="padding-right:14px;vertical-align:top">{{photo}}</td>
<td style="vertical-align:top">
<p style="margin:0;font-weight:600">{{name}}</p>
<p style="margin:2px 0 0;color:${INK_MUTED};font-style:italic">Your Title</p>
<p style="margin:8px 0 0"><a href="mailto:{{email}}" style="color:${LINK};text-decoration:none">{{email}}</a></p>
</td>
</tr></table>
`.trim()

const COMPACT = `
<p style="margin:0"><strong>{{name}}</strong><span style="color:${INK_MUTED}">&nbsp;&nbsp;·&nbsp;&nbsp;</span><span style="color:${INK_MUTED};font-style:italic">Your Title</span><span style="color:${INK_MUTED}">&nbsp;&nbsp;·&nbsp;&nbsp;</span><span style="color:${INK_MUTED}">Your Phone</span></p>
`.trim()

const CLASSIC = `
<p style="margin:0;font-weight:600">{{name}}</p>
<p style="margin:2px 0 8px;color:${INK_MUTED};font-style:italic">Your Title, Your Company</p>
<hr style="border:0;border-top:1px solid ${RULE};margin:0 0 8px" />
<p style="margin:0">Your Phone&nbsp;&nbsp;•&nbsp;&nbsp;<a href="mailto:{{email}}" style="color:${LINK};text-decoration:none">{{email}}</a></p>
`.trim()

export const SIGNATURE_TEMPLATES: SignatureTemplate[] = [
  { id: 'minimal', label: 'Minimal', description: 'Just your name and title — no photo.', preview: 'minimal', body: MINIMAL },
  { id: 'photo-left', label: 'Photo left', description: 'A circular photo beside your name, title and email.', preview: 'photo', body: PHOTO_LEFT },
  { id: 'compact', label: 'Compact', description: 'Name, title and phone on a single line.', preview: 'compact', body: COMPACT },
  { id: 'classic', label: 'Classic block', description: 'Name, title, company, a divider, then contact info.', preview: 'classic', body: CLASSIC }
]

type TemplateAccount = Pick<Account, 'name' | 'email' | 'avatarUrl' | 'color'>

const AVATAR_SIZE = 56

/**
 * The avatar cell for "Photo left". A plain `https:` URL or a raster `data:image/…` URI is used as
 * the `<img src>`; anything else falls back to the initials circle. A `data:` photo is fine
 * to embed here: `serializeToEmailHtml` lifts it into an inline `cid:` MIME part when the message
 * is sent (Gmail and most webmail do not render `data:` sources in received mail).
 * `photo` overrides `account.avatarUrl` (the user picked a signature-specific picture).
 * Note for Outlook *desktop* (Word-engine) recipients: it ignores `border-radius`, so the photo
 * renders as a square there, not a circle — a known email-HTML limitation, not a bug in this template.
 */
export function photoCell(account: TemplateAccount, photo?: string): string {
  const raw = photo ?? account.avatarUrl
  const url = raw ? normalizeUrl(raw) : ''
  if (/^https:\/\//i.test(url) || (raw && isSafeDataImage(raw))) {
    const src = /^data:/i.test(raw ?? '') ? (raw as string) : url
    const alt = escapeAttr(account.name || account.email || '')
    return `<img src="${escapeAttr(src)}" width="${AVATAR_SIZE}" height="${AVATAR_SIZE}" alt="${alt}" ` +
      `style="border-radius:50%;display:block;width:${AVATAR_SIZE}px;height:${AVATAR_SIZE}px;object-fit:cover" />`
  }
  return initialsCell(account)
}

export function initialsCell(account: TemplateAccount): string {
  const initial = escapeHtml((account.name || account.email || '?').trim().charAt(0).toUpperCase() || '?')
  const bg = safeColor(account.color) ?? INK_MUTED
  return `<span style="display:inline-block;width:${AVATAR_SIZE}px;height:${AVATAR_SIZE}px;border-radius:50%;` +
    `background:${bg};color:#ffffff;text-align:center;line-height:${AVATAR_SIZE}px;font-weight:600;` +
    `font-size:${Math.round(AVATAR_SIZE * 0.36)}px">${initial}</span>`
}

/** Fill `{{name}}` / `{{email}}` / `{{photo}}` — plain string substitution, no generation. */
export function renderSignatureTemplate(template: SignatureTemplate, account: TemplateAccount): string {
  const name = escapeHtml((account.name || account.email || '').trim())
  const email = escapeHtml(account.email || '')
  const photo = photoCell(account)
  return template.body
    .replace(/\{\{name\}\}/g, () => name)
    .replace(/\{\{email\}\}/g, () => email)
    .replace(/\{\{photo\}\}/g, () => photo)
}
