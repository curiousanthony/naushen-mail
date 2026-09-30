import { isThisYear, isToday, isYesterday, startOfDay, differenceInCalendarDays } from 'date-fns'
import type { Address } from '@shared/types'
import i18n, { currentLocale } from '@/i18n'

const intl = (o: Intl.DateTimeFormatOptions, d: Date): string => new Intl.DateTimeFormat(currentLocale(), o).format(d)

/** List-row time: "3:42 PM", "Yesterday", "Mon", "Oct 12", "Oct 12, 2024" (localised to the UI language). */
export function listTime(ts: number, now = Date.now()): string {
  const d = new Date(ts)
  if (isToday(d)) return intl({ hour: 'numeric', minute: '2-digit' }, d)
  if (isYesterday(d)) return i18n.t('common:date.yesterday')
  if (differenceInCalendarDays(now, d) < 7) return intl({ weekday: 'short' }, d)
  return isThisYear(d) ? intl({ month: 'short', day: 'numeric' }, d) : intl({ month: 'short', day: 'numeric', year: 'numeric' }, d)
}

/** Date-bucket heading for grouped lists. */
export function groupLabel(ts: number, now = Date.now()): string {
  const d = new Date(ts)
  const days = differenceInCalendarDays(now, d)
  if (isToday(d)) return i18n.t('common:date.today')
  if (isYesterday(d)) return i18n.t('common:date.yesterday')
  if (days < 7) return i18n.t('common:date.previous7')
  if (days < 30) return i18n.t('common:date.previous30')
  return isThisYear(d) ? intl({ month: 'long' }, d) : intl({ month: 'long', year: 'numeric' }, d)
}

export const fullDate = (ts: number): string =>
  intl({ weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }, new Date(ts))
export const startOfToday = (): number => startOfDay(new Date()).getTime()

export const displayName = (a: Address): string => a.name?.trim() || a.email.split('@')[0]
export const initials = (a: Address): string => {
  const n = displayName(a).replace(/[^\p{L}\p{N} ]/gu, '').trim()
  const parts = n.split(/\s+/)
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}
