/**
 * Sizing and positioning for the floating composer row (bottom-right of the window).
 *
 * `ComposeHost` lays several composers out right-to-left: each new one sits to the left of the
 * ones already there. At a fixed 640px width that overflows the left edge of the screen with as
 * few as two composers open at common window widths (1280px, and the app's 900px minimum — see
 * `docs/00-decisions.md`). This module is the pure layout math, kept separate from the component
 * so it is unit-testable without React or a DOM: given the open/minimised composers and the
 * current viewport width, it returns each one's on-screen width and its offset from the right
 * edge.
 *
 * Composers shrink together to fit the viewport as more of them stack up. If even the floor
 * width would still run the row past the left edge, they cascade instead — each one overlapping
 * the last by more than a full gap — rather than clipping off-screen. A cascaded composer's own
 * header controls (minimise/maximise/close) sit at its right edge, which is exactly the side a
 * cascade leaves exposed, so they stay reachable even when overlapped.
 */

/** A single composer at its natural (uncontended) size. */
export const WINDOW_W = 640
/** Width of a minimised bar — unaffected by shrinking. */
export const MIN_W = 280
/** Never shrink an open composer below this: the footer toolbar needs the room. */
export const COMPOSER_MIN_W = 380
export const GAP = 12
export const EDGE = 16
/** Smallest sliver of a cascaded composer that must stay exposed (beyond its own header controls). */
const PEEK = 48

export interface LayoutItem {
  id: string
  minimised: boolean
}

export interface PlacedComposer {
  id: string
  offsetRight: number
  width: number
}

/**
 * @param items composers in the order they render (paint order: later ones sit on top)
 * @param viewportWidth current `window.innerWidth`
 */
export function layoutComposers(items: LayoutItem[], viewportWidth: number): PlacedComposer[] {
  const openCount = items.reduce((n, i) => n + (i.minimised ? 0 : 1), 0)
  const minimisedCount = items.length - openCount

  const spentOnMinimised = minimisedCount * (MIN_W + GAP)
  const available = Math.max(COMPOSER_MIN_W, viewportWidth - EDGE * 2 - spentOnMinimised)

  const evenWidth = openCount > 0 ? (available - GAP * (openCount - 1)) / openCount : WINDOW_W
  const width = Math.min(WINDOW_W, Math.max(COMPOSER_MIN_W, Math.floor(evenWidth)))

  // Normal spacing keeps a full gap between open composers. If they do not fit side by side
  // even at the floor width, shrink the step between them (down to PEEK) so the row cascades
  // instead of pushing the leftmost composer off-screen.
  const sideBySideWidth = openCount * width + Math.max(0, openCount - 1) * GAP
  const openStep = openCount > 1 && sideBySideWidth > available
    ? Math.max(PEEK, (available - width) / (openCount - 1))
    : width + GAP

  let offset = EDGE
  return items.map((item) => {
    const w = item.minimised ? MIN_W : width
    const placed: PlacedComposer = { id: item.id, offsetRight: offset, width: w }
    offset += item.minimised ? MIN_W + GAP : openStep
    return placed
  })
}
