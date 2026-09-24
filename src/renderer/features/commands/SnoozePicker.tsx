import { useEffect, useMemo, useRef, useState } from 'react'
import { BellRing, CalendarClock, CalendarDays, Clock, CornerDownLeft, Moon, Sun, Sunrise, Sunset, X } from 'lucide-react'
import type { Thread, ThreadAction } from '@shared/types'
import { useApp } from '@/lib/store'
import { WhenField, whenState } from '@/features/time/WhenField'
import { getSnoozePresets, getFollowUpPresets, orderByUsage, formatReminderDate, defaultCustom, parseCustomDateTime, toDateInput, type SnoozePresetId, type FollowUpPresetId } from './snooze'
import { perform, targetThreads } from './runner'
import { Overlay } from './Overlay'
import './commands.css'

const PRESET_ICON: Record<SnoozePresetId | FollowUpPresetId, typeof Clock> = {
  later: Clock, evening: Sunset, tomorrow: Sunrise, weekend: Sun, nextweek: Moon,
  fu2d: CalendarDays, fu3d: CalendarDays, fu1w: CalendarDays, fu2w: CalendarDays
}

/**
 * Reminder ("snooze") picker, `h`, and the "Follow up if no reply" picker, `w` (same panel,
 * different presets and action). Local-only: nothing here reaches the provider.
 */
export function SnoozePicker(): JSX.Element | null {
  const overlay = useApp((s) => s.overlay)
  return overlay === 'snooze' || overlay === 'followup' ? <SnoozeBody followUp={overlay === 'followup'} /> : null
}

