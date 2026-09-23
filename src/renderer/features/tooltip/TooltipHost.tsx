import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTooltipStore } from './tooltipStore'
import { computeTooltipPosition, type TooltipPosition } from './position'
import './tooltip.css'

/** How often to check that a still-visible tooltip's trigger is still on the page. */
const LIVENESS_POLL_MS = 150

/**
 * The one tooltip DOM node for the whole app (mounted once in App.tsx, alongside <Toaster/>).
 * <Tooltip/> wrappers never render their own node — they just push { anchorEl, label, shortcut }
 * into the shared store and this host measures + positions + renders it.
 *
 * Two-pass positioning: render off-screen first to measure the tooltip's own size (its width
 * depends on the label text), then place it — same trick as sidebar/Popover.tsx.
 */
export function TooltipHost(): JSX.Element | null {
  const visible = useTooltipStore((s) => s.visible)
  const anchorEl = useTooltipStore((s) => s.anchorEl)
  const label = useTooltipStore((s) => s.label)
  const shortcut = useTooltipStore((s) => s.shortcut)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<TooltipPosition | null>(null)

  useLayoutEffect(() => {
    if (!visible || !anchorEl || !ref.current) { setPos(null); return }
    const a = anchorEl.getBoundingClientRect()
    const anchor = { top: a.top, left: a.left, right: a.right, bottom: a.bottom, width: a.width, height: a.height }
    const { width, height } = ref.current.getBoundingClientRect()
    setPos(computeTooltipPosition(anchor, { width, height }, { width: window.innerWidth, height: window.innerHeight }))
  }, [visible, anchorEl, label, shortcut])

  // A trigger like "Archive" or "Close" unmounts itself on click — its mouseleave never fires,
  // so a tooltip already on screen would otherwise be stuck until the next scroll/Escape.
  useEffect(() => {
    if (!visible) return
    const id = setInterval(() => {
      if (!anchorEl?.isConnected) useTooltipStore.getState().hide()
    }, LIVENESS_POLL_MS)
    return () => clearInterval(id)
  }, [visible, anchorEl])

  // Hide on scroll (capture: most scroll containers don't bubble) and Escape, from anywhere.
  useEffect(() => {
    const onScroll = (): void => useTooltipStore.getState().hide()
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') useTooltipStore.getState().hide() }
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [])

  if (!visible || !label) return null

  return (
    <div
      ref={ref}
      role="tooltip"
      className="tooltip"
      data-placement={pos?.placement ?? 'bottom'}
      style={{ left: pos ? pos.x : -9999, top: pos ? pos.y : -9999, visibility: pos ? 'visible' : 'hidden' }}
    >
      <span className="tooltip__label">{label}</span>
      {shortcut && <kbd className="tooltip__shortcut">{shortcut}</kbd>}
    </div>
  )
}
