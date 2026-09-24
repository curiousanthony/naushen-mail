/** Inbox-zero copy that rotates with the time of day. Pure, so it is unit-tested (tests/renderer/empty-lines.test.ts). */
export type DayPeriod = 'morning' | 'afternoon' | 'evening' | 'night'

export function dayPeriod(hour: number): DayPeriod {
  if (hour >= 5 && hour < 11) return 'morning'
  if (hour >= 11 && hour < 17) return 'afternoon'
  if (hour >= 17 && hour < 22) return 'evening'
  return 'night'
}

/** Dry, calm, no emoji. Two per period so a given day picks one and it does not flicker. */
export const INBOX_ZERO_LINES: Record<DayPeriod, readonly string[]> = {
  morning: ['Inbox zero, and it is not even lunch.', 'Nothing here. Enjoy the quiet start.'],
  afternoon: ['All clear. Go do the thing you were avoiding.', 'Nothing left. The afternoon is yours.'],
  evening: ['Nothing left to answer. Close the laptop.', 'Inbox zero. Dinner can have your attention now.'],
  night: ['Nothing here. Go to sleep.', 'Empty. Whatever it is can wait until morning.']
}

export function dayOfYear(d: Date): number {
  return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 86_400_000)
}

export function inboxZeroLine(now: Date = new Date()): { period: DayPeriod; line: string } {
  const period = dayPeriod(now.getHours())
  const lines = INBOX_ZERO_LINES[period]
  return { period, line: lines[dayOfYear(now) % lines.length] }
}
