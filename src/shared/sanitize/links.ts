/**
 * Link hygiene, all pure string work:
 *  - strip well-known tracking query parameters before a link is opened or copied,
 *  - describe a link's true destination for the hover pill,
 *  - flag the classic phishing shape: link text that names one domain while the href goes to
 *    another ("paypal.com" → evil.example).
 */
import { hostMatches, isClickRedirectHost, parseHttpUrl } from './trackers'
import { normalizeUrl } from './urls'

/** Exact parameter names (lower-case) that carry no meaning for the destination page. */
const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid', 'twclid', 'ttclid',
  'li_fat_id', 'igshid', 'igsh', 'mc_eid', 'mc_cid', 'mkt_tok', '_hsenc', '_hsmi', '__hstc', '__hssc',
  '__hsfp', 'hsctatracking', 'vero_id', 'vero_conv', 'oly_enc_id', 'oly_anon_id', '_ke', 'trk',
  'trkcampaign', 'trkemail', 'ck_subscriber_id', 'sc_cid', 's_cid', 'wickedid', 'ef_id', 'srsltid',
  'spm', 'elqtrackid', 'elqtrack', 'elqaid', 'elqat', 'cmpid', 'ml_subscriber',
  'ml_subscriber_hash', 'rb_clickid', 'irclickid', 'piwik_campaign', 'piwik_kwd', 'pk_campaign',
  'pk_kwd', 'mtm_campaign', 'mtm_kwd', 'sb_referer_host', 'nb_klaviyo', 'klaviyo_id', '_bta_tid',
  '_bta_c', 'ss_email_id', 'ss_source'
])

/** Parameter name prefixes (lower-case). */
const TRACKING_PREFIXES = ['utm_', 'hsa_']

export const isTrackingParam = (name: string): boolean => {
  const n = name.toLowerCase()
  return TRACKING_PARAMS.has(n) || TRACKING_PREFIXES.some((p) => n.startsWith(p))
}

export interface CleanedLink {
  /** The URL to open or copy. Unchanged when nothing was removed. */
  url: string
  /** Names of the parameters that were dropped, in order. */
  removed: string[]
}

/**
 * Strip tracking parameters from an http(s) URL. Non-http(s) links (`mailto:`, `tel:`) and
 * anything unparsable come back untouched. Parameters are removed by name only — the rest of
 * the query string is preserved byte-for-byte so signed URLs and tokens keep working.
 */
export function cleanTrackingParams(raw: string): CleanedLink {
  const untouched: CleanedLink = { url: raw, removed: [] }
  const u = parseHttpUrl(raw)
  if (!u) return untouched
  const hashAt = raw.indexOf('#')
  const q = raw.indexOf('?')
  if (q < 0 || (hashAt >= 0 && hashAt < q)) return untouched
  const query = raw.slice(q + 1, hashAt < 0 ? undefined : hashAt)
  const hash = hashAt < 0 ? '' : raw.slice(hashAt)
  if (!query) return untouched
  const kept: string[] = []
  const removed: string[] = []
  for (const pair of query.split('&')) {
    if (!pair) continue
    const eq = pair.indexOf('=')
    let name = eq < 0 ? pair : pair.slice(0, eq)
    try { name = decodeURIComponent(name) } catch { /* keep raw */ }
    if (isTrackingParam(name)) removed.push(name)
    else kept.push(pair)
  }
  if (!removed.length) return untouched
  const base = raw.slice(0, q)
  return { url: `${base}${kept.length ? `?${kept.join('&')}` : ''}${hash}`, removed }
}

// ---------------------------------------------------------------- destination description

export interface LinkParts {
  scheme: 'http' | 'https' | 'mailto' | 'tel' | 'other'
  /** Host (or address for mailto). Empty for relative/unknown. */
  host: string
  /** Everything after the host, shown muted. */
  rest: string
}

/** Split an href into what the hover pill shows. Never throws. */
export function describeLink(raw: string): LinkParts {
  const s = normalizeUrl(raw)
  const mail = /^mailto:([^?]*)(.*)$/i.exec(s)
  if (mail) {
    let addr = mail[1]
    try { addr = decodeURIComponent(addr) } catch { /* keep raw */ }
    return { scheme: 'mailto', host: addr, rest: mail[2] }
  }
  const tel = /^tel:(.*)$/i.exec(s)
  if (tel) return { scheme: 'tel', host: tel[1], rest: '' }
  const u = parseHttpUrl(raw)
  if (u) {
    const scheme = /^http:/i.test(u.url) ? 'http' : 'https'
    const after = u.url.replace(/^https?:\/\/(?:[^/?#@]*@)?[^/?#]+/i, '')
    return { scheme, host: u.host, rest: after === '/' ? '' : after }
  }
  return { scheme: 'other', host: '', rest: raw }
}

// ---------------------------------------------------------------- phishing hint

/** Two-level public suffixes we care about; anything else is treated as a plain TLD. */
const SECOND_LEVEL = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.jp', 'ne.jp',
  'com.br', 'com.mx', 'com.ar', 'co.in', 'co.za', 'com.sg', 'com.hk', 'com.tr', 'com.cn', 'com.tw',
  'co.kr', 'com.pl', 'com.ua', 'com.ru', 'com.es', 'com.pt', 'co.il', 'com.eg', 'com.sa'
])

/** The registrable domain: `mail.google.com` → `google.com`, `a.bbc.co.uk` → `bbc.co.uk`. */
export function registrableDomain(host: string): string {
  const h = host.toLowerCase().replace(/\.$/, '')
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(h) || h.includes(':')) return h // IP literal
  const labels = h.split('.')
  if (labels.length <= 2) return h
  const last2 = labels.slice(-2).join('.')
  return SECOND_LEVEL.has(last2) ? labels.slice(-3).join('.') : last2
}

/**
 * Pull a domain out of anchor text that *looks like* an address: `paypal.com`,
 * `www.paypal.com/login`, `https://paypal.com`. Text with spaces or other words is prose, not an
 * address, and yields null.
 */
export function domainInText(text: string): string | null {
  const t = text.replace(/[​-‍⁠﻿]/g, '').trim()
  if (!t || t.length > 120) return null
  const m = /^(?:https?:\/\/)?(?:[^\s/@]+@)?((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})(?::\d+)?(?:[/?#]\S*)?$/i.exec(t)
  if (!m) return null
  return m[1].toLowerCase()
}

export interface PhishingHint {
  /** The domain the link text claims. */
  shown: string
  /** The host the href actually goes to. */
  actual: string
}

/**
 * The link text names a domain that is not the destination's. Returns null (no warning) when:
 * the text is not domain-shaped, the registrable domains match, or the destination is a known
 * click-tracking / link-wrapping service (routine in newsletters; the hover pill still shows the
 * true host). IP-address destinations behind a domain-shaped text are always flagged.
 */
export function phishingHint(text: string, href: string): PhishingHint | null {
  const shown = domainInText(text)
  if (!shown) return null
  const u = parseHttpUrl(href)
  if (!u) return null
  const isIp = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(u.host)
  if (!isIp) {
    if (registrableDomain(shown) === registrableDomain(u.host)) return null
    if (hostMatches(u.host, shown) || hostMatches(shown, u.host)) return null
    if (isClickRedirectHost(u.host)) return null
  }
  return { shown: registrableDomain(shown), actual: u.host.replace(/^www\./, '') }
}
