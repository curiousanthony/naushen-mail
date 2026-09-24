import { format, startOfDay, differenceInCalendarDays } from 'date-fns'

/** "last Tue" style label for the sender card: relative, short, never a raw timestamp. */
export function lastSeenLabel(ts: number, now = Date.now()): string {
  if (!ts) return ''
  const days = differenceInCalendarDays(startOfDay(now), startOfDay(ts))
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `last ${format(ts, 'EEE')}`
  if (new Date(ts).getFullYear() === new Date(now).getFullYear()) return format(ts, 'MMM d')
  return format(ts, 'MMM d, yyyy')
}

/** "12 conversations · last Tue" (singular handled; empty history is honest about it). */
export function conversationsLine(count: number, lastAt: number, now = Date.now()): string {
  if (count <= 0) return 'No conversations yet'
  const n = `${count} ${count === 1 ? 'conversation' : 'conversations'}`
  const last = lastSeenLabel(lastAt, now)
  if (!last) return n
  return `${n} · ${last}`
}
