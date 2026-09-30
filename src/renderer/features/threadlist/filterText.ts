/**
 * Localised wording for the filter bar. `@shared/filters` owns the model (property / operator keys,
 * enum keys) and keeps English labels for the main-process tests; everything the user reads in the
 * renderer goes through here so it follows the UI language. Functions (not constants) so a language
 * change is picked up on the next render.
 */
import type { AttachmentKind } from '@shared/types'
import { ENUM_VALUES, type FilterCondition, type FilterProp, type OpDef, type DescribeCtx } from '@shared/filters'
import i18n from '@/i18n'

const fixedT = (): ReturnType<typeof i18n.getFixedT> => i18n.getFixedT(null, 'threadlist')

export type FilterGroup = 'Status' | 'People' | 'Content' | 'Time'

export function groupText(g: FilterGroup): string {
  const t = fixedT()
  switch (g) {
    case 'Status': return t('filter.group.status')
    case 'People': return t('filter.group.people')
    case 'Content': return t('filter.group.content')
    case 'Time': return t('filter.group.time')
  }
}

export function propText(p: FilterProp): { label: string; hint: string } {
  const t = fixedT()
  switch (p) {
    case 'read': return { label: t('filter.prop.read.label'), hint: t('filter.prop.read.hint') }
    case 'starred': return { label: t('filter.prop.starred.label'), hint: t('filter.prop.starred.hint') }
    case 'reminder': return { label: t('filter.prop.reminder.label'), hint: t('filter.prop.reminder.hint') }
    case 'reply': return { label: t('filter.prop.reply.label'), hint: t('filter.prop.reply.hint') }
    case 'label': return { label: t('filter.prop.label.label'), hint: t('filter.prop.label.hint') }
    case 'account': return { label: t('filter.prop.account.label'), hint: t('filter.prop.account.hint') }
    case 'from': return { label: t('filter.prop.from.label'), hint: t('filter.prop.from.hint') }
    case 'recipient': return { label: t('filter.prop.recipient.label'), hint: t('filter.prop.recipient.hint') }
    case 'newsletter': return { label: t('filter.prop.newsletter.label'), hint: t('filter.prop.newsletter.hint') }
    case 'subject': return { label: t('filter.prop.subject.label'), hint: t('filter.prop.subject.hint') }
    case 'attachment': return { label: t('filter.prop.attachment.label'), hint: t('filter.prop.attachment.hint') }
    case 'invite': return { label: t('filter.prop.invite.label'), hint: t('filter.prop.invite.hint') }
    case 'size': return { label: t('filter.prop.size.label'), hint: t('filter.prop.size.hint') }
    case 'date': return { label: t('filter.prop.date.label'), hint: t('filter.prop.date.hint') }
  }
}

/** Operator wording for a property (`is`, `is any of`, `exists`, …). */
export function opText(prop: FilterProp, op: string): string {
  const t = fixedT()
  switch (prop) {
    case 'label': return t('filter.op.isAnyOf')
    case 'from': return op === 'domain' ? t('filter.op.isDomain') : t('filter.op.is')
    case 'subject': return t('filter.op.contains')
    case 'attachment':
      switch (op) {
        case 'any': return t('filter.op.exists')
        case 'none': return t('filter.op.doesNotExist')
        case 'type': return t('filter.op.isType')
        case 'larger': return t('filter.op.isLargerThan')
        default: return op
      }
    case 'size':
      switch (op) {
        case 'single': return t('filter.op.isSingleMessage')
        case 'conversation': return t('filter.op.isConversation')
        case 'atleast': return t('filter.op.hasAtLeast')
        default: return op
      }
    case 'date':
      switch (op) {
        case 'within': return t('filter.op.isWithin')
        case 'before': return t('filter.op.isBefore')
        case 'after': return t('filter.op.isAfter')
        case 'between': return t('filter.op.isBetween')
        default: return op
      }
    default: return t('filter.op.is')
  }
}

/** The operators of a property with their localised labels (keys come from the shared model). */
export const opOptions = (prop: FilterProp, keys: string[]): OpDef[] => keys.map((key) => ({ key, label: opText(prop, key) }))

