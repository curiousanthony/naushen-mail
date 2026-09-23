/**
 * Reply / forward helpers: subjects, recipient sets and the quoted original.
 * Pure and provider-agnostic so both the composer and tests can use them.
 */

import type { Address, Message } from '@shared/types'
import { escapeHtml } from './escape'
import type { QuotedOriginal } from './types'

const RE_PREFIX = /^\s*(re|aw|sv|antw|res)\s*(\[\d+\])?\s*:\s*/i
const FWD_PREFIX = /^\s*(fwd?|tr|wg)\s*(\[\d+\])?\s*:\s*/i

/** `Re: ` is added once, however many times the thread has bounced around. */
export function replySubject(subject: string): string {
  const base = (subject ?? '').replace(RE_PREFIX, '').trim()
  return `Re: ${base}`
}

export function forwardSubject(subject: string): string {
  const base = (subject ?? '').replace(FWD_PREFIX, '').trim()
  return `Fwd: ${base}`
}

export const formatAddress = (a: Address): string => (a.name ? `${a.name} <${a.email}>` : a.email)

/** e.g. `12 Mar 2026 at 09:14`. `timeZone` is only passed by tests. */
export function formatQuoteDate(ts: number, timeZone?: string): string {
  const d = new Date(ts)
  const date = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone }).format(d)
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone }).format(d)
  return `${date} at ${time}`
}

/** "On 12 Mar 2026 at 09:14, Ada Lovelace wrote:" — the line above the quoted blockquote. */
export function quoteAttribution(from: Address, ts: number, timeZone?: string): string {
  const who = from.name || from.email
  return `On ${formatQuoteDate(ts, timeZone)}, ${who} wrote:`
}

/** The quoted original appended to a reply. `bodyHtml` must already be sanitised. */
export function buildQuoted(msg: Pick<Message, 'from' | 'date' | 'bodyHtml' | 'bodyText'>, timeZone?: string): QuotedOriginal {
  return {
    attribution: quoteAttribution(msg.from, msg.date, timeZone),
    html: msg.bodyHtml ?? undefined,
    text: msg.bodyText ?? undefined
  }
}

/** The `---------- Forwarded message ----------` header block a forward carries. */
export function forwardHeaderHtml(msg: Pick<Message, 'from' | 'to' | 'cc' | 'date' | 'subject'>, timeZone?: string): string {
  const rows: [string, string][] = [
    ['From', msg.from ? formatAddress(msg.from) : ''],
    ['Date', formatQuoteDate(msg.date, timeZone)],
    ['Subject', msg.subject ?? ''],
    ['To', (msg.to ?? []).map(formatAddress).join(', ')]
  ]
  if (msg.cc?.length) rows.push(['Cc', msg.cc.map(formatAddress).join(', ')])
  return '<p style="margin:0 0 12px;color:#6b6a66;font-size:13px">' +
    '---------- Forwarded message ----------<br />' +
    rows.filter(([, v]) => v).map(([k, v]) => `<strong>${k}:</strong> ${escapeHtml(v)}`).join('<br />') +
    '</p>'
}

const eq = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

/**
 * Recipients for a reply.
 * - `reply` goes to Reply-To (or the sender), unless you sent it yourself — then it keeps the original To.
 * - `replyAll` adds every other participant to Cc, minus your own addresses and duplicates.
 */
export function replyRecipients(
  msg: Pick<Message, 'from' | 'to' | 'cc' | 'replyTo'>,
  mode: 'reply' | 'replyAll',
  selfEmails: string[]
): { to: Address[]; cc: Address[] } {
  const self = selfEmails.map((e) => e.toLowerCase())
  const isSelf = (a: Address): boolean => self.some((e) => eq(e, a.email))
  const sentByMe = msg.from ? isSelf(msg.from) : false

  const primary: Address[] = sentByMe
    ? (msg.to ?? [])
    : [msg.replyTo ?? msg.from].filter((a): a is Address => !!a?.email)

  const to = unique(primary)
  if (mode === 'reply') return { to, cc: [] }

  const seen = new Set(to.map((a) => a.email.toLowerCase()))
  const cc = unique([...(msg.to ?? []), ...(msg.cc ?? [])]).filter((a) => {
    const k = a.email.toLowerCase()
    if (seen.has(k) || isSelf(a)) return false
    seen.add(k)
    return true
  })
  return { to, cc }
}

function unique(list: Address[]): Address[] {
  const seen = new Set<string>()
  const out: Address[] = []
  for (const a of list) {
    if (!a?.email) continue
    const k = a.email.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(a)
  }
  return out
}
