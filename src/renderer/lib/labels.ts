import type { Label, LabelColor } from '@shared/types'
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
 */
export function expandLabelIds(labels: Label[], labelId: string, accountId: string): string[] {
  const l = labels.find((x) => x.id === labelId)
  if (!l || l.kind !== 'user') return [labelId]
  const key = nameKey(l.name)
  const same = labels.filter((x) => x.kind === 'user' && nameKey(x.name) === key && (accountId === 'all' || x.accountId === accountId))
  return same.length ? same.map((x) => x.id) : [labelId]
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
