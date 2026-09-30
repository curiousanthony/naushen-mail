import i18n from '@/i18n'

/** Inbox-zero copy that rotates with the time of day. Pure, so it is unit-tested (tests/renderer/empty-lines.test.ts). */
export type DayPeriod = 'morning' | 'afternoon' | 'evening' | 'night'

export function dayPeriod(hour: number): DayPeriod {
  if (hour >= 5 && hour < 11) return 'morning'
  if (hour >= 11 && hour < 17) return 'afternoon'
  if (hour >= 17 && hour < 22) return 'evening'
  return 'night'
}

/** Dry, calm, no emoji. Two per period so a given day picks one and it does not flicker. */
export const inboxZeroLines = (): Record<DayPeriod, readonly string[]> => ({
  morning: [i18n.t('threadlist:zero.morning.line1'), i18n.t('threadlist:zero.morning.line2')],
  afternoon: [i18n.t('threadlist:zero.afternoon.line1'), i18n.t('threadlist:zero.afternoon.line2')],
  evening: [i18n.t('threadlist:zero.evening.line1'), i18n.t('threadlist:zero.evening.line2')],
  night: [i18n.t('threadlist:zero.night.line1'), i18n.t('threadlist:zero.night.line2')]
})

export function dayOfYear(d: Date): number {
  return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 86_400_000)
}

export function inboxZeroLine(now: Date = new Date()): { period: DayPeriod; line: string } {
  const period = dayPeriod(now.getHours())
  const lines = inboxZeroLines()[period]
  return { period, line: lines[dayOfYear(now) % lines.length] }
}
