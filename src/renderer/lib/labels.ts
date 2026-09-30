import type { Label, LabelColor, SystemRole } from '@shared/types'
import i18n from '@/i18n'

/** Localised name of a system mailbox (Inbox, Sent, …). */
export function roleName(role: SystemRole): string {
  switch (role) {
    case 'inbox': return i18n.t('common:role.inbox')
    case 'sent': return i18n.t('common:role.sent')
    case 'drafts': return i18n.t('common:role.drafts')
    case 'trash': return i18n.t('common:role.trash')
    case 'spam': return i18n.t('common:role.spam')
    case 'archive': return i18n.t('common:role.archive')
    case 'starred': return i18n.t('common:role.starred')
    case 'important': return i18n.t('common:role.important')
    case 'all': return i18n.t('common:role.all')
  }
}

/** Localised name of a label colour (used for swatch tooltips). */
export function colorName(c: LabelColor): string {
  switch (c) {
    case 'gray': return i18n.t('common:color.gray')
    case 'brown': return i18n.t('common:color.brown')
    case 'orange': return i18n.t('common:color.orange')
    case 'yellow': return i18n.t('common:color.yellow')
    case 'green': return i18n.t('common:color.green')
    case 'blue': return i18n.t('common:color.blue')
    case 'purple': return i18n.t('common:color.purple')
    case 'pink': return i18n.t('common:color.pink')
    case 'red': return i18n.t('common:color.red')
  }
}

export const chipStyle = (c?: LabelColor): { color: string; background: string } => ({
  color: `var(--chip-${c ?? 'gray'}-fg)`, background: `var(--chip-${c ?? 'gray'}-bg)`
})

const nameKey = (name: string): string => name.trim().toLowerCase()

/**
 * The label ids a label navigation should query. With "All accounts" selected, same-named labels
 * (case-insensitive) across accounts are ONE label to the user, so they all count. With a single
 * account selected it is that account's own label of that name. Pure, so both the sidebar and
 * `navToFilter` agree — which also means switching account while viewing a label keeps working
 * instead of querying a label id that belongs to the account you just left.
 *
 * Category labels (Gmail's Social/Promotions/Updates/Forums/Primary) group the same way, but by
 * `remoteId` (CATEGORY_SOCIAL etc.) rather than name — the friendly name is fixed, not user text.
 */
export function expandLabelIds(labels: Label[], labelId: string, accountId: string): string[] {
  const l = labels.find((x) => x.id === labelId)
  if (!l) return [labelId]
  if (l.kind === 'user') {
    const key = nameKey(l.name)
    const same = labels.filter((x) => x.kind === 'user' && nameKey(x.name) === key && (accountId === 'all' || x.accountId === accountId))
    return same.length ? same.map((x) => x.id) : [labelId]
  }
  if (l.kind === 'category') {
    const same = labels.filter((x) => x.kind === 'category' && x.remoteId === l.remoteId && (accountId === 'all' || x.accountId === accountId))
    return same.length ? same.map((x) => x.id) : [labelId]
  }
  return [labelId]
}

/** One entry per distinct label name (first wins) when viewing all accounts; unchanged otherwise. */
export function dedupeLabels(labels: Label[], accountId: string): Label[] {
  if (accountId !== 'all') return labels
  const seen = new Set<string>()
  return labels.filter((l) => {
    const k = nameKey(l.name)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}
