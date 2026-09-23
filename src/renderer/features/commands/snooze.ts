import { format } from 'date-fns'

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
  if (sameDay(later, now)) out.push({ id: 'later', label: 'Later today', at: later })
  if (now.getHours() < 15) out.push({ id: 'evening', label: 'This evening', at: atTime(now, 0, 18) })
  out.push({ id: 'tomorrow', label: 'Tomorrow', at: atTime(now, 1, 8) })
  const dow = now.getDay() // 0 = Sunday
  if (dow >= 1 && dow <= 4) out.push({ id: 'weekend', label: 'This weekend', at: atTime(now, 6 - dow, 8) })
  let toMonday = (8 - dow) % 7 || 7
  if (toMonday === 1) toMonday = 8
  out.push({ id: 'nextweek', label: 'Next week', at: atTime(now, toMonday, 8) })
  return out
}

/** Row hint / toast text: "Today, 6:00 PM", "Tomorrow, 8:00 AM", "Sat, 8:00 AM", "Oct 12, 8:00 AM". */
export function formatReminderDate(ts: number | Date, now: Date = new Date(), sentence = false): string {
  const d = ts instanceof Date ? ts : new Date(ts)
  const time = format(d, 'h:mm a')
  const dayDiff = Math.round((atTime(d, 0, 12).getTime() - atTime(now, 0, 12).getTime()) / (24 * HOUR))
  let s: string
  if (dayDiff === 0) s = `Today, ${time}`
  else if (dayDiff === 1) s = `Tomorrow, ${time}`
  else if (dayDiff > 1 && dayDiff < 7) s = `${format(d, 'EEE')}, ${time}`
  else s = `${format(d, d.getFullYear() === now.getFullYear() ? 'MMM d' : 'MMM d, yyyy')}, ${time}`
  return sentence ? s.replace(/^(Today|Tomorrow)/, (m) => m.toLowerCase()) : s
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
