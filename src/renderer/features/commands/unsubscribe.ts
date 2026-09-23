export interface UnsubscribeTargets {
  https?: string
  mailto?: { to: string; subject?: string }
}

/** Parse a `List-Unsubscribe` header value: `<https://…>, <mailto:x@y?subject=unsubscribe>`. */
export function parseListUnsubscribe(value: string | undefined | null): UnsubscribeTargets {
  const out: UnsubscribeTargets = {}
  if (!value) return out
  const entries = [...value.matchAll(/<([^>]+)>/g)].map((m) => m[1].trim())
  if (!entries.length) entries.push(...value.split(',').map((s) => s.trim()).filter(Boolean))
  for (const e of entries) {
    if (!out.https && /^https?:\/\//i.test(e)) out.https = e
    else if (!out.mailto && /^mailto:/i.test(e)) {
      const rest = e.slice('mailto:'.length)
      const [addr, query = ''] = rest.split('?')
      let subject: string | undefined
      try { subject = new URLSearchParams(query).get('subject') ?? undefined } catch { /* ignore */ }
      let to = addr
      try { to = decodeURIComponent(addr) } catch { /* keep raw */ }
      if (to) out.mailto = { to, subject }
    }
  }
  return out
}
