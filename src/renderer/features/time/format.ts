import { format } from 'date-fns'

/** Locale-derived defaults (12/24h, first weekday, numeric date order). Safe outside a browser. */
export function localeDefaults(): { hour12: boolean; weekStartsOn: 0 | 1 | 6; dateOrder: 'mdy' | 'dmy' } {
  let hour12 = true
  let weekStartsOn: 0 | 1 | 6 = 1
  let dateOrder: 'mdy' | 'dmy' = 'mdy'
  try {
    const loc = typeof navigator !== 'undefined' ? navigator.language : undefined
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

/** "Fri, Sep 25 · 9:00 AM"; the year is added when it is not the current one. */
export function formatWhen(d: Date, now: Date = new Date(), hour12 = true): string {
  const day = format(d, d.getFullYear() === now.getFullYear() ? 'EEE, MMM d' : 'EEE, MMM d, yyyy')
  return `${day} · ${format(d, timeFmt(hour12))}`
}

const dayNumber = (d: Date): number => Math.round(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime() / 86_400_000)

/** Short human wake time for a snoozed row: "Back 6:00 PM", "Back tomorrow 9:00 AM", "Back Tue 9:00 AM", "Back Oct 12". */
export function formatBack(ts: number, now: Date = new Date(), hour12 = true): string {
  const d = new Date(ts)
  const t = format(d, timeFmt(hour12))
  const diff = dayNumber(d) - dayNumber(now)
  if (diff <= 0) return `Back ${t}`
  if (diff === 1) return `Back tomorrow ${t}`
  if (diff < 7) return `Back ${format(d, 'EEE')} ${t}`
  return `Back ${format(d, d.getFullYear() === now.getFullYear() ? 'MMM d' : 'MMM d, yyyy')}`
}

/** "3d", "5h", "20m" until `ts` (for the quiet "Follow-up in 3d" chip). */
export function formatIn(ts: number, now: Date = new Date()): string {
  const ms = Math.max(0, ts - now.getTime())
  const mins = Math.round(ms / 60_000)
  if (mins < 60) return `${Math.max(1, mins)}m`
  const hours = Math.round(ms / 3_600_000)
  if (hours < 24) return `${hours}h`
  return `${Math.round(ms / 86_400_000)}d`
}
