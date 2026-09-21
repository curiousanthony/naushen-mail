import { format, isThisYear, isToday, isYesterday, startOfDay, differenceInCalendarDays } from 'date-fns'
import type { Address } from '@shared/types'

/** List-row time: "3:42 PM", "Yesterday", "Mon", "Oct 12", "Oct 12, 2024". */
export function listTime(ts: number, now = Date.now()): string {
  const d = new Date(ts)
  if (isToday(d)) return format(d, 'h:mm a')
  if (isYesterday(d)) return 'Yesterday'
  if (differenceInCalendarDays(now, d) < 7) return format(d, 'EEE')
  return isThisYear(d) ? format(d, 'MMM d') : format(d, 'MMM d, yyyy')
}

/** Date-bucket heading for grouped lists. */
export function groupLabel(ts: number, now = Date.now()): string {
  const d = new Date(ts)
  const days = differenceInCalendarDays(now, d)
  if (isToday(d)) return 'Today'
  if (isYesterday(d)) return 'Yesterday'
  if (days < 7) return 'Previous 7 days'
  if (days < 30) return 'Previous 30 days'
  return isThisYear(d) ? format(d, 'MMMM') : format(d, 'MMMM yyyy')
}

export const fullDate = (ts: number): string => format(new Date(ts), "EEE, MMM d, yyyy 'at' h:mm a")
export const startOfToday = (): number => startOfDay(new Date()).getTime()

export const displayName = (a: Address): string => a.name?.trim() || a.email.split('@')[0]
export const initials = (a: Address): string => {
  const n = displayName(a).replace(/[^\p{L}\p{N} ]/gu, '').trim()
  const parts = n.split(/\s+/)
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}
