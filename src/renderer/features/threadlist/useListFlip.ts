import { useLayoutEffect, useRef, type RefObject } from 'react'

/** Rows that moved more than this are jumps (new page, filter change), not glides. */
const MAX_GLIDE_PX = 480
export const FLIP_MS = 200
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'

/** Pure: which elements should glide, and from how far. `prev`/`next` are content-relative tops. */
export function flipDeltas(prev: Map<string, number>, next: Map<string, number>, max = MAX_GLIDE_PX): Map<string, number> {
  const out = new Map<string, number>()
  for (const [key, top] of next) {
    const before = prev.get(key)
    if (before === undefined) continue
    const d = before - top
    if (Math.abs(d) >= 1 && Math.abs(d) <= max) out.set(key, d)
  }
  return out
}

/**
 * FLIP for the thread list: when a row leaves (archive, trash, snooze) or one arrives, the rows
 * below glide to their new place instead of jumping. Measures each row's content-relative top
 * after every change to `signature`, then animates from the previous position with WAAPI.
 *
 * Skips: reduced motion, a different mailbox (`resetKey`), and windowed lists (rows are recycled).
 * Never blocks input: the animation is transform-only and finishes inside FLIP_MS.
 */
export function useListFlip(
  scroller: RefObject<HTMLElement | null>, signature: unknown, resetKey: string, enabled: boolean
): void {
  const prev = useRef<Map<string, number>>(new Map())
  const prevReset = useRef(resetKey)

  useLayoutEffect(() => {
    const sc = scroller.current
    if (!sc) return
    const scTop = sc.getBoundingClientRect().top
    const els = new Map<string, HTMLElement>()
    const tops = new Map<string, number>()
    const stuck = new Set<string>()
    sc.querySelectorAll<HTMLElement>('.trow, .tl__group').forEach((el) => {
      const key = el.id || `h:${el.textContent}`
      const r = el.getBoundingClientRect()
      els.set(key, el)
      tops.set(key, r.top - scTop + sc.scrollTop)
      // Sticky group headers pin to the top while scrolling; their measured top is not their slot.
      if (el.classList.contains('tl__group') && Math.abs(r.top - scTop) < 1) stuck.add(key)
    })

    const same = prevReset.current === resetKey
    const before = prev.current
    prev.current = tops
    prevReset.current = resetKey

    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!enabled || !same || reduce || typeof Element.prototype.animate !== 'function') return
    for (const [key, d] of flipDeltas(before, tops)) {
      if (stuck.has(key)) continue
      els.get(key)?.animate(
        [{ transform: `translateY(${d}px)` }, { transform: 'translateY(0)' }],
        { duration: FLIP_MS, easing: EASE }
      )
    }
  }, [scroller, signature, resetKey, enabled])
}
