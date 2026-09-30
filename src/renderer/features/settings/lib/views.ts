import i18n from 'i18next'
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

const t = (key: string, options?: Record<string, unknown>): string => i18n.t(key, { ns: 'settings', ...options }) as string

const ROLES = ['inbox', 'sent', 'drafts', 'trash', 'spam', 'archive', 'starred', 'important', 'all']

/** One-line human summary of a view's filter, e.g. "Inbox · Unread · Has attachment". */
export function describeFilter(f: View['filter']): string {
  const parts: string[] = []
  if (f.role) parts.push(ROLES.includes(f.role) ? t(`views.role.${f.role}`) : f.role)
  if (f.onlySnoozed) parts.push(t('views.filter.reminders'))
  if (f.unread) parts.push(t('views.filter.unread'))
  if (f.starred) parts.push(t('views.filter.starred'))
  if (f.hasAttachment) parts.push(t('views.filter.hasAttachment'))
  if (f.from?.length) parts.push(t('views.filter.from', { list: `${f.from.slice(0, 2).join(', ')}${f.from.length > 2 ? '…' : ''}` }))
  if (f.to?.length) parts.push(t('views.filter.to', { list: f.to.slice(0, 2).join(', ') }))
  if (f.subjectContains?.length) parts.push(t('views.filter.subject', { text: f.subjectContains[0] }))
  if (f.text) parts.push(t('views.filter.text', { text: f.text }))
  if (f.labelIds?.length) parts.push(t('views.filter.labels', { count: f.labelIds.length }))
  if (f.accountIds?.length) parts.push(t('views.filter.accounts', { count: f.accountIds.length }))
  return parts.join(' · ') || t('views.filter.all')
}
