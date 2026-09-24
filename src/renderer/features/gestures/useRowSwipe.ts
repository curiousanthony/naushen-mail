import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { usePreviewStore } from '@/features/preview'
import { RELEASE_MS, SwipeTracker, WheelBurst, type SwipeSide } from './swipe'

/** One burst classifier for the whole list: only one row is ever under the fingers. */
const burst = new WheelBurst()

const reducedMotion = (): boolean =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export interface SwipeUi {
  /** Direction swiped so far (the row moved this way). */
  side: SwipeSide
  /** Past the threshold: releasing commits. */
  armed: boolean
}

export interface RowSwipeOptions {
  enabled: boolean
  /** The row content that translates. */
  rowRef: RefObject<HTMLElement | null>
  /** The wrapper that clips it and carries `--swipe-p`. */
  wrapRef: RefObject<HTMLElement | null>
  /** Should this side slide the row out of view before committing (archive) or spring back (remind)? */
  slidesOut(side: SwipeSide): boolean
  /** Perform the action for a committed swipe. */
  onCommit(side: SwipeSide): void
}

const SPRING = 'transform 340ms cubic-bezier(0.2, 1.35, 0.4, 1)'
const SLIDE = 'transform 170ms cubic-bezier(0.5, 0, 0.9, 0.6)'

/**
 * Two-finger horizontal trackpad swipe on a row (macOS wheel events). Follows the fingers with
 * rubber-band friction, arms at a threshold, commits on release. It only claims a wheel burst
 * that is clearly horizontal from its first events, so vertical scrolling is never touched.
 * Movement is written straight to the DOM (no React render per wheel event); React state only
 * changes when the strip appears, arms or goes away.
 */
export function useRowSwipe(opts: RowSwipeOptions): SwipeUi | null {
  const [ui, setUi] = useState<SwipeUi | null>(null)
  const o = useRef(opts)
  o.current = opts
  const tracker = useRef<SwipeTracker | null>(null)
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null)
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null)
  const restore = useRef<ReturnType<typeof setTimeout> | null>(null)
  const uiRef = useRef<SwipeUi | null>(null)
  const busy = useRef(false) // committing / springing: ignore new swipes

  const publish = (next: SwipeUi | null): void => {
    const cur = uiRef.current
    if (cur?.side === next?.side && cur?.armed === next?.armed) return
    uiRef.current = next
    setUi(next)
  }

  const paint = useCallback((offset: number, progress: number, transition: string): void => {
    const row = o.current.rowRef.current
    const wrap = o.current.wrapRef.current
    if (!row || !wrap) return
    row.style.transition = transition
    row.style.transform = offset === 0 && !transition ? '' : `translate3d(${offset}px,0,0)`
    wrap.style.setProperty('--swipe-p', String(progress))
  }, [])

  const reset = useCallback((animated: boolean): void => {
    const row = o.current.rowRef.current
    tracker.current = null
    if (settle.current) clearTimeout(settle.current)
    const done = (): void => {
      settle.current = null
      if (row) { row.style.transition = ''; row.style.transform = '' }
      o.current.wrapRef.current?.style.removeProperty('--swipe-p')
      busy.current = false
      publish(null)
    }
    if (!animated || reducedMotion()) { paint(0, 0, ''); done(); return }
    paint(0, 0, SPRING)
    settle.current = setTimeout(done, 360)
  }, [paint])

  const release = useCallback((): void => {
    if (idle.current) { clearTimeout(idle.current); idle.current = null }
    const t = tracker.current
    if (!t) return
    tracker.current = null // later wheel events in this burst are inertia, not a new swipe
    burst.finish() // the rest of this burst is inertia; nothing may start from it
    const side = t.release()
    if (!side) { busy.current = true; reset(true); return }
    busy.current = true
    const width = o.current.wrapRef.current?.clientWidth ?? 600
    const slide = o.current.slidesOut(side)
    if (slide) {
      // Row leaves the way it was pushed, then the action lands (the list drops the row).
      paint(side === 'left' ? -width : width, 1, reducedMotion() ? '' : SLIDE)
      const fire = (): void => {
        o.current.onCommit(side)
        // If the row is still here a moment later (e.g. "archive" inside All Mail), bring it back.
        restore.current = setTimeout(() => { restore.current = null; reset(true) }, 450)
      }
      if (reducedMotion()) fire(); else settle.current = setTimeout(fire, 165)
    } else {
      // Spring back first, then the picker/overlay opens over a settled list.
      o.current.onCommit(side)
      reset(true)
    }
  }, [paint, reset])

  useEffect(() => {
    const wrap = opts.wrapRef.current
    if (!wrap || !opts.enabled) return undefined
    const onWheel = (e: WheelEvent): void => {
      if (e.ctrlKey || e.metaKey) return // pinch-zoom / cmd-scroll
      // Real trackpad deltas are small and pixel-based; a mouse wheel's are big or line-based.
      const px = e.deltaMode === 0
      const dx = e.deltaX
      if (!px || Math.abs(dx) > 90) return
      const axis = burst.feed(dx, e.deltaY, e.timeStamp)
      const t = tracker.current
      if (t) {
        e.preventDefault()
        const decel = t.push(dx)
        const v = t.view()
        paint(v.offset, v.progress, '')
        if (v.side) publish({ side: v.side, armed: v.armed })
        if (decel) { release(); return }
        if (idle.current) clearTimeout(idle.current)
        idle.current = setTimeout(release, RELEASE_MS)
        return
      }
      if (axis !== 'x' || busy.current) return
      // A new swipe. Seed with everything the burst has moved so far.
      e.preventDefault()
      usePreviewStore.getState().hide()
      const nt = new SwipeTracker()
      nt.raw = -burst.sumX
      tracker.current = nt
      const v = nt.view()
      paint(v.offset, v.progress, '')
      if (v.side) publish({ side: v.side, armed: v.armed })
      idle.current = setTimeout(release, RELEASE_MS)
    }
    // Non-passive: preventDefault is what stops the list (and Chromium's history swipe) reacting.
    wrap.addEventListener('wheel', onWheel, { passive: false })
    return () => wrap.removeEventListener('wheel', onWheel)
  }, [opts.enabled, opts.wrapRef, paint, release])

  useEffect(() => () => {
    for (const r of [idle, settle, restore]) if (r.current) clearTimeout(r.current)
  }, [])

  return ui
}
