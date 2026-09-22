import { useEffect, useMemo, useRef, useState } from 'react'
import { BellRing, CalendarClock, Clock, CornerDownLeft, Moon, Sun, Sunrise, Sunset, X } from 'lucide-react'
import type { Thread, ThreadAction } from '@shared/types'
import { useApp } from '@/lib/store'
import { getSnoozePresets, formatReminderDate, defaultCustom, parseCustomDateTime, toDateInput, type SnoozePresetId } from './snooze'
import { perform, targetThreads } from './runner'
import { Overlay } from './Overlay'
import './commands.css'

const PRESET_ICON: Record<SnoozePresetId, typeof Clock> = { later: Clock, evening: Sunset, tomorrow: Sunrise, weekend: Sun, nextweek: Moon }

/** Reminder ("snooze") picker, `h`. Local-only: nothing here reaches the provider. */
export function SnoozePicker(): JSX.Element | null {
  const open = useApp((s) => s.overlay === 'snooze')
  return open ? <SnoozeBody /> : null
}

function SnoozeBody(): JSX.Element {
  const close = (): void => useApp.getState().setOverlay(null)
  const now = useMemo(() => new Date(), [])
  const presets = useMemo(() => getSnoozePresets(now), [now])
  const custom0 = useMemo(() => defaultCustom(now), [now])
  const { ids, threads } = targetThreads()
  const [date, setDate] = useState(custom0.date)
  const [time, setTime] = useState(custom0.time)
  const [ifNoReply, setIfNoReply] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const hasReminder = threads.some((t) => t.snoozedUntil || t.reminderAt)

  const customAt = parseCustomDateTime(date, time, now)
  // Rows: presets, then an optional "Clear reminder".
  const rows = presets.length + (hasReminder ? 1 : 0)

  useEffect(() => { rootRef.current?.focus() }, [])

  const commit = async (at: Date): Promise<void> => {
    const when = formatReminderDate(at, new Date(), true)
    const action: ThreadAction = ifNoReply ? { type: 'remind', at: at.getTime() } : { type: 'snooze', until: at.getTime() }
    close()
    await perform(action, `Reminder set for ${when}`, { ids })
  }

  const clear = async (): Promise<void> => {
    close()
    const snoozed = threads.filter((t: Thread) => t.snoozedUntil).map((t) => t.id)
    const reminded = threads.filter((t: Thread) => t.reminderAt).map((t) => t.id)
    const { act, toast } = useApp.getState()
    if (snoozed.length) await act({ type: 'unsnooze' }, snoozed)
    if (reminded.length) await act({ type: 'remind', at: null }, reminded)
    toast({ message: 'Reminder removed', duration: 3000 })
  }

  const activate = (i: number): void => {
    if (i < presets.length) void commit(presets[i].at)
    else void clear()
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const inField = (e.target as HTMLElement).tagName === 'INPUT'
    if (e.key === 'Enter' && (e.target as HTMLElement).closest('.cmd-snooze__custom')) {
      e.preventDefault()
      if (customAt) void commit(customAt)
      return
    }
    if (inField) return
    if (e.key === 'ArrowDown' || (e.key === 'j' && !e.metaKey)) { e.preventDefault(); setActive((a) => (a + 1) % rows) }
    else if (e.key === 'ArrowUp' || (e.key === 'k' && !e.metaKey)) { e.preventDefault(); setActive((a) => (a - 1 + rows) % rows) }
    else if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') { e.preventDefault(); activate(active) }
  }

  const subject = threads[0]?.subject
  const count = ids.length

  return (
    <Overlay onClose={close} width={360} top="16vh" label="Set reminder" className="cmd-snooze">
      <div className="cmd-snooze__root" ref={rootRef} tabIndex={-1} onKeyDown={onKeyDown}>
        <div className="cmd-head">
          <div className="cmd-head__text">
            <div className="cmd-head__title">Set reminder</div>
            <div className="cmd-head__sub">{count > 1 ? `${count} conversations` : subject || 'Conversation'}</div>
          </div>
          <button className="cmd-iconbtn" aria-label="Close" onClick={close}><X size={16} strokeWidth={1.5} /></button>
        </div>

        <div className="cmd-snooze__list" role="listbox" aria-label="Reminder times">
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
              <span className="cmd-row__label">Remove reminder</span>
            </button>
          )}
        </div>

        <div className="cmd-divider" />
        <div className="cmd-snooze__custom">
          <div className="cmd-snooze__customhead"><CalendarClock size={16} strokeWidth={1.5} className="cmd-row__icon" /><span>Pick date &amp; time</span></div>
          <div className="cmd-snooze__fields">
            <input type="date" className="cmd-field" value={date} min={toDateInput(now)} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
            <input type="time" className="cmd-field" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time" />
            <button className="cmd-btn cmd-btn--primary" disabled={!customAt} onClick={() => customAt && void commit(customAt)}>Set</button>
          </div>
          {!customAt && <div className="cmd-snooze__error">Choose a time in the future.</div>}
        </div>

        <div className="cmd-divider" />
        <label className="cmd-toggle">
          <span className="cmd-toggle__text">
            <span className="cmd-toggle__title">Remind only if no reply</span>
            <span className="cmd-toggle__desc">{ifNoReply ? 'Stays in your inbox. You are reminded if nobody replies.' : 'Hides the conversation until then.'}</span>
          </span>
          <input type="checkbox" role="switch" className="cmd-switch" checked={ifNoReply} onChange={(e) => setIfNoReply(e.target.checked)} />
        </label>

        <div className="cmd-footer">
          <span><kbd className="cmd-key">↑</kbd><kbd className="cmd-key">↓</kbd> Navigate</span>
          <span><kbd className="cmd-key"><CornerDownLeft size={10} strokeWidth={2} /></kbd> Select</span>
          <span><kbd className="cmd-key cmd-key--word">esc</kbd> Close</span>
        </div>
      </div>
    </Overlay>
  )
}
