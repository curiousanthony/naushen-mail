/**
 * Snippet variables: `{{first_name}}`, `{{date}}`, `{{my_name}}` … expanded at insert time
 * from the first recipient and the sending account. Pure (no editor, no clock reads that
 * the caller cannot inject) so it can be unit-tested.
 *
 *   {{first_name}}          -> "Ada"; left as written when there is no recipient yet
 *   {{first_name|there}}    -> "Ada", or "there" when unknown — a fallback never leaves braces behind
 *   {{cursor}}              -> nothing; marks where the caret lands after insertion
 */

import type { Address } from '@shared/types'
import type { DocNode } from '@shared/emailhtml'
import { currentLocale } from '@/i18n'

export interface SnippetContext {
  /** First recipient in To (falls back to Cc). */
  recipient?: Address | null
  /** Sending identity. */
  me?: { name?: string; email?: string } | null
  now?: Date
  /** BCP-47 tag for `{{date}}`; defaults to the UI language. */
  locale?: string
}

/** Private-use sentinel standing in for `{{cursor}}` while the doc is in flight. */
export const CURSOR_MARK = String.fromCharCode(0xe000)

const ROLE_LOCALS = new Set([
  'info', 'contact', 'hello', 'hi', 'admin', 'support', 'sales', 'team', 'office', 'mail', 'noreply', 'no-reply',
  'billing', 'accounts', 'accounting', 'hr', 'jobs', 'press', 'help', 'service', 'bonjour'
])

const cap = (s: string): string => (s ? s.charAt(0).toLocaleUpperCase() + s.slice(1) : s)

/** "Ada Lovelace", "Lovelace, Ada", "ada.lovelace@x" -> given name, or '' when we cannot tell. */
export function firstNameOf(a: Address | null | undefined): string {
  if (!a) return ''
  const name = (a.name ?? '').trim().replace(/^["']|["']$/g, '')
  if (name && !name.includes('@')) {
    if (name.includes(',')) return name.split(',')[1]?.trim().split(/\s+/)[0] ?? ''
    return name.split(/\s+/)[0]
  }
  const local = a.email.split('@')[0]?.toLowerCase() ?? ''
  if (ROLE_LOCALS.has(local) || !/[._-]/.test(local)) return ''
  const first = local.split(/[._-]+/)[0]
  return /^[a-zà-ÿ]{2,}$/i.test(first) ? cap(first) : ''
}

export function lastNameOf(a: Address | null | undefined): string {
  if (!a) return ''
  const name = (a.name ?? '').trim().replace(/^["']|["']$/g, '')
  if (!name || name.includes('@')) return ''
  if (name.includes(',')) return name.split(',')[0].trim()
  const parts = name.split(/\s+/)
  return parts.length > 1 ? parts.slice(1).join(' ') : ''
}

export function resolveVariable(key: string, ctx: SnippetContext): string | null {
  const k = key.trim().toLowerCase().replace(/[\s-]+/g, '_')
  const now = ctx.now ?? new Date()
  switch (k) {
    case 'first_name': return firstNameOf(ctx.recipient) || null
    case 'last_name': return lastNameOf(ctx.recipient) || null
    case 'full_name': return ctx.recipient?.name?.trim() || firstNameOf(ctx.recipient) || null
    case 'email': return ctx.recipient?.email || null
    case 'my_name': return ctx.me?.name?.trim() || null
    case 'my_first_name': return ctx.me?.name?.trim().split(/\s+/)[0] || null
    case 'my_email': return ctx.me?.email || null
    case 'date':
    case 'today':
      return new Intl.DateTimeFormat(ctx.locale ?? currentLocale(), { day: 'numeric', month: 'long', year: 'numeric' }).format(now)
    case 'weekday': return new Intl.DateTimeFormat(ctx.locale ?? currentLocale(), { weekday: 'long' }).format(now)
    case 'time': return new Intl.DateTimeFormat(ctx.locale ?? currentLocale(), { hour: '2-digit', minute: '2-digit' }).format(now)
    case 'cursor': return CURSOR_MARK
    default: return null
  }
}

const VAR = /\{\{\s*([a-zA-Z_ -]+?)\s*(?:\|([^}]*))?\}\}/g

/** Expand every `{{var}}` in a string. Unknown variables are left untouched. */
export function expandText(text: string, ctx: SnippetContext): string {
  return text.replace(VAR, (whole, key: string, fallback: string | undefined) => {
    const v = resolveVariable(key, ctx)
    if (v !== null) return v
    if (fallback !== undefined) return fallback.trim()
    return whole
  })
}

/** True when the snippet references any variable (used to skip work for plain snippets). */
export function hasVariables(text: string): boolean {
  VAR.lastIndex = 0
  return VAR.test(text)
}

/** Expand variables in every text node of a TipTap fragment. Returns a new tree. */
export function expandDoc<T extends DocNode>(doc: T, ctx: SnippetContext): T {
  const walk = (n: DocNode): DocNode => {
    const next: DocNode = { ...n }
    if (typeof n.text === 'string') next.text = expandText(n.text, ctx)
    if (n.content) next.content = n.content.map(walk).filter((c) => !(c.type === 'text' && !c.text))
    return next
  }
  return walk(doc) as T
}

/** Does this tree contain the caret sentinel? */
export function containsCursor(doc: DocNode): boolean {
  if (typeof doc.text === 'string' && doc.text.includes(CURSOR_MARK)) return true
  return !!doc.content?.some(containsCursor)
}