/** Fixed value choices for enum-like properties (read status, starred, …). */
export function enumText(prop: FilterProp, key: string | undefined): string {
  const t = fixedT()
  switch (prop) {
    case 'read': return key === 'unread' ? t('filter.value.unread') : key === 'read' ? t('filter.value.read') : key ?? ''
    case 'starred': return key === 'yes' ? t('filter.value.starred') : key === 'no' ? t('filter.value.notStarred') : key ?? ''
    case 'recipient': return key === 'to' ? t('filter.value.toMe') : key === 'cc' ? t('filter.value.onlyCc') : key ?? ''
    case 'newsletter': case 'invite': return key === 'yes' ? t('filter.value.yes') : key === 'no' ? t('filter.value.no') : key ?? ''
    case 'reminder':
      switch (key) {
        case 'snoozed': return t('filter.value.snoozed')
        case 'reminder': return t('filter.value.waitingForReply')
        case 'any': return t('filter.value.either')
        case 'none': return t('filter.value.none')
        default: return key ?? ''
      }
    case 'reply':
      return key === 'awaiting' ? t('filter.value.awaiting') : key === 'needs' ? t('filter.value.needsReply') : key ?? ''
    default: return key ?? ''
  }
}

export const enumOptions = (prop: FilterProp): OpDef[] | undefined =>
  ENUM_VALUES[prop]?.map((o) => ({ key: o.key, label: enumText(prop, o.key) }))

export function datePresetText(key: string | undefined): string {
  const t = fixedT()
  switch (key) {
    case 'today': return t('filter.preset.today')
    case '7d': return t('filter.preset.days7')
    case '30d': return t('filter.preset.days30')
    case '90d': return t('filter.preset.days90')
    case 'year': return t('filter.preset.year')
    default: return ''
  }
}

export const datePresets = (): OpDef[] => ['today', '7d', '30d', '90d', 'year'].map((key) => ({ key, label: datePresetText(key) }))

export function attachmentKindText(k: AttachmentKind | string): string {
  const t = fixedT()
  switch (k) {
    case 'pdf': return t('filter.attachmentKind.pdf')
    case 'image': return t('filter.attachmentKind.image')
    case 'document': return t('filter.attachmentKind.document')
    case 'spreadsheet': return t('filter.attachmentKind.spreadsheet')
    case 'presentation': return t('filter.attachmentKind.presentation')
    case 'archive': return t('filter.attachmentKind.archive')
    default: return k
  }
}

export const attachmentKinds = (): { key: AttachmentKind; label: string }[] =>
  (['pdf', 'image', 'document', 'spreadsheet', 'presentation', 'archive'] as const).map((key) => ({ key, label: attachmentKindText(key) }))

/** Chip text: `[property, operator, value]`, localised. Mirrors `describeCondition` in `@shared/filters`. */
export function describeConditionText(c: FilterCondition, ctx: DescribeCtx): [string, string, string] {
  const t = fixedT()
  const prop = propText(c.prop).label
  const op = opText(c.prop, c.op)
  const shortList = (xs: string[]): string => (xs.length > 2 ? `${xs.slice(0, 2).join(', ')} +${xs.length - 2}` : xs.join(', '))
  switch (c.prop) {
    case 'label': return [prop, op, shortList((c.values ?? []).map(ctx.labelName)) || '…']
    case 'account': return [prop, op, shortList((c.values ?? []).map(ctx.accountName)) || '…']
    case 'from': case 'subject': return [prop, op, c.value?.trim() || '…']
    case 'attachment':
      if (c.op === 'type') return [prop, op, shortList((c.values ?? []).map(attachmentKindText)) || '…']
      if (c.op === 'larger') return [prop, op, t('filter.megabytes', { n: c.n ?? 1 })]
      return [prop, op, '']
    case 'size':
      return [prop, op, c.op === 'atleast' ? t('filter.messageCount', { count: c.n ?? 2 }) : '']
    case 'date': {
      if (c.op === 'within') return [prop, op, datePresetText(c.value)]
      if (c.op === 'between') return [prop, op, t('filter.dateBetween', { from: c.from || '…', to: c.to || '…' })]
      return [prop, op, (c.op === 'before' ? c.to : c.from) || '…']
    }
    default: return [prop, op, enumText(c.prop, c.value)]
  }
}
