import { describe, expect, it } from 'vitest'
import { getFollowUpPresets, getSnoozePresets, orderByUsage, USAGE_THRESHOLD } from '@/features/commands/snooze'
import { scheduleOptions } from '@/features/compose/schedule'

const d = (y: number, m: number, day: number, h = 0, mi = 0): Date => new Date(y, m - 1, day, h, mi, 0, 0)

describe('time-of-day sensible presets', () => {
  it('in the small hours "Tomorrow" becomes "This morning" (today 8:00)', () => {
    const p = getSnoozePresets(d(2026, 9, 21, 1, 30)).find((x) => x.id === 'tomorrow')!
    expect(p.label).toBe('This morning')
    expect(p.at).toEqual(d(2026, 9, 21, 8, 0))
    expect(getSnoozePresets(d(2026, 9, 21, 5, 0)).find((x) => x.id === 'tomorrow')!.label).toBe('Tomorrow')
  })
  it('never offers "This evening" from 3 PM on', () => {
    for (const h of [15, 18, 19, 23]) expect(getSnoozePresets(d(2026, 9, 21, h)).map((x) => x.id)).not.toContain('evening')
  })
  it('send-later presets follow the same small-hours rule', () => {
    const [m, a] = scheduleOptions(d(2026, 9, 21, 2, 0))
    expect([m.label, a.label]).toEqual(['This morning', 'This afternoon'])
    expect(new Date(m.at!).getDate()).toBe(21)
    const [m2] = scheduleOptions(d(2026, 9, 21, 9, 0))
    expect(m2.label).toBe('Tomorrow morning')
  })
})

describe('follow-up presets', () => {
  it('are N days out at the default hour', () => {
    const p = getFollowUpPresets(d(2026, 9, 24, 22, 40))
    expect(p.map((x) => x.label)).toEqual(['In 2 days', 'In 3 days', 'In 1 week', 'In 2 weeks'])
    expect(p[1].at).toEqual(d(2026, 9, 27, 8, 0))
    expect(p[3].at).toEqual(d(2026, 10, 8, 8, 0))
  })
})

describe('orderByUsage (most-used presets float up)', () => {
  const list = [{ id: 'later' }, { id: 'evening' }, { id: 'tomorrow' }, { id: 'weekend' }]
  it('keeps the chronological order until a preset has been used enough', () => {
    expect(orderByUsage(list, undefined)).toBe(list)
    expect(orderByUsage(list, { tomorrow: USAGE_THRESHOLD - 1 })).toBe(list)
  })
  it('moves heavily used presets to the top, most used first, rest unchanged', () => {
    expect(orderByUsage(list, { tomorrow: 5, weekend: 9, evening: 1 }).map((x) => x.id)).toEqual(['weekend', 'tomorrow', 'later', 'evening'])
  })
  it('ignores usage of presets that are not offered right now', () => {
    expect(orderByUsage(list, { nextweek: 50 })).toBe(list)
  })
})
