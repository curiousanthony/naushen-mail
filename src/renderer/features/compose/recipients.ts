/**
 * Recipient parsing for the To/Cc/Bcc chip fields. Pure — the field component only
 * decides *when* to commit text; this decides what the text means.
 */

import type { Address } from '@shared/types'
import { findAttachmentMention } from './safety'

/**
 * Pragmatic address check. Deliberately not RFC 5322 (which permits quoted local parts
 * and comments nobody types): one `@`, a non-empty local part, a dotted domain, no spaces.
 */
export function isValidEmail(email: string): boolean {
  return /^[^\s@,;<>"]+@[^\s@,;<>".]+(\.[^\s@,;<>".]+)+$/.test(email.trim())
}

/** `Ada Lovelace <ada@x.test>`, `"Ada" <ada@x.test>`, `ada@x.test`, `<ada@x.test>`. */
export function parseAddress(raw: string): Address | null {
  const s = raw.trim().replace(/,$/, '').trim()
  if (!s) return null
  const angled = /^(.*?)<([^>]*)>$/.exec(s)
  if (angled) {
    const name = angled[1].trim().replace(/^["']|["']$/g, '').trim()
    const email = angled[2].trim()
    return { email, ...(name ? { name } : {}) }
  }
  // `Ada Lovelace ada@x.test` (pasted from some clients)
  const trailing = /^(.+)\s+([^\s]+@[^\s]+)$/.exec(s)
  if (trailing && isValidEmail(trailing[2])) {
    const name = trailing[1].trim().replace(/^["']|["']$/g, '').trim()
    return { email: trailing[2], ...(name ? { name } : {}) }
  }
  return { email: s }
}

/**
 * Split pasted text into addresses. Commas, semicolons and newlines separate, but not
 * inside `"…"` or `<…>` — `"Lovelace, Ada" <ada@x.test>` is one address.
 */
export function splitAddressList(input: string): string[] {
  const out: string[] = []
  let buf = ''
  let quote = false
  let angleDepth = 0
  for (const ch of input) {
    if (ch === '"') { quote = !quote; buf += ch; continue }
    if (!quote && ch === '<') { angleDepth++; buf += ch; continue }
    if (!quote && ch === '>') { angleDepth = Math.max(0, angleDepth - 1); buf += ch; continue }
    if (!quote && angleDepth === 0 && (ch === ',' || ch === ';' || ch === '\n' || ch === '\r')) {
      if (buf.trim()) out.push(buf.trim())
      buf = ''
      continue
    }
    buf += ch
  }
  if (buf.trim()) out.push(buf.trim())
  return out
}

/** Parse a whole pasted blob into addresses, dropping blanks and duplicates. */
export function parseAddressList(input: string): Address[] {
  return dedupeAddresses(splitAddressList(input).map(parseAddress).filter((a): a is Address => !!a && !!a.email))
}

export function dedupeAddresses(list: Address[]): Address[] {
  const seen = new Set<string>()
  const out: Address[] = []
  for (const a of list) {
    const key = a.email.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(a)
  }
  return out
}

/** What a chip shows: the name when we have one, otherwise the address. */
export function chipLabel(a: Address): string {
  return a.name?.trim() || a.email
}

export function formatAddress(a: Address): string {
  return a.name?.trim() ? `${a.name.trim()} <${a.email}>` : a.email
}

/** True when the typed text should become a chip right now (the user typed a separator). */
export function shouldCommit(text: string): boolean {
  return /[,;\n]/.test(text)
}

// ------------------------------------------------------------------ pre-send validation

export interface ComposeValidation {
  /** Blocks sending. */
  errors: string[]
  /** Shown in a confirm dialog; the user can send anyway. */
  warnings: string[]
}

export function validateCompose(input: {
  to: Address[]
  cc: Address[]
  bcc: Address[]
  subject: string
  bodyText: string
  attachmentCount: number
}): ComposeValidation {
  const errors: string[] = []
  const warnings: string[] = []
  const all = [...input.to, ...input.cc, ...input.bcc]

  if (!all.length) errors.push('Add at least one recipient.')
  const invalid = all.filter((a) => !isValidEmail(a.email))
  if (invalid.length) {
    errors.push(invalid.length === 1
      ? `${invalid[0].email} is not a valid email address.`
      : `${invalid.length} recipients are not valid email addresses.`)
  }
  if (!input.subject.trim()) warnings.push('This message has no subject.')
  if (!input.bodyText.trim() && !input.attachmentCount) warnings.push('This message is empty.')
  if (!input.attachmentCount && findAttachmentMention(input.bodyText)) {
    warnings.push('You mentioned an attachment but nothing is attached.')
  }
  return { errors, warnings }
}
