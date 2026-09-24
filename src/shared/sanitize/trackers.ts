/**
 * Tracker classification: pure string work over URLs, no DOM. See trackerData.ts for the list
 * and its provenance. Used by the sanitiser (to drop tracking images) and by the link hygiene
 * helpers (to recognise click-redirect hosts).
 */
import { normalizeUrl } from './urls'
import {
  BEACON_PATHS, CLICK_REDIRECT_SUFFIXES, TRACKER_DOMAINS, TRACKER_HOST_PATTERNS, TRACKER_PATH_DOMAINS
} from './trackerData'

export type TrackerReason = 'host' | 'path' | 'pixel'

export interface TrackerHit {
  /** Lower-case hostname the image would have contacted. */
  host: string
  /** Vendor name when known, e.g. "Mailchimp". */
  service: string | null
  reason: TrackerReason
}

/** `//host/x` and `http(s)://host/x` → URL parts. Never throws. */
export function parseHttpUrl(raw: string | null | undefined): { host: string; path: string; url: string } | null {
  if (!raw) return null
  let s = normalizeUrl(raw)
  if (s.startsWith('//')) s = `https:${s}`
  if (!/^https?:\/\//i.test(s)) return null
  const m = /^https?:\/\/(?:[^/?#@]*@)?([^/?#:]+)(?::\d+)?([^#]*)/i.exec(s)
  if (!m) return null
  // A trailing dot is a valid FQDN spelling of the same host and is a known filter-dodging trick.
  const host = m[1].toLowerCase().replace(/\.$/, '')
  if (!host) return null
  return { host, path: m[2] || '/', url: s }
}

const DOMAIN_INDEX: Map<string, string> = new Map(TRACKER_DOMAINS.map(([d, s]) => [d, s]))

/** Does `host` equal `suffix` or end with `.suffix`? */
export const hostMatches = (host: string, suffix: string): boolean =>
  host === suffix || host.endsWith(`.${suffix}`)

/** Vendor for a host on the pure-tracker list (walks up the labels), or undefined. */
function domainService(host: string): string | undefined {
  const labels = host.split('.')
  for (let i = 0; i < labels.length - 1; i++) {
    const hit = DOMAIN_INDEX.get(labels.slice(i).join('.'))
    if (hit) return hit
  }
  return undefined
}

/**
 * Is this image URL a known tracker? Matches (in order) a tracker-only domain, a numbered
 * vendor host, a beacon path on a mixed-use vendor domain, and finally a generic beacon path.
 */
export function classifyTrackerUrl(raw: string | null | undefined): TrackerHit | null {
  const u = parseHttpUrl(raw)
  if (!u) return null
  const d = domainService(u.host)
  if (d) return { host: u.host, service: d, reason: 'host' }
  for (const p of TRACKER_HOST_PATTERNS) if (p.re.test(u.host)) return { host: u.host, service: p.service, reason: 'host' }
  for (const p of TRACKER_PATH_DOMAINS) {
    if (hostMatches(u.host, p.domain) && p.path.test(u.path)) return { host: u.host, service: p.service, reason: 'path' }
  }
  if (BEACON_PATHS.some((re) => re.test(u.path))) return { host: u.host, service: null, reason: 'path' }
  return null
}

/** Host of a remote URL for display, or null. */
export const hostOf = (raw: string | null | undefined): string | null => parseHttpUrl(raw)?.host ?? null

/** True when the host is a known click-redirect / link-wrapping service. */
export function isClickRedirectHost(host: string): boolean {
  return CLICK_REDIRECT_SUFFIXES.some((s) => hostMatches(host, s)) || !!domainService(host)
    || TRACKER_HOST_PATTERNS.some((p) => p.re.test(host))
}

export interface TrackerSummary {
  host: string
  service: string | null
  count: number
}

/** Group hits by host for display ("mandrillapp.com ×2"). Stable: first-seen order. */
export function summarizeTrackers(hits: readonly TrackerHit[]): TrackerSummary[] {
  const map = new Map<string, TrackerSummary>()
  for (const h of hits) {
    const cur = map.get(h.host)
    if (cur) cur.count++
    else map.set(h.host, { host: h.host, service: h.service, count: 1 })
  }
  return [...map.values()]
}
