import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface PopoverProps {
  anchor: HTMLElement | null
  onClose: () => void
  children: ReactNode
  /** Align the popover's left edge (start) or right edge (end) with the anchor. */
  align?: 'start' | 'end'
  width?: number
  /** Gap between anchor and popover. */
  offset?: number
  label?: string
}

/**
 * A Notion-style menu: fixed to the viewport, flipped when it would overflow, dismissed on
 * outside click / Escape, and arrow-key navigable over children marked `data-menuitem`.
 */
export function Popover({ anchor, onClose, children, align = 'start', width = 240, offset = 6, label }: PopoverProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!anchor || !el) return
    const place = (): void => {
      const a = anchor.getBoundingClientRect()
      const h = el.offsetHeight
      const below = a.bottom + offset
      const top = below + h > window.innerHeight - 8 ? Math.max(8, a.top - offset - h) : below
      const raw = align === 'end' ? a.right - width : a.left
      setPos({ top, left: Math.min(Math.max(8, raw), window.innerWidth - width - 8) })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [anchor, align, width, offset])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (!ref.current?.contains(t) && !anchor?.contains(t)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); anchor?.focus(); return }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[data-menuitem]:not([disabled])') ?? [])
      if (!items.length) return
      e.preventDefault()
      const i = items.indexOf(document.activeElement as HTMLElement)
      const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i <= 0 ? items.length : i) - 1
      items[next]?.focus()
    }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [anchor, onClose])

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[data-menuitem]:not([disabled]), input, button')?.focus()
  }, [])

  return createPortal(
    <div
      ref={ref} className="pop" role="menu" aria-label={label} style={{
        width, top: pos?.top ?? -9999, left: pos?.left ?? -9999, visibility: pos ? 'visible' : 'hidden'
      }}
    >
      {children}
    </div>,
    document.body
  )
}

/**
 * Opens a popover anchored to the element that was clicked.
 *
 * `e.currentTarget` is read into a local *before* it reaches `setAnchor`, not inside the
 * updater passed to it: a DOM `MouseEvent`'s `currentTarget` is only valid while the event is
 * actively dispatching, and the browser resets it to `null` the moment dispatch finishes.
 * `setAnchor(cur => cur ? null : e.currentTarget)` reads `e.currentTarget` when React invokes
 * that function during its next render, not when this handler runs — usually a tick later, by
 * which point `currentTarget` had already gone back to `null`. Most of the time React's render
 * lands soon enough that it still worked; occasionally (a slower frame, another update ahead of
 * it in the batch) it didn't, and the button did nothing. Capturing the element eagerly removes
 * the race entirely, regardless of how or when React chooses to invoke the updater.
 */
export function useAnchor(): [HTMLElement | null, (e: { currentTarget: HTMLElement }) => void, () => void] {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return [
    anchor,
    (e) => { const el = e.currentTarget; setAnchor((cur) => (cur ? null : el)) },
    () => setAnchor(null)
  ]
}
