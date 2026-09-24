/**
 * One-time verification code detection. Pure: text in, code out. Unit-tested against a corpus of
 * positives (EN + FR) and look-alikes (prices, phone numbers, dates, order numbers, promo codes).
 *
 * The rule is "a 4-8 digit token that is *grammatically* the code": a code keyword ("code", "OTP",
 * "PIN", "passcode", "one-time password"…) with only filler words between it and the digits
 * ("is", "your", "below:"), in either order ("482913 is your code"). Anything else that merely
 * *looks* like a code is rejected, because copying the wrong number is worse than not offering.
 */

/** A code is only offered for this long after the mail arrived. */
export const CODE_TTL_MS = 10 * 60 * 1000

/** Codes are 4-8 digits. Some senders group them ("123 456", "123-456"). */
const DIGITS = String.raw`(\d{3,4}[  -]\d{3,4}|\d{4,8})`

const KEYWORD = String.raw`(?:code|codes|otp|passcode|pass code|pin|one[- ]time (?:password|pass)|mot de passe (?:à|a) usage unique|mdp)`

/** Words that may sit between the keyword and the digits without changing the meaning. */
const FILLER = String.raw`(?:is|est|are|was|:|=|as|use|using|utilisez|entrez|enter|type|saisissez|your|the|this|votre|ton|le|la|a|an|below|ci-dessous|following|suivant|provided|fourni|here|voici|for|pour|to|verify|valider|vérifier|verification|vérification|de|d|:)`

const BEFORE = new RegExp(
  String.raw`(?:^|[^\p{L}\p{N}])${KEYWORD}(?:\s+(?:de|d')\s*(?:vérification|verification|confirmation|sécurité|security|connexion|login|validation|accès|access)|\s+(?:à|a)\s+usage\s+unique)?` +
  String.raw`((?:[\s:：=\-–—.,'’"“”«»()\[\]*]|${FILLER}(?![\p{L}\p{N}]))*)$`,
  'iu'
)

const AFTER = new RegExp(
  String.raw`^\s*(?:is|est|as|=|—|-)\s+(?:your|the|votre|ton|le|a|an)\s+(?:[\p{L}'’-]+\s+){0,3}?${KEYWORD}(?![\p{L}\p{N}])`,
  'iu'
)

/** What is directly in front of the digits marks them as something else. */
const NOT_A_CODE_BEFORE =
  /(?:[$€£¥#№/+]\s*|\d[.,]|(?<![\p{L}])(?:order|commande|invoice|facture|tracking|suivi|ref|reference|référence|ticket|case|account|compte|amount|total|montant|price|prix|phone|tel|tél|zip|postal|n°|no|nr)\s*[:.]?\s*)$/iu
/** …and what follows can too: decimals, dates, times, percentages, more digit groups, units. */
const NOT_A_CODE_AFTER = /^(?:[.,:/]\d|%|[  -]\d|\s*(?:€|£|\$|eur\b|usd\b|gbp\b))/i

/** Google's "G-123456" form. */
const G_CODE = /(?<![\p{L}\p{N}])G-(\d{6})(?![\p{L}\p{N}])/u

function normalise(text: string): string {
  return text.replace(/[​-‍⁠﻿]/g, '').replace(/\s+/g, ' ')
}

/**
 * Find a verification code in free text (subject + snippet or body), or null.
 * If several candidates qualify the first in reading order wins.
 */
export function detectVerificationCode(input: string | null | undefined): string | null {
  if (!input) return null
  const text = normalise(input.slice(0, 4000))
  if (text.length < 4) return null

  const g = G_CODE.exec(text)
  const candidates: { index: number; code: string }[] = []
  if (g) candidates.push({ index: g.index, code: g[1] })

  const re = new RegExp(String.raw`(?<![\p{L}\p{N}])${DIGITS}(?![\p{L}\p{N}])`, 'gu')
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0
    const end = start + m[0].length
    const before = text.slice(Math.max(0, start - 90), start)
    const after = text.slice(end, end + 70)
    // A leading "-" that glues the digits to a previous group ("555-123-4567") is not a code.
    if (/\d[-  ]$/.test(before.slice(-2))) continue
    if (NOT_A_CODE_BEFORE.test(before)) continue
    if (NOT_A_CODE_AFTER.test(after)) continue
    const digits = m[1].replace(/\D/g, '')
    if (digits.length < 4 || digits.length > 8) continue
    if (BEFORE.test(before) || AFTER.test(after)) candidates.push({ index: start, code: digits })
  }
  if (!candidates.length) return null
  candidates.sort((a, b) => a.index - b.index)
  return candidates[0].code
}

export interface ActiveCode {
  code: string
  /** Epoch ms after which the chip should disappear. */
  expiresAt: number
}

/**
 * A code that is still worth offering: detected in `text` and received no more than ten minutes
 * before `now`. A timestamp slightly in the future (clock skew) counts as "just now".
 */
export function activeVerificationCode(
  text: string | null | undefined, receivedAt: number, now: number = Date.now()
): ActiveCode | null {
  if (!Number.isFinite(receivedAt)) return null
  const expiresAt = receivedAt + CODE_TTL_MS
  if (now >= expiresAt) return null
  const code = detectVerificationCode(text)
  return code ? { code, expiresAt } : null
}

// ---------------------------------------------------------------- messages / threads

interface CodeSource {
  subject?: string
  snippet?: string
  bodyText?: string | null
  bodyHtml?: string | null
  date: number
}

/** Plain text of a message for detection: subject, snippet and the start of the body. */
export function messageCodeText(m: Omit<CodeSource, 'date'>): string {
  let body = m.bodyText ?? ''
  if (!body.trim() && m.bodyHtml) {
    body = m.bodyHtml.slice(0, 8000)
      .replace(/<(?:style|script)[\s\S]*?<\/(?:style|script)>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;|&#160;/gi, ' ')
  }
  return `${m.subject ?? ''}\n${m.snippet ?? ''}\n${body.slice(0, 2000)}`
}

/** The newest message in a thread that carries a code which has not expired yet. */
export function newestActiveCode(messages: CodeSource[], now: number = Date.now()): ActiveCode | null {
  const byNewest = [...messages].sort((a, b) => b.date - a.date)
  for (const m of byNewest) {
    if (now >= m.date + CODE_TTL_MS) break // everything after this is older still
    const hit = activeVerificationCode(messageCodeText(m), m.date, now)
    if (hit) return hit
  }
  return null
}
