import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Copy, PenLine, Search } from 'lucide-react'
import type { PersonInfo } from '@shared/types'
import { useApp } from '@/lib/store'
import { displayName, listTime } from '@/lib/format'
import { Keys } from '../commands/Keycaps'
import { useTooltipStore } from '../tooltip/tooltipStore'
import { PersonAvatar } from './Avatar'
import { allMailFrom, composeTo, copyAddress } from './actions'
import { getPersonInfo } from './data'
import { conversationsLine } from './format'
import { placeCard, CARD_W } from './position'
import { cancelClose, hoverLeave, usePeopleUi } from './store'
import './people.css'

/**
 * The one sender card for the whole app (hosted by CommandPalette so App.tsx needs no change).
 * Local data only: `people.info` reads the SQLite store. Opened by hovering a sender name in
 * the reader (SenderName) or by `i`; dismissed by Esc, click outside, or mouse-out (hover only).
 */
export function SenderCard(): JSX.Element | null {
  const card = usePeopleUi((s) => s.card)
  return card ? <CardBody key={card.email + card.via} /> : null
}

function CardBody(): JSX.Element | null {
  const card = usePeopleUi((s) => s.card)!
  const close = usePeopleUi((s) => s.close)
  const [info, setInfo] = useState<PersonInfo | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean } | null>(null)
  const byKey = card.via === 'key'
  const accounts = useApp((s) => s.accounts)
  const isMe = accounts.some((a) => a.email.toLowerCase() === card.email.toLowerCase())

  useEffect(() => { useTooltipStore.getState().hide() }, [])

  useEffect(() => {
    let live = true
    getPersonInfo(card.email).then((i) => { if (live) setInfo(i) }).catch(() => undefined)
    return () => { live = false }
  }, [card.email])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos(placeCard(card.rect, { width: CARD_W, height: r.height }, { width: window.innerWidth, height: window.innerHeight }))
  }, [card.rect, info])

  const threads = info?.recent ?? []
  const name = card.name ?? info?.name
  const address = { email: card.email, name }

  // Keyboard: Esc always; when opened with `i` the card is a tiny modal with letter/number keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const stop = (): void => { e.preventDefault(); e.stopImmediatePropagation() }
      if (e.key === 'Escape') { stop(); close(); return }
      if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return
      if (!byKey) return
      const k = e.key.toLowerCase()
      if (k === 'c' || k === 'enter') { stop(); close(); composeTo(address) }
      else if (k === 'a') { stop(); close(); allMailFrom(card.email) }
      else if (k === 'y') { stop(); close(); void copyAddress(card.email) }
      else if (k === 'i') { stop(); close() }
      else if (/^[1-3]$/.test(k) && threads[Number(k) - 1]) { stop(); close(); useApp.getState().openThread(threads[Number(k) - 1].id) }
      else if (['j', 'k', 'e', '#', 's', 'r', 'f', 'h', 'l', 'u', 'x', 'z', '/', '?'].includes(k)) stop() // don't act on the thread underneath
    }
    const onDown = (e: MouseEvent): void => { if (ref.current && !ref.current.contains(e.target as Node)) close() }
    const onScroll = (e: Event): void => { if (!ref.current?.contains(e.target as Node)) close() }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('blur', close)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byKey, card.email, name, threads.map((t) => t.id).join('|')])

  const openThread = (id: string): void => { close(); useApp.getState().openThread(id) }

  return (
    <div
      ref={ref}
      className="ppl-card no-drag"
      data-above={pos?.above || undefined}
      style={{ width: CARD_W, left: pos?.left ?? card.rect.left, top: pos?.top ?? card.rect.bottom + 6, visibility: pos ? 'visible' : 'hidden' }}
      role="dialog"
      aria-label={`About ${displayName(address)}`}
      onMouseEnter={cancelClose}
      onMouseLeave={() => { if (!byKey) hoverLeave() }}
    >
      <div className="ppl-card__head">
        <PersonAvatar address={address} size={40} />
        <div className="ppl-card__id">
          <div className="ppl-card__name">{displayName(address)}{isMe && <span className="ppl-card__me">you</span>}</div>
          <div className="ppl-card__email">{card.email}</div>
        </div>
      </div>
      <div className="ppl-card__stats">{info ? conversationsLine(info.threadCount, info.lastAt) : ' '}</div>

      {threads.length > 0 && (
        <ul className="ppl-card__threads">
          {threads.map((t, i) => (
            <li key={t.id}>
              <button type="button" className="ppl-thread" onClick={() => openThread(t.id)}>
                {byKey ? <kbd className="cmd-key">{i + 1}</kbd> : <span className="ppl-thread__dot" data-on={t.unread} aria-hidden />}
                <span className="ppl-thread__subject">{t.subject || '(no subject)'}</span>
                <span className="ppl-thread__time">{listTime(t.lastMessageAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="ppl-card__actions">
        <button type="button" className="ppl-act" onClick={() => { close(); composeTo(address) }}>
          <PenLine size={14} strokeWidth={1.5} /><span>Compose</span>{byKey && <Keys binding="c" />}
        </button>
        <button type="button" className="ppl-act" onClick={() => { close(); allMailFrom(card.email) }}>
          <Search size={14} strokeWidth={1.5} /><span>All mail</span>{byKey && <Keys binding="a" />}
        </button>
        <button type="button" className="ppl-act" onClick={() => { close(); void copyAddress(card.email) }}>
          <Copy size={14} strokeWidth={1.5} /><span>Copy</span>{byKey && <Keys binding="y" />}
        </button>
      </div>
      {byKey && <div className="ppl-card__foot"><kbd className="cmd-key cmd-key--word">esc</kbd><span>close</span></div>}
    </div>
  )
}
