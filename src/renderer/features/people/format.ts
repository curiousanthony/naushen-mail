import { startOfDay, differenceInCalendarDays } from 'date-fns'
import i18n, { currentLocale } from '@/i18n'

const intl = (ts: number, o: Intl.DateTimeFormatOptions): string => new Intl.DateTimeFormat(currentLocale(), o).format(ts)

/** "last Tue" style label for the sender card: relative, short, never a raw timestamp. */
export function lastSeenLabel(ts: number, now = Date.now()): string {
  if (!ts) return ''
  const days = differenceInCalendarDays(startOfDay(now), startOfDay(ts))
  if (days <= 0) return i18n.t('people:lastSeen.today')
  if (days === 1) return i18n.t('people:lastSeen.yesterday')
  if (days < 7) return i18n.t('people:lastSeen.weekday', { day: intl(ts, { weekday: 'short' }) })
  if (new Date(ts).getFullYear() === new Date(now).getFullYear()) return intl(ts, { month: 'short', day: 'numeric' })
  return intl(ts, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** "12 conversations · last Tue" (singular handled; empty history is honest about it). */
export function conversationsLine(count: number, lastAt: number, now = Date.now()): string {
  if (count <= 0) return i18n.t('people:conversations.none')
  const last = lastSeenLabel(lastAt, now)
  if (!last) return i18n.t('people:conversations.count', { count })
  return i18n.t('people:conversations.countWithLast', { count, last })
}
