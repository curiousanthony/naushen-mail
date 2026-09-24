import { forwardRef, useMemo } from 'react'
import { CalendarClock, CornerDownLeft } from 'lucide-react'
import { DEFAULT_HOUR } from '@/features/commands/snooze'
import { localeDefaults } from './format'
import { parseWhen, type ParsedWhen } from './parse'
import './time.css'

/** Parse what the user typed with the locale's 12/24h, week start and date order. */
export function parseTyped(text: string, now: Date = new Date()): ParsedWhen | null {
  return parseWhen(text, { ...localeDefaults(), defaultHour: DEFAULT_HOUR, now })
}

export type WhenState = { kind: 'empty' } | { kind: 'ok'; when: ParsedWhen } | { kind: 'past' } | { kind: 'unknown' }

export function whenState(text: string, now: Date = new Date()): WhenState {
  if (!text.trim()) return { kind: 'empty' }
  const when = parseTyped(text, now)
  if (!when) return { kind: 'unknown' }
  return when.past ? { kind: 'past' } : { kind: 'ok', when }
}

interface Props {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  /** Fired on Enter when the text parses to a future time. */
  onSubmit: (when: ParsedWhen) => void
  ariaLabel?: string
  autoFocus?: boolean
}

/**
 * "Type a time…" input with a live preview line underneath. The preview reserves its height so
 * the panel never jumps while typing.
 */
export const WhenField = forwardRef<HTMLInputElement, Props>(function WhenField({ value, onChange, placeholder = 'Type a time… tomorrow 3pm', onSubmit, ariaLabel = 'Type a time', autoFocus }, ref) {
  const state = useMemo(() => whenState(value), [value])
  return (
    <div className="tw">
      <label className="tw__box">
        <CalendarClock size={15} strokeWidth={1.5} className="tw__icon" aria-hidden />
        <input
          ref={ref}
          className="tw__input"
          value={value}
          placeholder={placeholder}
          aria-label={ariaLabel}
          autoFocus={autoFocus}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && state.kind === 'ok') { e.preventDefault(); e.stopPropagation(); onSubmit(state.when) }
          }}
        />
      </label>
      <div className="tw__preview" data-state={state.kind} aria-live="polite">
        {state.kind === 'ok' && (<><span className="tw__when">{state.when.label}</span><CornerDownLeft size={12} strokeWidth={1.75} aria-hidden /></>)}
        {state.kind === 'past' && <span>That time has already passed</span>}
        {state.kind === 'unknown' && <span>Try “tomorrow 3pm”, “fri”, “in 2 days” or “oct 12”</span>}
      </div>
    </div>
  )
})
