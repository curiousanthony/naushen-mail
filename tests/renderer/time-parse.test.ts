import { describe, expect, it } from 'vitest'
import { parseWhen, type ParseOptions } from '../../src/renderer/features/time/parse'
import { formatBack, formatIn, formatWhen } from '../../src/renderer/features/time/format'

// Thursday 24 Sep 2026, 10:30 local.
const NOW = new Date(2026, 8, 24, 10, 30)
const p = (s: string, o: ParseOptions = {}) => parseWhen(s, { now: NOW, ...o })
const iso = (d: Date | undefined): string | undefined =>
  d && `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
const at = (s: string, o?: ParseOptions): string | undefined => iso(p(s, o)?.date)

describe('parseWhen: the brief examples', () => {
  it.each([
    ['tmrw 9am', '2026-09-25 09:00'],
    ['tomorrow 3pm', '2026-09-25 15:00'],
    ['next fri', '2026-10-02 09:00'],
    ['in 3 days', '2026-09-27 09:00'],
    ['monday morning', '2026-09-28 09:00'],
    ['oct 12 2pm', '2026-10-12 14:00'],
    ['end of month', '2026-09-30 17:00'],
    ['tonight', '2026-09-24 20:00'],
    ['in 2h', '2026-09-24 12:30'],
    ['eow', '2026-09-25 17:00']
  ])('%s -> %s', (input, expected) => {
    expect(at(input)).toBe(expected)
  })

  it('produces a human label', () => {
    expect(p('tmrw 9am')?.label).toBe('Fri, Sep 25 · 9:00 AM')
    expect(p('tmrw 9am', { hour12: false })?.label).toBe('Fri, Sep 25 · 09:00')
    expect(p('oct 12 2027 8pm')?.label).toBe('Tue, Oct 12, 2027 · 8:00 PM')
  })
})

describe('parseWhen: times', () => {
  it.each([
    ['9am', '2026-09-25 09:00'], // already past today -> tomorrow
    ['3pm', '2026-09-24 15:00'],
    ['3:45 pm', '2026-09-24 15:45'],
    ['15:20', '2026-09-24 15:20'],
    ['at 3', '2026-09-24 15:00'],
    ['at 11', '2026-09-24 11:00'],
    ['noon', '2026-09-24 12:00'],
    ['midnight', '2026-09-25 00:00'],
    ['6p', '2026-09-24 18:00'],
    ['12am tomorrow', '2026-09-25 00:00'],
    ['12pm tomorrow', '2026-09-25 12:00'],
    ['tomorrow at 8:15', '2026-09-25 08:15'],
    ['tomorrow 08:15', '2026-09-25 08:15'],
    ['9 a.m. tomorrow', '2026-09-25 09:00']
  ])('%s -> %s', (input, expected) => {
    expect(at(input)).toBe(expected)
  })

  it('rejects impossible times', () => {
    expect(p('13pm')).toBeNull()
    expect(p('25:00')).toBeNull()
    expect(p('tomorrow 9:75am')).toBeNull()
  })

  it('time-of-day words', () => {
    expect(at('this evening')).toBe('2026-09-24 18:00')
    expect(at('tomorrow afternoon')).toBe('2026-09-25 14:00')
    expect(at('tomorrow evening')).toBe('2026-09-25 18:00')
    expect(at('morning')).toBe('2026-09-25 09:00')
    expect(at('friday night')).toBe('2026-09-25 20:00')
  })

  it('"tonight" after 8pm means soon, not tomorrow', () => {
    expect(at('tonight', { now: new Date(2026, 8, 24, 21, 10) })).toBe('2026-09-24 22:30')
    expect(at('tonight', { now: new Date(2026, 8, 24, 23, 40) })).toBe('2026-09-25 20:00')
  })
})

describe('parseWhen: relative durations', () => {
  it.each([
    ['in 30 min', '2026-09-24 11:00'],
    ['in an hour', '2026-09-24 11:30'],
    ['in half an hour', '2026-09-24 11:00'],
    ['in 1.5 hours', '2026-09-24 12:00'],
    ['1h30m', '2026-09-24 12:00'],
    ['2h', '2026-09-24 12:30'],
    ['45m', '2026-09-24 11:15'],
    ['in 2 weeks', '2026-10-08 09:00'],
    ['in a week', '2026-10-01 09:00'],
    ['3d', '2026-09-27 09:00'],
    ['3 days', '2026-09-27 09:00'],
    ['in 3 days 2pm', '2026-09-27 14:00'],
    ['in 1 month', '2026-10-24 09:00'],
    ['in two days', '2026-09-26 09:00']
  ])('%s -> %s', (input, expected) => {
    expect(at(input)).toBe(expected)
  })

  it('clamps month overflow (Jan 31 + 1 month)', () => {
    expect(at('in 1 month', { now: new Date(2026, 0, 31, 10, 0) })).toBe('2026-02-28 09:00')
  })
  it('bare units without "in" stay unrecognised', () => {
    expect(p('3 d')).toBeNull()
    expect(p('a day')).toBeNull()
  })
  it('hour durations cannot be combined with a clock time', () => {
    expect(p('in 2h 3pm')).toBeNull()
  })
})

describe('parseWhen: days and weeks', () => {
  it.each([
    ['today 5pm', '2026-09-24 17:00'],
    ['tomorrow', '2026-09-25 09:00'],
    ['tmr', '2026-09-25 09:00'],
    ['day after tomorrow', '2026-09-26 09:00'],
    ['friday', '2026-09-25 09:00'],
    ['thurs', '2026-10-01 09:00'], // today is Thursday -> strictly next
    ['sat 10am', '2026-09-26 10:00'],
    ['this weekend', '2026-09-26 09:00'],
    ['next week', '2026-09-28 09:00'],
    ['next monday', '2026-09-28 09:00'],
    ['next mon 4pm', '2026-09-28 16:00'],
    ['next month', '2026-10-01 09:00'],
    ['eod', '2026-09-24 17:00'],
    ['end of the day', '2026-09-24 17:00'],
    ['later', '2026-09-24 13:30'],
    ['later today', '2026-09-24 13:30']
  ])('%s -> %s', (input, expected) => {
    expect(at(input)).toBe(expected)
  })

  it('"next <weekday>" is the following calendar week; bare weekday is the upcoming one', () => {
    expect(at('friday')).toBe('2026-09-25 09:00')
    expect(at('next friday')).toBe('2026-10-02 09:00')
  })

  it('respects the locale first day of the week', () => {
    // Sunday 27 Sep 2026: the week (Monday start) began Mon 21st, so "next fri" is Fri 2 Oct.
    const sun = new Date(2026, 8, 27, 10, 0)
    expect(at('next fri', { now: sun, weekStartsOn: 1 })).toBe('2026-10-02 09:00')
    // With a Sunday start, Sun 27th opens a new week, so "next fri" is Fri 9 Oct.
    expect(at('next fri', { now: sun, weekStartsOn: 0 })).toBe('2026-10-09 09:00')
    // "next week" always lands on a working day (Monday), never the Sunday a week starts on.
    expect(at('next week', { now: sun, weekStartsOn: 0 })).toBe('2026-10-05 09:00')
    expect(at('next week', { now: sun, weekStartsOn: 1 })).toBe('2026-09-28 09:00')
  })

  it('end of week / month roll forward once passed', () => {
    expect(at('eow', { now: new Date(2026, 8, 25, 18, 0) })).toBe('2026-10-02 17:00') // Fri after 5pm
    expect(at('eow', { now: new Date(2026, 8, 26, 10, 0) })).toBe('2026-10-02 17:00') // Saturday
    expect(at('end of week', { now: NOW })).toBe('2026-09-25 17:00')
    expect(at('eom', { now: new Date(2026, 8, 30, 18, 0) })).toBe('2026-10-31 17:00')
    expect(at('end of month', { now: new Date(2026, 1, 3, 9, 0) })).toBe('2026-02-28 17:00')
  })
})

describe('parseWhen: calendar dates', () => {
  it.each([
    ['oct 12', '2026-10-12 09:00'],
    ['October 12th 2pm', '2026-10-12 14:00'],
    ['12 oct', '2026-10-12 09:00'],
    ['12th of october 8am', '2026-10-12 08:00'],
    ['sept 30 5pm', '2026-09-30 17:00'],
    ['jan 5', '2027-01-05 09:00'], // passed this year -> next year
    ['jan 5 2028', '2028-01-05 09:00'],
    ['2026-11-03 10:15', '2026-11-03 10:15'],
    ['10/12', '2026-10-12 09:00'],
    ['12/10 noon', '2026-12-10 12:00'],
    ['the 30th', '2026-09-30 09:00'],
    ['the 3rd', '2026-10-03 09:00']
  ])('%s -> %s', (input, expected) => {
    expect(at(input)).toBe(expected)
  })

  it('numeric dates follow the locale order', () => {
    expect(at('10/12', { dateOrder: 'dmy' })).toBe('2026-12-10 09:00')
    expect(at('1/3/27', { dateOrder: 'dmy' })).toBe('2027-03-01 09:00')
  })

  it('rejects impossible dates', () => {
    expect(p('feb 30')).toBeNull()
    expect(p('13/13')).toBeNull()
  })

  it('today is kept (and flagged past) rather than jumping a year', () => {
    const r = p('sep 24')
    expect(iso(r?.date)).toBe('2026-09-24 09:00')
    expect(r?.past).toBe(true)
  })
})

describe('parseWhen: strictness', () => {
  it.each(['', '   ', 'banana', 'tomorrow banana', 'next', 'at', 'friday friday', 'in', '9am 10am', 'tomorrow tonight'])(
    '%j is not understood', (input) => {
      expect(p(input)).toBeNull()
    })

  it('is case- and punctuation-insensitive', () => {
    expect(at('Tomorrow, 3 PM.')).toBe('2026-09-25 15:00')
    expect(at('  NEXT   FRI  ')).toBe('2026-10-02 09:00')
  })

  it('flags explicit times in the past', () => {
    expect(p('today 8am')?.past).toBe(true)
    expect(p('today 5pm')?.past).toBe(false)
    expect(p('tomorrow')?.past).toBe(false)
  })

  it('does not mutate the injected clock', () => {
    const now = new Date(NOW)
    parseWhen('in 3 weeks', { now })
    expect(now.getTime()).toBe(NOW.getTime())
  })

  it('DST: "tomorrow 9am" stays 09:00 across the spring-forward night', () => {
    // US clocks jump on Sun 8 Mar 2026 (no-op in zones without DST, still 09:00 either way).
    expect(at('tomorrow 9am', { now: new Date(2026, 2, 7, 20, 0) })).toBe('2026-03-08 09:00')
  })
})

describe('format helpers', () => {
  it('formatWhen adds the year only when different', () => {
    expect(formatWhen(new Date(2026, 9, 12, 14, 0), NOW)).toBe('Mon, Oct 12 · 2:00 PM')
    expect(formatWhen(new Date(2027, 0, 5, 9, 5), NOW, false)).toBe('Tue, Jan 5, 2027 · 09:05')
  })
  it('formatBack reads like a person', () => {
    expect(formatBack(new Date(2026, 8, 24, 18, 0).getTime(), NOW)).toBe('Back 6:00 PM')
    expect(formatBack(new Date(2026, 8, 25, 9, 0).getTime(), NOW)).toBe('Back tomorrow 9:00 AM')
    expect(formatBack(new Date(2026, 8, 29, 9, 0).getTime(), NOW, false)).toBe('Back Tue 09:00')
    expect(formatBack(new Date(2026, 9, 12, 9, 0).getTime(), NOW)).toBe('Back Oct 12')
  })
  it('formatIn picks the coarsest sensible unit', () => {
    expect(formatIn(NOW.getTime() + 20 * 60_000, NOW)).toBe('20m')
    expect(formatIn(NOW.getTime() + 5 * 3_600_000, NOW)).toBe('5h')
    expect(formatIn(NOW.getTime() + 3 * 86_400_000, NOW)).toBe('3d')
    expect(formatIn(NOW.getTime() - 1000, NOW)).toBe('1m')
  })
})
