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
import { editorRegistry } from './registry'
import './compose.css'

export const INLINE_SLOT_ID = 'reader-inline-compose-slot'

export function ComposeHost(): JSX.Element | null {
  const composers = useApp((s) => s.composers)
  const slot = useInlineSlot(composers)
  // Minimised state lives here, not in `Composer`: the row layout needs every width.
  const [minimised, setMinimised] = useState<ReadonlySet<string>>(() => new Set())

  useTestHook()

  if (!composers.length) return null

  const windowed = composers.filter((c) => c.placement !== 'inline' || !slot)
  const inline = slot ? composers.filter((c) => c.placement === 'inline') : []

  return (
    <>
      {/* One row along the bottom-right: each composer is placed to the left of the ones
          already there, so a minimised bar never hides behind an open window. */}
      {layoutRow(windowed, minimised).map(({ composer, offsetRight }, i) => (
        <Composer
          key={composer.id}
          composer={composer}
          offsetRight={offsetRight}
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

const WINDOW_W = 640
const MIN_W = 280
const GAP = 12
const EDGE = 16

/** Right-edge offsets for a row of composers, widest-first from the corner. */
function layoutRow(
  composers: ComposerState[],
  minimised: ReadonlySet<string>
): { composer: ComposerState; offsetRight: number }[] {
  let offset = EDGE
  return composers.map((composer) => {
    const placed = { composer, offsetRight: offset }
    offset += (minimised.has(composer.id) ? MIN_W : WINDOW_W) + GAP
    return placed
  })
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

/**
 * Headless-screenshot hook (see CLAUDE.md). The sidebar and reader that normally open a
 * composer live on other branches, so expose a tiny opener for `MAILROOM_STEPS` execs.
 */
function useTestHook(): void {
  useEffect(() => {
    const w = window as unknown as { __compose?: unknown }
    w.__compose = {
      open: (init?: Partial<ComposerState>) => useApp.getState().openComposer(init),
      close: (id: string) => useApp.getState().closeComposer(id),
      list: () => useApp.getState().composers,
      toasts: () => useApp.getState().toasts,
      editor: (id?: string) =>
        (id ? editorRegistry.get(id) : editorRegistry.values().next().value) ?? null
    }
    return () => { delete w.__compose }
  }, [])
}

export { Composer } from './Composer'
