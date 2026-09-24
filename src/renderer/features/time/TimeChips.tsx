import { BellRing, Clock, MailQuestion, X } from 'lucide-react'
import type { Thread } from '@shared/types'
import { useApp } from '@/lib/store'
import { formatBack, formatIn, localeDefaults } from './format'
import './time.css'

/**
 * Quiet, time-related chips for a thread (row + reader header). Renders nothing for a thread
 * with no local timing state, so ordinary rows gain no chrome.
 *
 *  - snoozed:            "Back Tue 9:00 AM"     click -> reschedule (opens the reminder picker)
 *  - follow-up pending:  "Follow-up in 3d"      click -> cancel
 *  - follow-up fired:    "No reply yet"         click -> dismiss
 */
export function TimeChips({ thread }: { thread: Thread }): JSX.Element | null {
  const act = useApp((s) => s.act)
  const focus = useApp((s) => s.focus)
  const setOverlay = useApp((s) => s.setOverlay)
  const toast = useApp((s) => s.toast)
  const now = new Date()
  const { hour12 } = localeDefaults()

  const snoozed = thread.snoozedUntil && thread.snoozedUntil > now.getTime() ? thread.snoozedUntil : null
  const pending = thread.reminderAt && !thread.followUpFiredAt ? thread.reminderAt : null
  const fired = thread.followUpFiredAt ?? null
  if (!snoozed && !pending && !fired) return null

  const stop = (e: React.MouseEvent): void => e.stopPropagation()
  const cancel = (e: React.MouseEvent, message: string): void => {
    e.stopPropagation()
    const at = thread.reminderAt
    void act({ type: 'remind', at: null }, [thread.id])
    toast({
      message,
      actionLabel: at ? 'Undo' : undefined,
      onAction: at ? () => void window.api.invoke('threads.act', [thread.id], { type: 'remind', at }) : undefined
    })
  }

  return (
    <>
      {snoozed && (
        <button
          className="tf-chip" onMouseDown={stop}
          onClick={(e) => { e.stopPropagation(); focus(thread.id); setOverlay('snooze') }}
          title="Reschedule reminder" aria-label={`${formatBack(snoozed, now, hour12)}. Reschedule reminder`}
        >
          <BellRing size={11} strokeWidth={1.75} aria-hidden />{formatBack(snoozed, now, hour12)}
        </button>
      )}
      {pending && (
        <button
          className="tf-chip" onMouseDown={stop} onClick={(e) => cancel(e, 'Follow-up cancelled')}
          title="Cancel follow-up" aria-label={`Follow-up in ${formatIn(pending, now)}. Cancel follow-up`}
        >
          <Clock size={11} strokeWidth={1.75} aria-hidden />Follow-up in {formatIn(pending, now)}
          <X size={10} strokeWidth={2} className="tf-chip__x" aria-hidden />
        </button>
      )}
      {fired && (
        <button
          className="tf-chip tf-chip--alert" onMouseDown={stop} onClick={(e) => cancel(e, 'Dismissed')}
          title="No reply yet. Click to dismiss" aria-label="No reply yet. Dismiss"
        >
          <MailQuestion size={11} strokeWidth={1.75} aria-hidden />No reply yet
          <X size={10} strokeWidth={2} className="tf-chip__x" aria-hidden />
        </button>
      )}
    </>
  )
}
