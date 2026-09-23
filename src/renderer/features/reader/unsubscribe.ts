/**
 * RFC 2369 `List-Unsubscribe`: a comma-separated list of angle-bracketed URIs, e.g.
 * `<https://list.test/u?id=1>, <mailto:unsub@list.test?subject=unsubscribe>`.
 * A one-click HTTPS link is preferred; a mailto is the fallback.
 */
import type { Message } from '@shared/types'

export interface UnsubscribeTarget {
  url: string
  kind: 'http' | 'mailto'
}

/** Parse one header value. Tolerates missing brackets and stray whitespace. */
export function parseListUnsubscribe(header: string | undefined | null): UnsubscribeTarget | null {
  if (!header) return null
  const uris: string[] = []
  for (const m of header.matchAll(/<([^>]+)>/g)) uris.push(m[1].trim())
  if (!uris.length) {
    for (const part of header.split(',')) {
      const p = part.trim()
      if (p) uris.push(p)
    }
  }
  const http = uris.find((u) => /^https?:\/\//i.test(u))
  if (http) return { url: http, kind: 'http' }
  const mailto = uris.find((u) => /^mailto:/i.test(u))
  if (mailto) return { url: mailto, kind: 'mailto' }
  return null
}

/** The first usable unsubscribe target in a thread, newest message first. */
export function findUnsubscribe(messages: Message[]): UnsubscribeTarget | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const t = parseListUnsubscribe(messages[i].listUnsubscribe)
    if (t) return t
  }
  return null
}
