/**
 * Filter conditions: the Notion-database-style "property · operator · value" model behind the
 * thread list's Filter bar. Pure (no React, no DOM, no SQLite) so the renderer, the main process
 * tests and saved views all share one definition.
 *
 * A condition list compiles to a `ThreadFilter` patch (`compileConditions`), which the store
 * merges into the nav's own filter (`mergeFilters`) and the repo turns into SQL. Everything is
 * therefore evaluated locally against SQLite, over the whole mailbox rather than just the rows
 * already loaded. Saved views keep storing a plain `ThreadFilter`, so nothing about their format
 * changes: `compileConditions` output is a valid view filter.
 */
import type { AttachmentKind, ThreadFilter } from './types'

export type FilterProp =
  | 'read' | 'starred' | 'attachment' | 'date' | 'from' | 'recipient' | 'label' | 'account'
  | 'newsletter' | 'invite' | 'reminder' | 'size' | 'reply' | 'subject'

export interface FilterCondition {
  id: string
  prop: FilterProp
  /** Operator key; the valid keys per property are in `PROPS[prop].ops`. */
  op: string
  /** Single value: enum key, free text, or a preset key. */
  value?: string
  /** Multi value (labels, accounts, attachment kinds). */
  values?: string[]
  /** Number (megabytes, message count). */
  n?: number
  /** Custom date bounds, `YYYY-MM-DD` in local time. */
  from?: string
  to?: string
}

export interface OpDef { key: string; label: string }
export interface PropDef { key: FilterProp; label: string; group: string; ops: OpDef[]; hint: string }

export const PROP_GROUPS = ['Status', 'People', 'Content', 'Time'] as const

export const PROPS: Record<FilterProp, PropDef> = {
  read: { key: 'read', label: 'Read status', group: 'Status', hint: 'Unread or already read', ops: [{ key: 'is', label: 'is' }] },
  starred: { key: 'starred', label: 'Starred', group: 'Status', hint: 'Flagged with a star', ops: [{ key: 'is', label: 'is' }] },
  reminder: { key: 'reminder', label: 'Reminder', group: 'Status', hint: 'Snoozed or waiting on a reply', ops: [{ key: 'is', label: 'is' }] },
  reply: { key: 'reply', label: 'Reply status', group: 'Status', hint: 'Who wrote last', ops: [{ key: 'is', label: 'is' }] },
  label: { key: 'label', label: 'Label', group: 'Status', hint: 'Any of the chosen labels', ops: [{ key: 'any', label: 'is any of' }] },
  account: { key: 'account', label: 'Account', group: 'Status', hint: 'Which mailbox', ops: [{ key: 'is', label: 'is' }] },
  from: { key: 'from', label: 'From', group: 'People', hint: 'Sender name, address or domain', ops: [{ key: 'contains', label: 'is' }, { key: 'domain', label: 'is domain' }] },
  recipient: { key: 'recipient', label: 'Sent to', group: 'People', hint: 'To me directly, or only Cc’d', ops: [{ key: 'is', label: 'is' }] },
  newsletter: { key: 'newsletter', label: 'Newsletter', group: 'People', hint: 'Has an unsubscribe link', ops: [{ key: 'is', label: 'is' }] },
  subject: { key: 'subject', label: 'Subject', group: 'Content', hint: 'Subject contains a word', ops: [{ key: 'contains', label: 'contains' }] },
  attachment: {
    key: 'attachment', label: 'Attachment', group: 'Content', hint: 'Files, by type or size',
    ops: [{ key: 'any', label: 'exists' }, { key: 'none', label: 'does not exist' }, { key: 'type', label: 'is type' }, { key: 'larger', label: 'is larger than' }]
  },
  invite: { key: 'invite', label: 'Calendar invite', group: 'Content', hint: 'Carries an .ics invite', ops: [{ key: 'is', label: 'is' }] },
  size: {
    key: 'size', label: 'Conversation length', group: 'Content', hint: 'Single message or long thread',
    ops: [{ key: 'single', label: 'is a single message' }, { key: 'conversation', label: 'is a conversation' }, { key: 'atleast', label: 'has at least' }]
  },
  date: {
    key: 'date', label: 'Date', group: 'Time', hint: 'When the last message arrived',
    ops: [{ key: 'within', label: 'is within' }, { key: 'before', label: 'is before' }, { key: 'after', label: 'is after' }, { key: 'between', label: 'is between' }]
  }
}

/** Picker order within each group. */
export const PROP_ORDER: FilterProp[] = [
  'read', 'starred', 'reminder', 'reply', 'label', 'account',
  'from', 'recipient', 'newsletter',
  'subject', 'attachment', 'invite', 'size',
  'date'
]

export const DATE_PRESETS: OpDef[] = [
  { key: 'today', label: 'today' }, { key: '7d', label: 'past 7 days' }, { key: '30d', label: 'past 30 days' },
  { key: '90d', label: 'past 90 days' }, { key: 'year', label: 'this year' }
]

