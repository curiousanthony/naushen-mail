/** Normalise user-typed link text into a safe href, or null when it is not usable. */
export function normalizeUrl(input: string): string | null {
  const t = input.trim()
  if (!t || /\s/.test(t)) return null
  if (/^(https?:|mailto:)/i.test(t)) return t
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return null // javascript:, data:, file: …
  if (/^[^@\s/]+@[^@\s/]+\.[^@\s/]+$/.test(t)) return `mailto:${t}`
  return /\./.test(t) ? `https://${t}` : null
}
