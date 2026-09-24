import { useMemo } from 'react'
import { Clock, FileText, Filter, Inbox, Layers, Search, Send, ShieldCheck, Star, Tag, Trash2, type LucideIcon } from 'lucide-react'
import type { Nav } from '@/lib/store'
import { inboxZeroLine, type DayPeriod } from './emptyLines'
import './empty.css'

interface Copy { title: string; body: string }

const GLYPH: Record<string, LucideIcon> = {
  sent: Send, drafts: FileText, trash: Trash2, spam: ShieldCheck, starred: Star, inbox: Inbox
}

function glyphFor(nav: Nav, filtered: boolean): LucideIcon {
  if (filtered) return Filter
  switch (nav.kind) {
    case 'role': return GLYPH[nav.role] ?? Inbox
    case 'snoozed': return Clock
    case 'label': return Tag
    case 'search': return Search
    case 'view': return Layers
  }
}

/**
 * A calm scene for "nothing to do": a low sun (or moon, after dark) over two soft hills.
 * Every fill is a token, so it follows light / dark and the accent colour.
 */
function Scene({ period }: { period: DayPeriod }): JSX.Element {
  const night = period === 'night'
  // Sun height follows the day: low in the morning and evening, high at midday.
  const cy = period === 'afternoon' ? 34 : night ? 40 : 52
  return (
    <svg className="es__scene" viewBox="0 0 200 128" width="200" height="128" aria-hidden focusable="false">
      <defs>
        <mask id="es-moon">
          <rect width="200" height="128" fill="white" />
          <circle cx="110" cy={cy - 5} r="15" fill="black" />
        </mask>
      </defs>
      <circle className="es__halo" cx="100" cy={cy} r="34" />
      <circle className="es__sun" cx="100" cy={cy} r="18" mask={night ? 'url(#es-moon)' : undefined} />
      {night && (
        <g className="es__stars">
          <circle cx="52" cy="30" r="1.3" /><circle cx="150" cy="26" r="1.6" /><circle cx="164" cy="52" r="1.1" /><circle cx="40" cy="58" r="1" />
        </g>
      )}
      <path className="es__hill es__hill--far" d="M0 100 C 34 78, 66 78, 100 92 S 168 100, 200 84 V128 H0 Z" />
      <path className="es__hill es__hill--near" d="M0 112 C 40 94, 84 96, 116 106 S 176 112, 200 102 V128 H0 Z" />
      <path className="es__check" d="M90 104 l7 7 l14 -15" />
    </svg>
  )
}

/** Empty list. Inbox zero gets the scene and a time-of-day line; other mailboxes get a quiet glyph. */
export function EmptyState({ nav, copy, filtered }: { nav: Nav; copy: Copy; filtered: boolean }): JSX.Element {
  const zero = !filtered && nav.kind === 'role' && nav.role === 'inbox'
  const mood = useMemo(() => inboxZeroLine(), [])
  if (zero) {
    return (
      <div className="es es--zero" role="status">
        <Scene period={mood.period} />
        <p className="es__title">{copy.title}</p>
        <p className="es__body">{mood.line}</p>
      </div>
    )
  }
  const Glyph = glyphFor(nav, filtered)
  const hint = nav.kind === 'search' && !filtered ? 'Try fewer words, or search by sender with from:name.' : null
  return (
    <div className="es" role="status">
      <span className="es__glyph"><Glyph size={20} strokeWidth={1.5} /></span>
      <p className="es__title">{copy.title}</p>
      <p className="es__body">{copy.body}</p>
      {hint && <p className="es__hint">{hint}</p>}
    </div>
  )
}

/** Placeholder rows while the first page loads, so the list does not flash empty. */
export function Skeleton(): JSX.Element {
  return (
    <div className="tl__skel" aria-hidden>
      {Array.from({ length: 9 }, (_, i) => (
        <div className="tl__skelrow" key={i} style={{ '--i': i } as React.CSSProperties}>
          <span className="tl__skelavatar" />
          <span className="tl__skelbar" style={{ width: `${18 + ((i * 7) % 10)}%` }} />
          <span className="tl__skelbar tl__skelbar--wide" style={{ width: `${34 + ((i * 11) % 22)}%` }} />
        </div>
      ))}
    </div>
  )
}
