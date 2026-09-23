import type { View } from '@shared/types'

export const sortViews = (views: View[]): View[] => [...views].sort((a, b) => a.position - b.position)

/**
 * Move a view up/down (-1/+1) and renumber positions 0..n-1.
 * Returns the full new ordering and only the views whose position changed (to save).
 */
export function moveView(views: View[], id: string, delta: number): { ordered: View[]; changed: View[] } {
  const list = sortViews(views)
  const from = list.findIndex((v) => v.id === id)
  const to = Math.max(0, Math.min(list.length - 1, from + delta))
  if (from < 0 || from === to) return { ordered: list, changed: [] }
  const ids = list.map((v) => v.id)
  ;[ids[from], ids[to]] = [ids[to], ids[from]]
  return renumber(list, ids)
}

/** Reorder by an explicit id order (used by drag and drop). */
export function reorderViews(views: View[], orderedIds: string[]): { ordered: View[]; changed: View[] } {
  return renumber(sortViews(views), orderedIds)
}

function renumber(current: View[], ids: string[]): { ordered: View[]; changed: View[] } {
  const byId = new Map(current.map((v) => [v.id, v]))
  const ordered = ids.map((id, i) => ({ ...byId.get(id)!, position: i }))
  const changed = ordered.filter((v) => byId.get(v.id)!.position !== v.position)
  return { ordered, changed }
}

/** Move `id` so that it lands before `beforeId` (or at the end when null). Returns new id order. */
export function dropOrder(views: View[], id: string, beforeId: string | null): string[] {
  const ids = sortViews(views).map((v) => v.id).filter((x) => x !== id)
  const at = beforeId === null ? ids.length : ids.indexOf(beforeId)
  ids.splice(at < 0 ? ids.length : at, 0, id)
  return ids
}

const ROLE_NAME: Record<string, string> = {
  inbox: 'Inbox', sent: 'Sent', drafts: 'Drafts', trash: 'Trash', spam: 'Spam', archive: 'Archive', starred: 'Starred', important: 'Important', all: 'All mail'
}

/** One-line human summary of a view's filter, e.g. "Inbox · Unread · Has attachment". */
export function describeFilter(f: View['filter']): string {
  const parts: string[] = []
  if (f.role) parts.push(ROLE_NAME[f.role] ?? f.role)
  if (f.onlySnoozed) parts.push('Reminders')
  if (f.unread) parts.push('Unread')
  if (f.starred) parts.push('Starred')
  if (f.hasAttachment) parts.push('Has attachment')
  if (f.from?.length) parts.push(`From ${f.from.slice(0, 2).join(', ')}${f.from.length > 2 ? '…' : ''}`)
  if (f.to?.length) parts.push(`To ${f.to.slice(0, 2).join(', ')}`)
  if (f.subjectContains?.length) parts.push(`Subject “${f.subjectContains[0]}”`)
  if (f.text) parts.push(`“${f.text}”`)
  if (f.labelIds?.length) parts.push(`${f.labelIds.length} label${f.labelIds.length === 1 ? '' : 's'}`)
  if (f.accountIds?.length) parts.push(`${f.accountIds.length} account${f.accountIds.length === 1 ? '' : 's'}`)
  return parts.join(' · ') || 'All mail'
}
