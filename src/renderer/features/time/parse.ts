/**
 * Natural-language date/time parser ("tmrw 9am", "next fri", "in 3 days", "eow"...).
 *
 * Pure and dependency-free: `now` is injectable, so every result is deterministic in tests.
 * Deliberately strict -- any word it does not understand makes the whole input unrecognised
 * (returns null) rather than guessing, so the live preview never shows a wrong date.
 */
import { formatWhen } from './format'

export interface ParseOptions {
  now?: Date
  /** First day of the week: 0 = Sunday, 1 = Monday, 6 = Saturday. Affects "next <weekday>" / "next week". */
  weekStartsOn?: 0 | 1 | 6
  /** Order of numeric dates such as `10/12`. */
  dateOrder?: 'mdy' | 'dmy'
  /** 12h (`9:00 AM`) or 24h (`09:00`) in the label. */
  hour12?: boolean
  /** Hour used when a date is given without a time. Default 9. */
  defaultHour?: number
}

export interface ParsedWhen {
  date: Date
  /** "Fri, Sep 25 · 9:00 AM" (year added when it is not the current one). */
  label: string
  /** true when the resolved instant is not in the future (callers must refuse it). */
  past: boolean
}

const WEEKDAYS: Record<string, number> = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6
}
const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5,
  jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11
}
const WORDNUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 }
/** Time-of-day words -> hour. */
const TOD: Record<string, number> = { morning: 9, afternoon: 14, evening: 18, night: 20, lunch: 12, lunchtime: 12 }

const WEEKDAY_RE = Object.keys(WEEKDAYS).sort((a, b) => b.length - a.length).join('|')
const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|')

const HALF_HOUR = 30 * 60_000
const HOUR = 3_600_000
const sod = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const at = (d: Date, h: number, m = 0): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0)
const daysInMonth = (y: number, m: number): number => new Date(y, m + 1, 0).getDate()
const roundUpHalfHour = (ms: number): Date => new Date(Math.ceil(ms / HALF_HOUR) * HALF_HOUR)

/** Midnight starting the week that contains `d`. */
function startOfWeek(d: Date, ws: number): Date {
  return addDays(sod(d), -((d.getDay() - ws + 7) % 7))
}
/** Next `dow` strictly after `d` (never today). */
function nextWeekday(d: Date, dow: number): Date {
  return addDays(sod(d), ((dow - d.getDay() + 6) % 7) + 1)
}
function validDate(y: number, m: number, d: number): Date | null {
  const out = new Date(y, m, d)
  return out.getFullYear() === y && out.getMonth() === m && out.getDate() === d ? out : null
}

