/**
 * Recipient ranking. The store already counts (`useCount`) and timestamps (`lastUsedAt`)
 * every address we send to or hear from; this turns that into an order.
 *
 * Text match decides the tier (someone whose name/address *starts* with what you typed
 * beats someone who merely contains it); frecency orders within a tier, so your daily
 * correspondents float above a one-off from three years ago.
 */

import type { Contact } from '@shared/types'

const DAY = 86_400_000

/** log(uses) damped by an exponential recency decay (half-life three weeks, floor 25%). */
export function frecency(c: Pick<Contact, 'useCount' | 'lastUsedAt'>, now = Date.now()): number {
  const age = Math.max(0, now - (c.lastUsedAt || 0)) / DAY
  return Math.log1p(Math.max(0, c.useCount)) * (0.25 + 0.75 * Math.pow(0.5, age / 21))
}

/** 3 = starts a name/address, 2 = starts a word in the name / local part, 1 = contained, 0 = no. */
export function matchTier(c: Pick<Contact, 'email' | 'name'>, query: string): number {
  const q = query.trim().toLowerCase()
  if (!q) return 1
  const email = c.email.toLowerCase()
  const name = (c.name ?? '').toLowerCase()
  if (email.startsWith(q) || name.startsWith(q)) return 3
  const words = `${name} ${email.split('@')[0]}`.split(/[\s._+-]+/)
  if (words.some((w) => w.startsWith(q))) return 2
  if (email.includes(q) || name.includes(q)) return 1
  return 0
}

export function rankContacts(
  list: Contact[],
  query: string,
  opts: { now?: number; limit?: number; exclude?: Iterable<string> } = {}
): Contact[] {
  const now = opts.now ?? Date.now()
  const skip = new Set([...(opts.exclude ?? [])].map((e) => e.toLowerCase()))
  return list
    .filter((c) => !skip.has(c.email.toLowerCase()))
    .map((c) => ({ c, tier: matchTier(c, query), f: frecency(c, now) }))
    .filter((x) => x.tier > 0)
    .sort((a, b) => b.tier - a.tier || b.f - a.f || a.c.email.localeCompare(b.c.email))
    .slice(0, opts.limit ?? 6)
    .map((x) => x.c)
}

/** Deterministic avatar hue from an address, so the same person always gets the same colour. */
export function avatarHue(email: string): number {
  let h = 0
  for (const ch of email.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h % 360
}
