import { format } from 'date-fns'
import i18n, { currentLocale } from '@/i18n'
import { dateLocale } from '@/i18n/dateLocale'

/** Locale-derived defaults (12/24h, first weekday, numeric date order). Safe outside a browser. */
export function localeDefaults(): { hour12: boolean; weekStartsOn: 0 | 1 | 6; dateOrder: 'mdy' | 'dmy' } {
  let hour12 = true
  let weekStartsOn: 0 | 1 | 6 = 1
  let dateOrder: 'mdy' | 'dmy' = 'mdy'
  try {
    // The OS locale (region included) decides 12/24h, week start and numeric date order; the UI language only names things.
    const loc = typeof navigator !== 'undefined' ? navigator.language : currentLocale()
    hour12 = new Intl.DateTimeFormat(loc, { hour: 'numeric' }).resolvedOptions().hour12 ?? true
    const L = new Intl.Locale(loc ?? 'en-US') as Intl.Locale & { weekInfo?: { firstDay: number }; getWeekInfo?: () => { firstDay: number } }
    const first = (L.getWeekInfo ? L.getWeekInfo() : L.weekInfo)?.firstDay // 1 = Monday ... 7 = Sunday
    if (first === 7) weekStartsOn = 0
    else if (first === 6) weekStartsOn = 6
    const parts = new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'numeric' }).formatToParts(new Date(2000, 10, 25))
    dateOrder = parts.findIndex((p) => p.type === 'day') < parts.findIndex((p) => p.type === 'month') ? 'dmy' : 'mdy'
  } catch { /* keep defaults */ }
  return { hour12, weekStartsOn, dateOrder }
}

export const timeFmt = (hour12: boolean): string => (hour12 ? 'h:mm a' : 'HH:mm')
const fmt = (d: Date, pattern: string): string => format(d, pattern, { locale: dateLocale() })
const intl = (d: Date, o: Intl.DateTimeFormatOptions): string => new Intl.DateTimeFormat(currentLocale(), o).format(d)

/** "Fri, Sep 25 · 9:00 AM"; the year is added when it is not the current one. */
export function formatWhen(d: Date, now: Date = new Date(), hour12 = true): string {
  const day = intl(d, d.getFullYear() === now.getFullYear()
    ? { weekday: 'short', month: 'short', day: 'numeric' }
    : { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
  return `${day} · ${fmt(d, timeFmt(hour12))}`
}

const dayNumber = (d: Date): number => Math.round(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime() / 86_400_000)

/** Short human wake time for a snoozed row: "Back 6:00 PM", "Back tomorrow 9:00 AM", "Back Tue 9:00 AM", "Back Oct 12". */
export function formatBack(ts: number, now: Date = new Date(), hour12 = true): string {
  const d = new Date(ts)
  const time = fmt(d, timeFmt(hour12))
  const diff = dayNumber(d) - dayNumber(now)
  if (diff <= 0) return i18n.t('time:back.today', { time })
  if (diff === 1) return i18n.t('time:back.tomorrow', { time })
  if (diff < 7) return i18n.t('time:back.weekday', { day: intl(d, { weekday: 'short' }), time })
  const date = d.getFullYear() === now.getFullYear() ? intl(d, { month: 'short', day: 'numeric' }) : intl(d, { month: 'short', day: 'numeric', year: 'numeric' })
  return i18n.t('time:back.date', { date })
}

/** "3d", "5h", "20m" until `ts` (for the quiet "Follow-up in 3d" chip). */
export function formatIn(ts: number, now: Date = new Date()): string {
  const ms = Math.max(0, ts - now.getTime())
  const mins = Math.round(ms / 60_000)
  if (mins < 60) return i18n.t('time:in.minutes', { count: Math.max(1, mins) })
  const hours = Math.round(ms / 3_600_000)
  if (hours < 24) return i18n.t('time:in.hours', { count: hours })
  return i18n.t('time:in.days', { count: Math.round(ms / 86_400_000) })
}
