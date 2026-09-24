import { useEffect, useMemo, useRef, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import type { TrackerHit } from '@shared/sanitize'
import { summarizeTrackers } from '@shared/sanitize/trackers'
import { Tooltip } from '@/features/tooltip'
import './shield.css'

/** "Blocked 1 tracker" / "Blocked 3 trackers". */
export const trackerLabel = (n: number): string => `Blocked ${n} ${n === 1 ? 'tracker' : 'trackers'}`

/**
 * A quiet shield in the message header, present only when at least one tracking image was
 * removed. Hover names the count; click lists who it was, so the protection is never a black box
 * (Apple Mail's Mail Privacy Protection hides this; we show it).
 */
export function TrackerShield({ trackers }: { trackers: readonly TrackerHit[] }): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLSpanElement>(null)
  const groups = useMemo(() => summarizeTrackers(trackers), [trackers])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    // Capture + stopPropagation: Esc belongs to the popover first, not to "close the thread".
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      e.preventDefault()
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  // A different message's trackers: start closed.
  useEffect(() => { setOpen(false) }, [trackers])

  if (trackers.length === 0) return null
  const label = trackerLabel(trackers.length)

  return (
    <span className="shield" ref={root}>
      <Tooltip label={open ? '' : label}>
        <button
          type="button"
          className="shield__btn"
          aria-label={label}
          aria-expanded={open}
          onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
        >
          <ShieldCheck size={14} aria-hidden />
        </button>
      </Tooltip>
      {open && (
        <div className="shield__pop" role="dialog" aria-label={label}>
          <div className="shield__title">{label}</div>
          <ul className="shield__list">
            {groups.map((g) => (
              <li key={g.host} className="shield__row">
                <span className="shield__host">{g.host}</span>
                <span className="shield__svc">{g.service ?? 'Tracking pixel'}{g.count > 1 ? ` ×${g.count}` : ''}</span>
              </li>
            ))}
          </ul>
          <p className="shield__note">Trackers report that you opened this message. They stay blocked even when you load images.</p>
        </div>
      )}
    </span>
  )
}