/** Parse `input` relative to `opts.now`. Returns null when the text is not understood. */
export function parseWhen(input: string, opts: ParseOptions = {}): ParsedWhen | null {
  const now = opts.now ?? new Date()
  const ws = opts.weekStartsOn ?? 1
  const order = opts.dateOrder ?? 'mdy'
  const defH = opts.defaultHour ?? 9
  const hour12 = opts.hour12 ?? true

  if (input.trim() === '') return null
  let s = ` ${input.toLowerCase().trim()} `
  s = s.replace(/\b([ap])\.m\.?/g, '$1m').replace(/,/g, ' ').replace(/\.(?!\d)/g, ' ').replace(/\s+/g, ' ')

  const take = (re: RegExp): RegExpExecArray | null => {
    const m = re.exec(s)
    if (m) s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length)
    return m
  }
  const finish = (date: Date): ParsedWhen => ({ date, label: formatWhen(date, now, hour12), past: date.getTime() <= now.getTime() })

  // ---- 1. durations: "in 2h", "3 days", "1h30m", "in half an hour"
  let durMs = 0; let durDays = 0; let durMonths = 0; let hasDur = false
  if (take(/\b(?:in\s+)?half an? hour\b/)) { durMs += HALF_HOUR; hasDur = true }
  const durRe = /(?<![\d.:/])(in\s+)?(?:(\d+(?:\.\d+)?)|(an?|one|two|three|four|five|six|seven|eight|nine|ten|twelve))(\s*)(minutes?|mins?|hours?|hrs?|days?|weeks?|wks?|months?|years?|yrs?|[mhdwy])(?![a-z])/
  for (;;) {
    const dm = durRe.exec(s)
    if (!dm) break
    const [full, inWord, digits, word, gap, unit] = dm
    const short = unit.length === 1
    // "3d" / "3 days" / "in a day" are fine; a bare "3 d" or "a day" is too ambiguous.
    const ok = inWord ? !(word && short) : Boolean(digits) && (!short || gap === '')
    if (!ok) break
    const n = digits ? parseFloat(digits) : WORDNUM[word]
    if (unit.startsWith('mo')) durMonths += n
    else if (unit.startsWith('mi') || unit === 'm') durMs += n * 60_000
    else if (unit[0] === 'h') durMs += n * HOUR
    else if (unit[0] === 'd') durDays += n
    else if (unit[0] === 'w') durDays += n * 7
    else durMonths += n * 12
    hasDur = true
    s = s.slice(0, dm.index) + ' ' + s.slice(dm.index + full.length)
  }

  // ---- 2. shorthand deadlines: eod / eow / eom / "end of the day|week|month"
  let endOf: 'day' | 'week' | 'month' | null = null
  if (take(/\b(?:eod|cob|end of (?:the )?day)\b/)) endOf = 'day'
  else if (take(/\b(?:eow|end of (?:the )?(?:work ?)?week)\b/)) endOf = 'week'
  else if (take(/\b(?:eom|end of (?:the )?month)\b/)) endOf = 'month'

  // ---- 3. time of day
  let time: { h: number; m: number } | null = null
  let m: RegExpExecArray | null
  if (take(/\bnoon\b/)) time = { h: 12, m: 0 }
  else if (take(/\bmidnight\b/)) time = { h: 24, m: 0 }
  else if ((m = take(/(?:\bat\s+|@\s*)?\b(\d{1,2})(?::(\d{2}))?(?:\s*(am|pm)|(a|p))\b/))) {
    const h = +m[1]; const min = m[2] ? +m[2] : 0; const mer = (m[3] ?? m[4])[0]
    if (h < 1 || h > 12 || min > 59) return null
    time = { h: mer === 'p' ? (h === 12 ? 12 : h + 12) : h === 12 ? 0 : h, m: min }
  } else if ((m = take(/(?:\bat\s+|@\s*)?\b(\d{1,2}):(\d{2})\b/))) {
    if (+m[1] > 23 || +m[2] > 59) return null
    time = { h: +m[1], m: +m[2] }
  } else if ((m = take(/(?:\bat|@)\s*(\d{1,2})\b(?!\s*(?:st|nd|rd|th|\/|-))/))) {
    const h = +m[1]
    if (h > 23) return null
    // "at 3" -> 3 PM, "at 9" -> 9 AM: bare hours 1-6 are afternoons.
    time = { h: h >= 1 && h <= 6 ? h + 12 : h, m: 0 }
  }

  // ---- 4. date
  let day: Date | null = null
  let bad = false
  let yearless = false
  let tonight = false
  let later = false
  const today = sod(now)
  const set = (d: Date | null): void => { if (d) day = d; else bad = true }

  if (take(/\blater(?: today)?\b/)) later = true
  else if (take(/\bday after tomorrow\b/)) day = addDays(today, 2)
  else if (take(/\b(?:tomorrow|tomorow|tmrw|tmr|tmw|tom|2moro)\b/)) day = addDays(today, 1)
  else if (take(/\btonight\b/)) { day = today; tonight = true }
  else if (take(/\b(?:today|tod)\b/)) day = today
  else if ((m = take(new RegExp(`\\b(next\\s+)?(${WEEKDAY_RE})\\b`)))) {
    const dow = WEEKDAYS[m[2]]
    day = m[1] ? addDays(startOfWeek(now, ws), 7 + ((dow - ws + 7) % 7)) : nextWeekday(now, dow)
  } else if (take(/\bnext week\b/)) {
    let d = addDays(startOfWeek(now, ws), 7)
    while (d.getDay() === 0 || d.getDay() === 6) d = addDays(d, 1)
    day = d
  } else if (take(/\b(?:this )?weekend\b/)) day = nextWeekday(now, 6)
  else if (take(/\bnext month\b/)) day = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  else if (take(/\bnext year\b/)) day = new Date(now.getFullYear() + 1, 0, 1)
  else if ((m = take(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/))) set(validDate(+m[1], +m[2] - 1, +m[3]))
  else if ((m = take(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
    const [mo, da] = order === 'mdy' ? [+m[1], +m[2]] : [+m[2], +m[1]]
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : now.getFullYear()
    set(validDate(y, mo - 1, da)); yearless = !m[3]
  } else if ((m = take(new RegExp(`\\b(${MONTH_RE})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+(\\d{4}))?\\b`)))) {
    set(validDate(m[3] ? +m[3] : now.getFullYear(), MONTHS[m[1]], +m[2])); yearless = !m[3]
  } else if ((m = take(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_RE})(?:\\s+(\\d{4}))?\\b`)))) {
    set(validDate(m[3] ? +m[3] : now.getFullYear(), MONTHS[m[2]], +m[1])); yearless = !m[3]
  } else if ((m = take(/\b(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/))) {
    // "the 15th": next occurrence of that day of the month.
    const later15 = +m[1] < now.getDate()
    set(validDate(now.getFullYear(), now.getMonth() + (later15 ? 1 : 0), +m[1]))
  }
  if (bad) return null

  // time-of-day words may accompany a date or stand alone
  let tod: number | null = null
  const tw = take(/\b(morning|afternoon|evening|night|lunchtime|lunch)\b/)
  if (tw) tod = TOD[tw[1]]

  let dayResolved: Date | null = day
  if (yearless && dayResolved && (dayResolved as Date) < today) {
    const d = dayResolved as Date
    dayResolved = validDate(d.getFullYear() + 1, d.getMonth(), d.getDate())
    if (!dayResolved) return null
  }

  // ---- leftovers: only harmless filler may remain
  if (s.replace(/\b(at|on|the|of|by|around|for|this|coming|a|in)\b|@/g, ' ').trim() !== '') return null
  if (!(hasDur || endOf || time || dayResolved || later || tod !== null)) return null

  // ---- resolve
  if (later) {
    if (time || dayResolved || tod !== null || hasDur || endOf) return null
    return finish(roundUpHalfHour(now.getTime() + 3 * HOUR))
  }

  if (hasDur) {
    if (dayResolved || endOf) return null
    if (durDays === 0 && durMonths === 0) {
      if (time || tod !== null) return null
      return finish(new Date(now.getTime() + durMs))
    }
    // Day-or-longer durations land on the default hour rather than "this exact minute".
    const base = new Date(now.getFullYear(), now.getMonth() + durMonths, now.getDate() + Math.round(durDays))
    if (durMonths && base.getDate() !== now.getDate() && !durDays) base.setDate(0) // Jan 31 + 1 month -> Feb 28/29
    const h = time ?? { h: tod ?? defH, m: 0 }
    return finish(new Date(at(base, h.h, h.m).getTime() + durMs))
  }

  if (endOf) {
    if (dayResolved || time || tod !== null) return null
    if (endOf === 'day') return finish(at(today, 17))
    if (endOf === 'week') {
      // Friday 5 PM, this week (or next week once it has passed).
      let d = at(addDays(today, (5 - today.getDay() + 7) % 7), 17)
      if (d.getTime() <= now.getTime()) d = at(addDays(d, 7), 17)
      return finish(d)
    }
    let d = at(new Date(now.getFullYear(), now.getMonth(), daysInMonth(now.getFullYear(), now.getMonth())), 17)
    if (d.getTime() <= now.getTime()) {
      const nm = new Date(now.getFullYear(), now.getMonth() + 1, 1)
      d = at(new Date(nm.getFullYear(), nm.getMonth(), daysInMonth(nm.getFullYear(), nm.getMonth())), 17)
    }
    return finish(d)
  }

  const hm = time ?? { h: tod ?? (tonight ? 20 : defH), m: 0 }
  if (dayResolved === null) {
    // Time-only ("3pm", "evening"): today if still ahead, otherwise tomorrow.
    let d = at(today, hm.h, hm.m)
    if (d.getTime() <= now.getTime()) d = at(addDays(today, 1), hm.h, hm.m)
    return finish(d)
  }
  let out = at(dayResolved, hm.h, hm.m)
  if (tonight && !time && tod === null && out.getTime() <= now.getTime()) {
    // "tonight" at 9 PM means an hour or so from now, not tomorrow evening.
    const soon = roundUpHalfHour(now.getTime() + HOUR)
    out = soon.getDate() === now.getDate() ? soon : at(addDays(today, 1), 20)
  }
  return finish(out)
}
