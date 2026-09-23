/**
 * Renders every open composer from `useApp().composers`.
 *
 * `placement: 'window'` floats bottom-right (several stack); `placement: 'inline'` is
 * portalled into the reader's `#reader-inline-compose-slot`. The slot belongs to the reader
 * branch, so its absence is normal — an inline composer then falls back to a window rather
 * than vanishing.
 */

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useApp, type ComposerState } from '@/lib/store'
import { Composer } from './Composer'
import { layoutComposers } from './layout'
import './compose.css'

export const INLINE_SLOT_ID = 'reader-inline-compose-slot'

export function ComposeHost(): JSX.Element | null {
  const composers = useApp((s) => s.composers)
  const slot = useInlineSlot(composers)
  // Minimised state lives here, not in `Composer`: the row layout needs every width.
  const [minimised, setMinimised] = useState<ReadonlySet<string>>(() => new Set())
  const viewportWidth = useViewportWidth()

  if (!composers.length) return null

  const windowed = composers.filter((c) => c.placement !== 'inline' || !slot)
  const inline = slot ? composers.filter((c) => c.placement === 'inline') : []

  const placed = layoutComposers(
    windowed.map((c) => ({ id: c.id, minimised: minimised.has(c.id) })),
    viewportWidth
  )

  return (
    <>
      {/* One row along the bottom-right: each composer is placed to the left of the ones
          already there, so a minimised bar never hides behind an open window. When they no
          longer fit side by side, they cascade instead of clipping off the left edge — see
          `layout.ts`. */}
      {windowed.map((composer, i) => (
        <Composer
          key={composer.id}
          composer={composer}
          offsetRight={placed[i].offsetRight}
          width={placed[i].width}
          stack={i}
          minimised={minimised.has(composer.id)}
          onMinimise={(v) => setMinimised((prev) => {
            const next = new Set(prev)
            v ? next.add(composer.id) : next.delete(composer.id)
            return next
          })}
        />
      ))}
      {inline.length > 0 && slot &&
        createPortal(
          inline.map((c) => (
            <Composer
              key={c.id}
              composer={c}
              inline
              offsetRight={0}
              stack={0}
              minimised={false}
              onMinimise={() => undefined}
            />
          )),
          slot
        )}
    </>
  )
}

/** Tracks `window.innerWidth` so the composer row can re-flow when the app window resizes. */
function useViewportWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth)
  useEffect(() => {
    const onResize = (): void => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return width
}

/**
 * The reader mounts and unmounts its slot as threads open, so re-look it up whenever the
 * composer set changes, and watch the DOM while an inline composer is waiting for it.
 */
function useInlineSlot(composers: ComposerState[]): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const wantsInline = composers.some((c) => c.placement === 'inline')

  useEffect(() => {
    const find = (): void => setSlot(document.getElementById(INLINE_SLOT_ID))
    find()
    if (!wantsInline) return
    const observer = new MutationObserver(find)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [wantsInline, composers.length])

  return slot
}

export { Composer } from './Composer'