export const ATTACHMENT_KINDS: { key: AttachmentKind; label: string }[] = [
  { key: 'pdf', label: 'PDF' }, { key: 'image', label: 'Image' }, { key: 'document', label: 'Document' },
  { key: 'spreadsheet', label: 'Spreadsheet' }, { key: 'presentation', label: 'Presentation' }, { key: 'archive', label: 'Archive' }
]

export const ENUM_VALUES: Partial<Record<FilterProp, OpDef[]>> = {
  read: [{ key: 'unread', label: 'Unread' }, { key: 'read', label: 'Read' }],
  starred: [{ key: 'yes', label: 'Starred' }, { key: 'no', label: 'Not starred' }],
  recipient: [{ key: 'to', label: 'To me' }, { key: 'cc', label: 'Only Cc’d' }],
  newsletter: [{ key: 'yes', label: 'A newsletter / mailing list' }, { key: 'no', label: 'Not a newsletter' }],
  invite: [{ key: 'yes', label: 'Included' }, { key: 'no', label: 'Not included' }],
  reminder: [{ key: 'snoozed', label: 'Snoozed' }, { key: 'reminder', label: 'Waiting for a reply' }, { key: 'any', label: 'Either' }, { key: 'none', label: 'None' }],
  reply: [{ key: 'awaiting', label: 'Awaiting their reply (I wrote last)' }, { key: 'needs', label: 'Needs my reply (they wrote last)' }]
}

const DAY = 86_400_000

/** Default condition for a freshly picked property. */
export function newCondition(prop: FilterProp, id: string): FilterCondition {
  const op = PROPS[prop].ops[0].key
  switch (prop) {
    case 'read': return { id, prop, op, value: 'unread' }
    case 'starred': return { id, prop, op, value: 'yes' }
    case 'recipient': return { id, prop, op, value: 'to' }
    case 'newsletter': return { id, prop, op, value: 'yes' }
    case 'invite': return { id, prop, op, value: 'yes' }
    case 'reminder': return { id, prop, op, value: 'any' }
    case 'reply': return { id, prop, op, value: 'awaiting' }
    case 'date': return { id, prop, op: 'within', value: '7d' }
    case 'attachment': return { id, prop, op: 'any' }
    case 'size': return { id, prop, op: 'conversation', n: 3 }
    default: return { id, prop, op }
  }
}

/** Does this condition constrain anything yet? (an empty text box or empty label list does not). */
export function isActive(c: FilterCondition): boolean {
  switch (c.prop) {
    case 'from': case 'subject': return !!c.value?.trim()
    case 'label': case 'account': return !!c.values?.length
    case 'date':
      if (c.op === 'within') return !!c.value
      if (c.op === 'before') return parseDay(c.to) !== null
      if (c.op === 'after') return parseDay(c.from) !== null
      return parseDay(c.from) !== null || parseDay(c.to) !== null
    case 'attachment': return c.op !== 'type' || !!c.values?.length
    default: return true
  }
}

/** Local-midnight ms for a `YYYY-MM-DD` string, or null when malformed. */
export function parseDay(s: string | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '')
  if (!m) return null
  const d = new Date(+m[1], +m[2] - 1, +m[3])
  return Number.isNaN(d.getTime()) ? null : d.getTime()
}

/** Start of a rolling preset window ("past 7 days", "today", "this year") relative to `now`. */
export function resolveRecent(recent: NonNullable<ThreadFilter['recent']>, now: number): number {
  switch (recent) {
    case 'today': { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime() }
    case '7d': return now - 7 * DAY
    case '30d': return now - 30 * DAY
    case '90d': return now - 90 * DAY
    case 'year': return new Date(new Date(now).getFullYear(), 0, 1).getTime()
  }
}

function dateRange(c: FilterCondition, _now: number): ThreadFilter {
  // Presets stay symbolic (`recent`) so a saved view keeps rolling instead of freezing at save time.
  if (c.op === 'within') return c.value ? { recent: c.value as ThreadFilter['recent'] } : {}
  const from = parseDay(c.from), to = parseDay(c.to)
  const out: ThreadFilter = {}
  // "before 5 Mar" excludes 5 Mar itself; "after 5 Mar" starts on the 6th; "between" includes both days.
  if (c.op === 'before' && to !== null) out.before = to - 1
  else if (c.op === 'after' && from !== null) out.after = from + DAY
  else if (c.op === 'between') {
    if (from !== null) out.after = from
    if (to !== null) out.before = to + DAY - 1
  }
  return out
}

