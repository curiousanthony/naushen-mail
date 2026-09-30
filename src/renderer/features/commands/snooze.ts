import { format } from 'date-fns'
import i18n, { currentLocale } from '@/i18n'
import { dateLocale } from '@/i18n/dateLocale'

/** Reminder ("snooze") presets and date formatting. Pure; `now` is injectable for tests. */

export type SnoozePresetId = 'later' | 'evening' | 'tomorrow' | 'weekend' | 'nextweek'

export interface SnoozePreset {
  id: SnoozePresetId
  label: string
  at: Date
}

const HOUR = 3_600_000
const HALF_HOUR = 1_800_000

const atTime = (base: Date, days: number, h: number, m = 0): Date =>
  new Date(base.getFullYear(), base.getMonth(), base.getDate() + days, h, m, 0, 0)

const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/**
 * - Later today: now + 3h rounded up to the half hour (hidden late in the evening / if it would roll over).
 * - This evening: 6 PM, only while it is still >= 3h away (so it never precedes "Later today").
 * - Tomorrow: 8:00 AM.
 * - This weekend: Saturday 8:00 AM, offered Mon-Thu (Fri it would equal tomorrow).
 * - Next week: next Monday 8:00 AM (the Monday after tomorrow when today is Sunday).
 */
export function getSnoozePresets(now: Date = new Date()): SnoozePreset[] {
  const out: SnoozePreset[] = []
  const later = new Date(Math.ceil((now.getTime() + 3 * HOUR) / HALF_HOUR) * HALF_HOUR)
  if (sameDay(later, now)) out.push({ id: 'later', label: i18n.t('commands:snooze.later'), at: later })
  if (now.getHours() < 15) out.push({ id: 'evening', label: i18n.t('commands:snooze.evening'), at: atTime(now, 0, 18) })
  // Small hours (before 5 AM): "tomorrow 8 AM" would be a day and a half away; today's morning is meant.
  if (now.getHours() < 5) out.push({ id: 'tomorrow', label: i18n.t('commands:snooze.thisMorning'), at: atTime(now, 0, 8) })
  else out.push({ id: 'tomorrow', label: i18n.t('commands:snooze.tomorrow'), at: atTime(now, 1, 8) })
  const dow = now.getDay() // 0 = Sunday
  if (dow >= 1 && dow <= 4) out.push({ id: 'weekend', label: i18n.t('commands:snooze.weekend'), at: atTime(now, 6 - dow, 8) })
  let toMonday = (8 - dow) % 7 || 7
  if (toMonday === 1) toMonday = 8
  out.push({ id: 'nextweek', label: i18n.t('commands:snooze.nextWeek'), at: atTime(now, toMonday, 8) })
  return out
}

/** Hour used for "tomorrow", "next week"... and by the typed-time parser when no time is given. */
export const DEFAULT_HOUR = 8

/**
 * "Follow up if no reply" presets: N days out at the default hour. Not filtered by time of day
 * (a day count is always meaningful).
 */
export type FollowUpPresetId = 'fu2d' | 'fu3d' | 'fu1w' | 'fu2w'
export function getFollowUpPresets(now: Date = new Date()): Array<{ id: FollowUpPresetId; label: string; at: Date }> {
  return [
    { id: 'fu2d', label: i18n.t('commands:snooze.in2Days'), at: atTime(now, 2, DEFAULT_HOUR) },
    { id: 'fu3d', label: i18n.t('commands:snooze.in3Days'), at: atTime(now, 3, DEFAULT_HOUR) },
    { id: 'fu1w', label: i18n.t('commands:snooze.in1Week'), at: atTime(now, 7, DEFAULT_HOUR) },
    { id: 'fu2w', label: i18n.t('commands:snooze.in2Weeks'), at: atTime(now, 14, DEFAULT_HOUR) }
  ]
}

/** Times a preset must have been used before it floats to the top ("remember the most-used presets"). */
export const USAGE_THRESHOLD = 3

/**
 * Stable reorder: presets used at least USAGE_THRESHOLD times move up, most-used first; the rest
 * keep their chronological order. Returns the input untouched when nothing qualifies.
 */
export function orderByUsage<T extends { id: string }>(presets: T[], usage: Record<string, number> | undefined): T[] {
  if (!usage) return presets
  const hot = presets.filter((p) => (usage[p.id] ?? 0) >= USAGE_THRESHOLD)
  if (!hot.length) return presets
  const rank = (p: T): number => usage[p.id] ?? 0
  const sorted = [...hot].sort((a, b) => rank(b) - rank(a))
  return [...sorted, ...presets.filter((p) => !sorted.includes(p))]
}

/** Row hint / toast text: "Today, 6:00 PM", "Tomorrow, 8:00 AM", "Sat, 8:00 AM", "Oct 12, 8:00 AM". */
export function formatReminderDate(ts: number | Date, now: Date = new Date(), sentence = false): string {
  const d = ts instanceof Date ? ts : new Date(ts)
  const time = format(d, 'p', { locale: dateLocale() }) // localised short time: "6:00 PM" in English
  const dayDiff = Math.round((atTime(d, 0, 12).getTime() - atTime(now, 0, 12).getTime()) / (24 * HOUR))
  const intl = (o: Intl.DateTimeFormatOptions): string => new Intl.DateTimeFormat(currentLocale(), o).format(d)
  // `sentence`: the phrase sits inside a sentence ("Reminder set for today, 6:00 PM"), so today/tomorrow are lower-cased.
  if (dayDiff === 0) return i18n.t(sentence ? 'commands:snooze.when.todayInline' : 'commands:snooze.when.today', { time })
  if (dayDiff === 1) return i18n.t(sentence ? 'commands:snooze.when.tomorrowInline' : 'commands:snooze.when.tomorrow', { time })
  if (dayDiff > 1 && dayDiff < 7) return i18n.t('commands:snooze.when.weekday', { day: intl({ weekday: 'short' }), time })
  const date = d.getFullYear() === now.getFullYear() ? intl({ month: 'short', day: 'numeric' }) : intl({ month: 'short', day: 'numeric', year: 'numeric' })
  return i18n.t('commands:snooze.when.date', { date, time })
}

export const toDateInput = (d: Date): string => format(d, 'yyyy-MM-dd')
export const toTimeInput = (d: Date): string => format(d, 'HH:mm')

/** Defaults for the custom picker: tomorrow at 8:00. */
export function defaultCustom(now: Date = new Date()): { date: string; time: string } {
  return { date: toDateInput(atTime(now, 1, 8)), time: '08:00' }
}

/** `2026-09-24` + `09:30` -> Date, or null when malformed or not in the future. */
export function parseCustomDateTime(date: string, time: string, now: Date = new Date()): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const t = /^(\d{2}):(\d{2})$/.exec(time)
  if (!d || !t) return null
  const [y, mo, da, h, mi] = [d[1], d[2], d[3], t[1], t[2]].map(Number)
  const out = new Date(y, mo - 1, da, h, mi, 0, 0)
  if (Number.isNaN(out.getTime()) || out.getMonth() !== mo - 1 || out.getDate() !== da || h > 23 || mi > 59) return null
  return out.getTime() > now.getTime() ? out : null
}
