import i18n, { currentLocale } from '@/i18n'

const t = (key: string, opts?: Record<string, unknown>): string => i18n.t(key, { ns: 'compose', ...opts })
/**
 * "Schedule send" presets. Pure so the labels and the timestamps can be tested without
 * freezing the clock in the UI.
 */

export interface ScheduleOption {
  id: 'tomorrow-morning' | 'tomorrow-afternoon' | 'next-week' | 'custom'
  label: string
  /** Right-aligned secondary text, e.g. `Tue, 08:00`. */
  detail: string
  /** Epoch ms. `null` for the custom picker. */
  at: number | null
}

const at = (base: Date, addDays: number, hour: number, minute = 0): Date => {
  const d = new Date(base)
  d.setDate(d.getDate() + addDays)
  d.setHours(hour, minute, 0, 0)
  return d
}

/** Days until the next Monday that is strictly in the future (never today). */
export function daysUntilNextMonday(from: Date): number {
  const delta = (8 - from.getDay()) % 7
  return delta === 0 ? 7 : delta
}

const fmtDay = (d: Date): string =>
  new Intl.DateTimeFormat(currentLocale(), { weekday: 'short' }).format(d)
const fmtTime = (d: Date): string =>
  new Intl.DateTimeFormat(currentLocale(), { hour: '2-digit', minute: '2-digit', hour12: false }).format(d)

/** `Tue, 08:00`, or `Tue 12 May, 08:00` when it is more than a week out. */
export function scheduleDetail(d: Date, now: Date): string {
  const far = d.getTime() - now.getTime() > 6 * 864e5
  const day = far
    ? new Intl.DateTimeFormat(currentLocale(), { weekday: 'short', day: 'numeric', month: 'short' }).format(d)
    : fmtDay(d)
  return t('schedule.detail', { day, time: fmtTime(d) })
}

/**
 * The four options Notion Mail offers. Times are local; `now` is injectable for tests.
 * Options already in the past are never produced (the +1 day / next-Monday maths
 * guarantees that), so the list is always valid.
 */
export function scheduleOptions(now: Date = new Date()): ScheduleOption[] {
  // Small hours (before 5 AM): "tomorrow morning" would be more than a day away, today's is meant.
  const early = now.getHours() < 5
  const morning = at(now, early ? 0 : 1, 8)
  const afternoon = at(now, early ? 0 : 1, 13)
  const monday = at(now, daysUntilNextMonday(now), 8)
  return [
    { id: 'tomorrow-morning', label: early ? t('schedule.thisMorning') : t('schedule.tomorrowMorning'), detail: scheduleDetail(morning, now), at: morning.getTime() },
    { id: 'tomorrow-afternoon', label: early ? t('schedule.thisAfternoon') : t('schedule.tomorrowAfternoon'), detail: scheduleDetail(afternoon, now), at: afternoon.getTime() },
    { id: 'next-week', label: t('schedule.nextWeek'), detail: scheduleDetail(monday, now), at: monday.getTime() },
    { id: 'custom', label: t('schedule.pickDateTime'), detail: '', at: null }
  ]
}

/** `2026-05-12T08:00` (the value shape of `<input type="datetime-local">`). */
export function toLocalInputValue(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Parse a `datetime-local` value as local time. Returns null when empty or in the past. */
export function fromLocalInputValue(value: string, now: Date = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim())
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0, 0)
  return d.getTime() > now.getTime() ? d.getTime() : null
}

/** "Scheduled for Tue, 08:00" toast text. */
export function scheduledToast(at: number, now: Date = new Date()): string {
  return t('schedule.scheduledFor', { when: scheduleDetail(new Date(at), now) })
}