/** One condition to its ThreadFilter patch ({} when inactive). */
export function compileCondition(c: FilterCondition, now = Date.now()): ThreadFilter {
  if (!isActive(c)) return {}
  switch (c.prop) {
    case 'read': return { unread: c.value === 'unread' }
    case 'starred': return { starred: c.value !== 'no' }
    case 'label': return { labelGroups: [c.values ?? []] }
    case 'account': return { accountIds: c.values }
    case 'from': {
      const v = c.value!.trim()
      return { from: [c.op === 'domain' ? `@${v.replace(/^@/, '')}` : v] }
    }
    case 'recipient': return { addressedTo: c.value === 'cc' ? 'cc' : 'to' }
    case 'newsletter': return { hasUnsubscribe: c.value !== 'no' }
    case 'invite': return { hasInvite: c.value !== 'no' }
    case 'reminder': return { reminderState: (c.value as ThreadFilter['reminderState']) ?? 'any' }
    case 'reply': return { lastFrom: c.value === 'needs' ? 'them' : 'me' }
    case 'subject': return { subjectAll: [c.value!.trim()] }
    case 'attachment':
      if (c.op === 'none') return { hasAttachment: false }
      if (c.op === 'type') return { hasAttachment: true, attachmentKinds: c.values as AttachmentKind[] }
      if (c.op === 'larger') return { hasAttachment: true, minAttachmentSize: Math.max(1, c.n ?? 1) * 1024 * 1024 }
      return { hasAttachment: true }
    case 'size':
      if (c.op === 'single') return { maxMessages: 1 }
      if (c.op === 'conversation') return { minMessages: 2 }
      return { minMessages: Math.max(1, Math.floor(c.n ?? 2)) }
    case 'date': return dateRange(c, now)
  }
}

/**
 * AND two filters. Arrays that are "all of" concatenate; scalar bounds tighten; everything else
 * takes the patch's value. Account lists intersect (an empty intersection matches nothing).
 */
export function mergeFilters(base: ThreadFilter, patch: ThreadFilter): ThreadFilter {
  const out: ThreadFilter = { ...base }
  for (const [k, v] of Object.entries(patch) as [keyof ThreadFilter, unknown][]) {
    if (v === undefined) continue
    switch (k) {
      case 'from': case 'to': case 'subjectAll': case 'labelGroups':
        (out as Record<string, unknown>)[k] = [...((base[k] as unknown[] | undefined) ?? []), ...(v as unknown[])]
        break
      case 'accountIds': {
        const a = base.accountIds
        out.accountIds = a?.length ? (v as string[]).filter((x) => a.includes(x)) : (v as string[])
        if (!out.accountIds.length) out.accountIds = ['\u0000none']
        break
      }
      case 'recent': out.recent = v as ThreadFilter['recent']; break
      case 'after': out.after = Math.max(base.after ?? 0, v as number); break
      case 'before': out.before = base.before ? Math.min(base.before, v as number) : (v as number); break
      case 'minMessages': out.minMessages = Math.max(base.minMessages ?? 0, v as number); break
      case 'maxMessages': out.maxMessages = base.maxMessages ? Math.min(base.maxMessages, v as number) : (v as number); break
      case 'minAttachmentSize': out.minAttachmentSize = Math.max(base.minAttachmentSize ?? 0, v as number); break
      default: (out as Record<string, unknown>)[k] = v
    }
  }
  return out
}

/** All conditions AND-ed into one ThreadFilter patch. */
export function compileConditions(cs: FilterCondition[], now = Date.now()): ThreadFilter {
  return cs.reduce<ThreadFilter>((acc, c) => mergeFilters(acc, compileCondition(c, now)), {})
}

export const activeCount = (cs: FilterCondition[]): number => cs.filter(isActive).length

export interface DescribeCtx { labelName(id: string): string; accountName(id: string): string }

/** Chip text: `[property, operator, value]`. */
export function describeCondition(c: FilterCondition, ctx: DescribeCtx): [string, string, string] {
  const def = PROPS[c.prop]
  const opLabel = def.ops.find((o) => o.key === c.op)?.label ?? c.op
  const enumLabel = (v?: string): string => ENUM_VALUES[c.prop]?.find((e) => e.key === v)?.label ?? v ?? ''
  const shortList = (xs: string[]): string => (xs.length > 2 ? `${xs.slice(0, 2).join(', ')} +${xs.length - 2}` : xs.join(', '))
  switch (c.prop) {
    case 'label': return [def.label, opLabel, shortList((c.values ?? []).map(ctx.labelName)) || '…']
    case 'account': return [def.label, opLabel, shortList((c.values ?? []).map(ctx.accountName)) || '…']
    case 'from': case 'subject': return [def.label, opLabel, c.value?.trim() || '…']
    case 'attachment':
      if (c.op === 'type') return [def.label, opLabel, shortList((c.values ?? []).map((k) => ATTACHMENT_KINDS.find((a) => a.key === k)?.label ?? k)) || '…']
      if (c.op === 'larger') return [def.label, opLabel, `${c.n ?? 1} MB`]
      return [def.label, opLabel, '']
    case 'size':
      return [def.label, opLabel, c.op === 'atleast' ? `${c.n ?? 2} messages` : '']
    case 'date': {
      if (c.op === 'within') return [def.label, opLabel, DATE_PRESETS.find((p) => p.key === c.value)?.label ?? '']
      if (c.op === 'between') return [def.label, opLabel, `${c.from || '…'} and ${c.to || '…'}`]
      return [def.label, opLabel, (c.op === 'before' ? c.to : c.from) || '…']
    }
    default: return [def.label, opLabel, enumLabel(c.value)]
  }
}
