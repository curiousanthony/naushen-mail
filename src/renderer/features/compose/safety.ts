/**
 * Pre-send safety net: small, deterministic detectors. No network, no models.
 *
 * Each detector is pure so it can be unit-tested; `Composer` decides *where* the result is
 * shown (inline notes under the recipients, or a one-line confirm bar above the toolbar).
 */

import type { Address } from '@shared/types'

// ------------------------------------------------------------ "you mentioned an attachment"

/** Lines from here on are quoted history, not something the author wrote. */
const QUOTE_HEADERS: RegExp[] = [
  /^\s*on .{6,200} wrote:\s*$/i,
  /^\s*le .{6,200}[ée]crit\s*:\s*$/i,
  /^\s*-{2,}\s*(original message|forwarded message|message d.origine|message transf[ée]r[ée])/i,
  /^\s*_{5,}\s*$/,
  /^\s*(from|de)\s*:\s.+@.+/i
]
/** RFC 3676 signature delimiter (`-- `), plus the bare `--` people actually type. */
const SIGNATURE_DELIMITER = /^\s*--\s*$/

/** What the author wrote: no `>` quoting, no quoted history, no trailing signature. */
export function ownText(text: string): string {
  const out: string[] = []
  for (const line of text.split(/\r?\n/)) {
    if (SIGNATURE_DELIMITER.test(line) || QUOTE_HEADERS.some((re) => re.test(line))) break
    if (/^\s*>/.test(line)) continue
    out.push(line)
  }
  return out.join('\n')
}

// `joint` alone is deliberately absent: "joint venture" / "joint account" are common English.
const ATTACHMENT_WORDS: RegExp[] = [
  /\battach(?:ed|ment|ments|ing|es)?\b/gi,
  /\benclos(?:ed|ing|ure|ures)\b/gi,
  /\bpi[èe]ces?[\s-]+jointes?\b/gi,
  /\bci[\s-]?joint(?:e|es|s)?\b/gi,
  /\bci[\s-]?(?:inclus|incluse|incluses|annex[ée]e?s?)\b/gi,
  /\b(?:je|j['’]|nous)\s*(?:vous\s+|te\s+|t['’]\s*)?(?:joins|joint|ajoute en pi[èe]ce)\b/gi,
  /\ben\s+annexe\b/gi,
  /\bPJ\b/g
]
/** "no attachment", "without attachments", "sans pièce jointe" — a mention, but not a promise. */
const NEGATION_BEFORE = /(?:\b(?:no|not|without|nor|any|never)|\bsans|\baucune?|\bpas\s+de|\bn['’]a\s+pas\s+de)\s+(?:\w+\s+){0,1}$/i

export interface AttachmentMention { word: string }

/** The first attachment-sounding word in the author's own text, or null. */
export function findAttachmentMention(text: string): AttachmentMention | null {
  const body = ownText(text)
  for (const re of ATTACHMENT_WORDS) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(body))) {
      const before = body.slice(Math.max(0, m.index - 24), m.index)
      if (NEGATION_BEFORE.test(before)) continue
      return { word: m[0] }
    }
  }
  return null
}

// ------------------------------------------------------------ recipient domain sanity

/** Real, common mailbox domains: a typed domain that is one of these is never "a typo". */
export const COMMON_DOMAINS = [
  'gmail.com', 'googlemail.com', 'outlook.com', 'outlook.fr', 'hotmail.com', 'hotmail.fr', 'live.com',
  'live.fr', 'msn.com', 'yahoo.com', 'yahoo.fr', 'ymail.com', 'icloud.com', 'me.com', 'mac.com',
  'aol.com', 'orange.fr', 'wanadoo.fr', 'free.fr', 'sfr.fr', 'laposte.net', 'gmx.com', 'gmx.fr',
  'gmx.de', 'mail.com', 'protonmail.com', 'proton.me', 'pm.me', 'hey.com', 'fastmail.com', 'zoho.com',
  'bbox.fr', 'neuf.fr', 'numericable.fr'
]

/** Optimal-string-alignment distance (substitution, insert, delete, adjacent swap). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0
  const al = a.length
  const bl = b.length
  if (!al) return bl
  if (!bl) return al
  const d: number[][] = Array.from({ length: al + 1 }, () => new Array<number>(bl + 1).fill(0))
  for (let i = 0; i <= al; i++) d[i][0] = i
  for (let j = 0; j <= bl; j++) d[0][j] = j
  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  return d[al][bl]
}

export const domainOf = (email: string): string => {
  const at = email.lastIndexOf('@')
  return at < 0 ? '' : email.slice(at + 1).trim().toLowerCase()
}

const TLD_SLIPS = /^(con|cmo|vom|xom|ocm|cim|cm|om|comm|coom|rf|fe)$/

/**
 * `known` is a map of domain -> how often we have exchanged mail with it (own accounts and
 * frequent contacts). Returns the domain the user most likely meant, or null.
 *
 * Deliberately conservative: only distance 1, only against domains with a long-enough name
 * that a one-letter difference is meaningful, and never when the typed domain is itself
 * something we have mailed before (two real companies can differ by a letter).
 */
