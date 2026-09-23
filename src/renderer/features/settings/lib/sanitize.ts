import DOMPurify from 'dompurify'

const CONFIG = {
  ALLOWED_TAGS: ['a', 'b', 'strong', 'i', 'em', 'u', 'br', 'p', 'div', 'span', 'ul', 'ol', 'li'],
  ALLOWED_ATTR: ['href'],
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i
}

/** Signature / snippet HTML is user-authored but is re-sanitised on every save and preview. */
export function sanitizeRich(html: string): string {
  const clean = DOMPurify.sanitize(html, CONFIG)
  const probe = document.createElement('div')
  probe.innerHTML = clean
  return probe.textContent?.trim() || probe.querySelector('a') ? clean : ''
}
