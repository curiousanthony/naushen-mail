import { describe, expect, it } from 'vitest'
import { dayOfYear, dayPeriod, inboxZeroLine, inboxZeroLines } from '@/features/threadlist/emptyLines'

describe('inbox-zero copy', () => {
  it('maps hours to periods at the boundaries', () => {
    expect(dayPeriod(5)).toBe('morning')
    expect(dayPeriod(10)).toBe('morning')
    expect(dayPeriod(11)).toBe('afternoon')
    expect(dayPeriod(16)).toBe('afternoon')
    expect(dayPeriod(17)).toBe('evening')
    expect(dayPeriod(21)).toBe('evening')
    expect(dayPeriod(22)).toBe('night')
    expect(dayPeriod(0)).toBe('night')
    expect(dayPeriod(4)).toBe('night')
  })
  it('picks a line from the right period, stable within a day', () => {
    const a = inboxZeroLine(new Date(2026, 8, 24, 9, 0))
    const b = inboxZeroLine(new Date(2026, 8, 24, 10, 59))
    expect(a.period).toBe('morning')
    expect(a.line).toBe(b.line)
    expect(inboxZeroLines().morning).toContain(a.line)
    expect(inboxZeroLines().night).toContain(inboxZeroLine(new Date(2026, 8, 24, 23, 0)).line)
  })
  it('rotates across days and never uses emoji', () => {
    expect(dayOfYear(new Date(2026, 0, 1))).toBe(1)
    const lines = new Set([24, 25].map((d) => inboxZeroLine(new Date(2026, 8, d, 9)).line))
    expect(lines.size).toBe(2)
    for (const ls of Object.values(inboxZeroLines())) for (const l of ls) expect(l).toMatch(/^[\x20-\x7e]+$/)
  })
})