export function suggestDomain(typed: string, known: ReadonlyMap<string, number>): string | null {
  const d = typed.trim().toLowerCase()
  if (!d.includes('.') || known.has(d) || COMMON_DOMAINS.includes(d)) return null
  let best: { domain: string; weight: number } | null = null
  const consider = (candidate: string, weight: number): void => {
    if (candidate.length < 7 || Math.abs(candidate.length - d.length) > 1) return
    if (editDistance(d, candidate) !== 1) return
    // Distance 1 means the name or the TLD differs, never both. A different TLD is a different
    // (real) domain unless it is a classic slip like `.con` / `.cmo`.
    const dTld = d.slice(d.lastIndexOf('.') + 1)
    const cTld = candidate.slice(candidate.lastIndexOf('.') + 1)
    if (dTld !== cTld && !TLD_SLIPS.test(dTld)) return
    if (!best || weight > best.weight) best = { domain: candidate, weight }
  }
  for (const [dom, n] of known) consider(dom, 1000 + n)
  for (const dom of COMMON_DOMAINS) consider(dom, 1)
  return (best as { domain: string } | null)?.domain ?? null
}

export interface DomainTypo {
  address: Address
  typedDomain: string
  suggestedDomain: string
  /** Address with the domain corrected. */
  fixed: Address
}

export function findDomainTypos(recipients: Address[], known: ReadonlyMap<string, number>): DomainTypo[] {
  const out: DomainTypo[] = []
  for (const a of recipients) {
    const typed = domainOf(a.email)
    if (!typed) continue
    const suggested = suggestDomain(typed, known)
    if (!suggested) continue
    const local = a.email.slice(0, a.email.lastIndexOf('@'))
    out.push({ address: a, typedDomain: typed, suggestedDomain: suggested, fixed: { ...a, email: `${local}@${suggested}` } })
  }
  return out
}

// ------------------------------------------------------------ reply-all guard

const LIST_LOCAL = /^(?:list|lists|mailing|announce|announcements?|newsletter|everyone|discuss|devel|users)(?:[-_.].*)?$|[-_.](?:list|lists|users|devel|announce|discuss)$/i
const LIST_DOMAIN = /(?:^|\.)(?:googlegroups\.com|groups\.io|lists\.[a-z0-9.-]+|list\.[a-z0-9.-]+|mailman\.[a-z0-9.-]+|freelists\.org|yahoogroups\.com|listserv\.[a-z0-9.-]+)$/i

export function looksLikeMailingList(email: string): boolean {
  const at = email.lastIndexOf('@')
  if (at < 1) return false
  return LIST_LOCAL.test(email.slice(0, at)) || LIST_DOMAIN.test(email.slice(at + 1))
}

export const REPLY_ALL_THRESHOLD = 5

export interface ReplyAllNote {
  /** People other than you who will receive it. */
  count: number
  /** True when a recipient looks like a mailing list, or the original carried List-Unsubscribe. */
  list: boolean
}

/**
 * Discreet warning for a reply-all that reaches a crowd. Returns null when there is nothing
 * worth saying (fewer than {@link REPLY_ALL_THRESHOLD}+1 people and no list).
 */
export function replyAllNote(input: {
  mode: string
  to: Address[]
  cc: Address[]
  selfEmails: string[]
  /** The original message had a List-Unsubscribe header (a bulk / list mailing). */
  originalIsList?: boolean
}): ReplyAllNote | null {
  if (input.mode !== 'replyAll') return null
  const self = new Set(input.selfEmails.map((e) => e.toLowerCase()))
  const seen = new Set<string>()
  for (const a of [...input.to, ...input.cc]) {
    const e = a.email.trim().toLowerCase()
    if (e && !self.has(e)) seen.add(e)
  }
  const count = seen.size
  const list = !!input.originalIsList || [...seen].some(looksLikeMailingList)
  if (count > REPLY_ALL_THRESHOLD || (list && count > 1)) return { count, list }
  return null
}

// ------------------------------------------------------------ the send-time confirm bar

export type NudgeId = 'attachment' | 'subject' | 'empty' | 'typo'
export interface Nudge { id: NudgeId; text: string }

/** Everything worth a one-line "are you sure?" when Send is pressed. Order = importance. */
export function sendNudges(input: {
  subject: string
  bodyText: string
  attachmentCount: number
  /** Inline images count as "something attached". */
  hasInlineImage: boolean
  typos: DomainTypo[]
}): Nudge[] {
  const out: Nudge[] = []
  const nothingWritten = !input.bodyText.trim() && !input.attachmentCount && !input.hasInlineImage
  if (nothingWritten) out.push({ id: 'empty', text: 'This message is empty.' })
  if (input.typos.length) {
    const t = input.typos[0]
    out.push({ id: 'typo', text: `${t.typedDomain} looks like a typo of ${t.suggestedDomain}.` })
  }
  if (!input.attachmentCount && !input.hasInlineImage) {
    const m = findAttachmentMention(input.bodyText)
    if (m) out.push({ id: 'attachment', text: `You wrote “${m.word.toLowerCase()}” but nothing is attached.` })
  }
  if (!input.subject.trim()) out.push({ id: 'subject', text: 'No subject.' })
  return out
}
