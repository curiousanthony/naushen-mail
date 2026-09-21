/**
 * `text/plain` fallback: turn a plain-text body into safe HTML for the same iframe pipeline.
 * Escapes first, then linkifies — so a body containing `<a href=…>` is shown, never executed.
 */

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Matches a bare URL or an email address in already-escaped text. One pass, URL first, so an
// address inside a URL (user@host) is not mistaken for a mailto.
const LINK_RE =
  /\b(?:https?:\/\/|www\.)[^\s<>"')\]]*[^\s<>"')\].,;:!?]|\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g

const anchor = (href: string, label: string): string =>
  `<a href="${href}" target="_blank" rel="noopener noreferrer nofollow">${label}</a>`

/** Escape, then linkify. Escaping first means markup in the body is shown, never parsed. */
export function linkifyLine(line: string): string {
  return escapeHtml(line).replace(LINK_RE, (m) => {
    if (/^https?:\/\//i.test(m)) return anchor(m, m)
    if (/^www\./i.test(m)) return anchor(`https://${m}`, m)
    return anchor(`mailto:${m}`, m)
  })
}

/**
 * Convert a plain-text body to HTML. Leading `>` quote lines are marked with
 * `data-mr-quote` so the reader collapses them exactly like an HTML `<blockquote>`.
 */
export function plainTextToHtml(text: string): { html: string; hasQuotedText: boolean } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  let hasQuotedText = false
  // The quoted tail starts at the first `>` line (or attribution line) that has text above it.
  let quoteFrom = -1
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    const isQuote = /^\s*>/.test(l) || /^\s*On\b[\s\S]{4,300}\bwrote:\s*$/i.test(l) ||
      /^\s*-{2,}\s*(?:Original Message|Forwarded message)\s*-{2,}\s*$/i.test(l)
    if (!isQuote) continue
    if (lines.slice(0, i).some((x) => x.trim())) { quoteFrom = i; break }
  }
  const body = lines.map((l, i) => {
    const html = linkifyLine(l) || '<br>'
    if (quoteFrom >= 0 && i >= quoteFrom) { hasQuotedText = true; return `<div data-mr-quote="1">${html}</div>` }
    return `<div>${html}</div>`
  }).join('')
  return { html: `<div class="mr-plain">${body}</div>`, hasQuotedText }
}
