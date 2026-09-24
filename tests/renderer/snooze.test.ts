import { describe, expect, it } from 'vitest'
import { defaultCustom, formatReminderDate, getSnoozePresets, parseCustomDateTime } from '@/features/commands/snooze'

const d = (y: number, m: number, day: number, h = 0, mi = 0): Date => new Date(y, m - 1, day, h, mi, 0, 0)
// 2026-09-21 is a Monday.
const byId = (now: Date) => Object.fromEntries(getSnoozePresets(now).map((p) => [p.id, p.at]))

describe('getSnoozePresets', () => {
  it('Monday morning offers all five presets', () => {
    const p = byId(d(2026, 9, 21, 9, 10))
    expect(p.later).toEqual(d(2026, 9, 21, 12, 30)) // 12:10 rounded up to the half hour
    expect(p.evening).toEqual(d(2026, 9, 21, 18, 0))
    expect(p.tomorrow).toEqual(d(2026, 9, 22, 8, 0))
    expect(p.weekend).toEqual(d(2026, 9, 26, 8, 0))
    expect(p.nextweek).toEqual(d(2026, 9, 28, 8, 0))
  })
  it('keeps the order later < evening < tomorrow', () => {
    const list = getSnoozePresets(d(2026, 9, 21, 9, 0))
    expect(list.map((x) => x.id)).toEqual(['later', 'evening', 'tomorrow', 'weekend', 'nextweek'])
    for (let i = 1; i < list.length; i++) expect(list[i].at.getTime()).toBeGreaterThan(list[i - 1].at.getTime())
  })
  it('hides "This evening" once it would come before "Later today"', () => {
    const p = getSnoozePresets(d(2026, 9, 21, 15, 30))
    expect(p.find((x) => x.id === 'evening')).toBeUndefined()
    expect(p.find((x) => x.id === 'later')!.at).toEqual(d(2026, 9, 21, 18, 30))
  })
  it('hides "Later today" when +3h rolls past midnight', () => {
    const p = getSnoozePresets(d(2026, 9, 21, 22, 15))
    expect(p.map((x) => x.id)).not.toContain('later')
    expect(p.map((x) => x.id)).not.toContain('evening')
  })
  it('does not offer "This weekend" on Friday (it would equal tomorrow) or on the weekend', () => {
    for (const day of [25, 26, 27]) expect(getSnoozePresets(d(2026, 9, day, 9)).map((x) => x.id)).not.toContain('weekend')
    expect(getSnoozePresets(d(2026, 9, 24, 9)).map((x) => x.id)).toContain('weekend') // Thursday
  })
  it('"Next week" is the coming Monday, or the Monday after when today is Sunday', () => {
    expect(byId(d(2026, 9, 25, 9)).nextweek).toEqual(d(2026, 9, 28, 8)) // Friday
    expect(byId(d(2026, 9, 26, 9)).nextweek).toEqual(d(2026, 9, 28, 8)) // Saturday
    expect(byId(d(2026, 9, 27, 9)).nextweek).toEqual(d(2026, 10, 5, 8)) // Sunday: tomorrow is Monday already
    expect(byId(d(2026, 9, 28, 9)).nextweek).toEqual(d(2026, 10, 5, 8)) // Monday
  })
  it('crosses month/year boundaries', () => {
    expect(byId(d(2026, 12, 31, 9)).tomorrow).toEqual(d(2027, 1, 1, 8))
  })
  it('every preset is in the future', () => {
    for (const now of [d(2026, 9, 21, 0, 0), d(2026, 9, 21, 23, 59), d(2026, 9, 27, 12), d(2026, 12, 31, 23, 30)])
      for (const p of getSnoozePresets(now)) expect(p.at.getTime()).toBeGreaterThan(now.getTime())
  })
})

describe('formatReminderDate', () => {
  const now = d(2026, 9, 21, 9, 0)
  it('formats relative days', () => {
    expect(formatReminderDate(d(2026, 9, 21, 18, 0), now)).toBe('Today, 6:00 PM')
    expect(formatReminderDate(d(2026, 9, 22, 8, 0), now)).toBe('Tomorrow, 8:00 AM')
    expect(formatReminderDate(d(2026, 9, 26, 8, 0), now)).toBe('Sat, 8:00 AM')
    expect(formatReminderDate(d(2026, 10, 12, 9, 30), now)).toBe('Oct 12, 9:30 AM')
    expect(formatReminderDate(d(2027, 1, 5, 9, 30), now)).toBe('Jan 5, 2027, 9:30 AM')
  })
  it('lower-cases relative words for sentences ("Reminder set for tomorrow, 8:00 AM")', () => {
    expect(formatReminderDate(d(2026, 9, 22, 8, 0), now, true)).toBe('tomorrow, 8:00 AM')
    expect(formatReminderDate(d(2026, 9, 26, 8, 0), now, true)).toBe('Sat, 8:00 AM')
  })
})

describe('custom date & time', () => {
  const now = d(2026, 9, 21, 9, 0)
  it('defaults to tomorrow 8:00', () => {
    expect(defaultCustom(now)).toEqual({ date: '2026-09-22', time: '08:00' })
  })
  it('parses a valid future value', () => {
    expect(parseCustomDateTime('2026-09-24', '09:30', now)).toEqual(d(2026, 9, 24, 9, 30))
  })
  it('rejects the past, malformed input and impossible dates', () => {
    expect(parseCustomDateTime('2026-09-21', '08:59', now)).toBeNull()
    expect(parseCustomDateTime('', '09:30', now)).toBeNull()
    expect(parseCustomDateTime('2026-09-24', '', now)).toBeNull()
    expect(parseCustomDateTime('2026-02-30', '09:30', now)).toBeNull()
    expect(parseCustomDateTime('2026-09-24', '25:00', now)).toBeNull()
  })
})