function SnoozeBody({ followUp }: { followUp: boolean }): JSX.Element {
  const close = (): void => useApp.getState().setOverlay(null)
  const usage = useApp((s) => s.settings?.timePresetUsage)
  const now = useMemo(() => new Date(), [])
  const presets = useMemo(
    () => (followUp ? getFollowUpPresets(now) : orderByUsage(getSnoozePresets(now), usage)),
    // Order is decided once per open; picking a preset must not reshuffle rows under the cursor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [now, followUp]
  )
  const custom0 = useMemo(() => defaultCustom(now), [now])
  const { ids, threads } = targetThreads()
  const [typed, setTyped] = useState('')
  const [date, setDate] = useState(custom0.date)
  const [time, setTime] = useState(custom0.time)
  const [ifNoReply, setIfNoReply] = useState(false)
  const [active, setActive] = useState(followUp ? 1 : 0) // follow-up defaults to "In 3 days"
  const inputRef = useRef<HTMLInputElement>(null)
  const hasReminder = threads.some((t) => (followUp ? t.reminderAt || t.followUpFiredAt : t.snoozedUntil || t.reminderAt || t.followUpFiredAt))

  const customAt = parseCustomDateTime(date, time, now)
  const typing = typed.trim() !== ''
  // Rows: presets, then an optional "Remove …".
  const rows = presets.length + (hasReminder ? 1 : 0)

  useEffect(() => { inputRef.current?.focus() }, [])

  const commit = async (at: Date, presetId?: string): Promise<void> => {
    const when = formatReminderDate(at, new Date(), true)
    const noReply = followUp || ifNoReply
    const action: ThreadAction = noReply ? { type: 'remind', at: at.getTime() } : { type: 'snooze', until: at.getTime() }
    const message = followUp ? `Follow-up set for ${when}, if nobody replies` : `Reminder set for ${when}`
    if (presetId) {
      const { updateSettings, settings } = useApp.getState()
      const cur = settings?.timePresetUsage ?? {}
      void updateSettings({ timePresetUsage: { ...cur, [presetId]: (cur[presetId] ?? 0) + 1 } })
    }
    close()
    await perform(action, message, { ids })
  }

  const clear = async (): Promise<void> => {
    close()
    const snoozed = followUp ? [] : threads.filter((t: Thread) => t.snoozedUntil).map((t) => t.id)
    const reminded = threads.filter((t: Thread) => t.reminderAt || t.followUpFiredAt).map((t) => t.id)
    const { act, toast } = useApp.getState()
    if (snoozed.length) await act({ type: 'unsnooze' }, snoozed)
    if (reminded.length) await act({ type: 'remind', at: null }, reminded)
    toast({ message: followUp ? 'Follow-up removed' : 'Reminder removed', duration: 3000 })
  }

  const activate = (i: number): void => {
    if (i < presets.length) void commit(presets[i].at, presets[i].id)
    else void clear()
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const target = e.target as HTMLElement
    if (e.key === 'Enter' && target.closest('.cmd-snooze__custom')) {
      e.preventDefault()
      if (customAt) void commit(customAt)
      return
    }
    if (e.key === 'ArrowDown' && !typing) { e.preventDefault(); setActive((a) => (a + 1) % rows) }
    else if (e.key === 'ArrowUp' && !typing) { e.preventDefault(); setActive((a) => (a - 1 + rows) % rows) }
    else if (e.key === 'Enter' && target === inputRef.current && !typing) { e.preventDefault(); activate(active) }
    else if (e.key === 'Enter' && target.tagName !== 'BUTTON' && target.tagName !== 'INPUT') { e.preventDefault(); activate(active) }
  }

  const subject = threads[0]?.subject
  const count = ids.length
  const title = followUp ? 'Follow up if no reply' : 'Set reminder'
  const state = whenState(typed, now)

  return (
    <Overlay onClose={close} width={360} top="16vh" label={title} className="cmd-snooze">
      <div className="cmd-snooze__root" onKeyDown={onKeyDown}>
        <div className="cmd-head">
          <div className="cmd-head__text">
            <div className="cmd-head__title">{title}</div>
            <div className="cmd-head__sub">{count > 1 ? `${count} conversations` : subject || 'Conversation'}</div>
          </div>
          <button className="cmd-iconbtn" aria-label="Close" onClick={close}><X size={16} strokeWidth={1.5} /></button>
        </div>

        <WhenField
          ref={inputRef}
          value={typed}
          onChange={setTyped}
          placeholder={followUp ? 'Type a time… in 3 days' : 'Type a time… tomorrow 3pm'}
          onSubmit={(w) => void commit(w.date)}
        />

        {!typing && (
          <div className="cmd-snooze__list" role="listbox" aria-label={followUp ? 'Follow-up times' : 'Reminder times'}>
            {presets.map((p, i) => {
              const Ico = PRESET_ICON[p.id]
              return (
                <button key={p.id} role="option" aria-selected={active === i} className="cmd-row" data-active={active === i} onMouseMove={() => active !== i && setActive(i)} onClick={() => activate(i)}>
                  <Ico size={16} strokeWidth={1.5} className="cmd-row__icon" />
                  <span className="cmd-row__label">{p.label}</span>
                  <span className="cmd-row__hint">{formatReminderDate(p.at, now)}</span>
                </button>
              )
            })}
            {hasReminder && (
              <button role="option" aria-selected={active === presets.length} className="cmd-row cmd-row--danger" data-active={active === presets.length} onMouseMove={() => setActive(presets.length)} onClick={() => activate(presets.length)}>
                <BellRing size={16} strokeWidth={1.5} className="cmd-row__icon" />
                <span className="cmd-row__label">{followUp ? 'Remove follow-up' : 'Remove reminder'}</span>
              </button>
            )}
          </div>
        )}

        {!typing && <div className="cmd-divider" />}
        {!typing && (
          <div className="cmd-snooze__custom">
            <div className="cmd-snooze__customhead"><CalendarClock size={16} strokeWidth={1.5} className="cmd-row__icon" /><span>Pick date &amp; time</span></div>
            <div className="cmd-snooze__fields">
              <input type="date" className="cmd-field" value={date} min={toDateInput(now)} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
              <input type="time" className="cmd-field" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time" />
              <button className="cmd-btn cmd-btn--primary" disabled={!customAt} onClick={() => customAt && void commit(customAt)}>Set</button>
            </div>
            {!customAt && <div className="cmd-snooze__error">Choose a time in the future.</div>}
          </div>
        )}

        {!typing && !followUp && (
          <>
            <div className="cmd-divider" />
            <label className="cmd-toggle">
              <span className="cmd-toggle__text">
                <span className="cmd-toggle__title">Remind only if no reply</span>
                <span className="cmd-toggle__desc">{ifNoReply ? 'Stays in your inbox. You are reminded if nobody replies.' : 'Hides the conversation until then.'}</span>
              </span>
              <input type="checkbox" role="switch" className="cmd-switch" checked={ifNoReply} onChange={(e) => setIfNoReply(e.target.checked)} />
            </label>
          </>
        )}

        <div className="cmd-footer">
          {!typing && <span><kbd className="cmd-key">↑</kbd><kbd className="cmd-key">↓</kbd> Navigate</span>}
          <span><kbd className="cmd-key"><CornerDownLeft size={10} strokeWidth={2} /></kbd> {typing ? (state.kind === 'ok' ? 'Confirm' : 'Keep typing') : 'Select'}</span>
          <span><kbd className="cmd-key cmd-key--word">esc</kbd> Close</span>
        </div>
      </div>
    </Overlay>
  )
}
