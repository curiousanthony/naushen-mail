/**
 * Pure geometry + timing helpers for the thread-row preview card. Kept dependency-free (no DOM,
 * no React) so they're cheap to unit test — same convention as tooltip/position.ts.
 */

export interface Point { x: number; y: number }
export interface Size { width: number; height: number }
export interface Viewport { width: number; height: number }

/** Offset from the cursor tip to the card's top-left corner, in its default (below-right)
 *  placement — enough that the card doesn't sit directly under the pointer. */
export const CURSOR_OFFSET_X = 18
export const CURSOR_OFFSET_Y = 22
/** Minimum distance kept from the window edge — a fixed-size Electron window, not a scrollable
 *  page, so a card that would clip off-screen needs to flip or clamp, not scroll. */
export const EDGE_MARGIN = 8

/** Delay before the preview appears on hover — long enough that scanning down the list fast with
 *  the mouse never triggers it, short enough to still feel responsive once you pause on a row. */
export const SHOW_DELAY_MS = 450

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/**
 * Places the card just below-and-right of the cursor, flipping to the left and/or above when it
 * would otherwise overflow the window's right or bottom edge, then clamps to the window bounds as
 * a final guard (e.g. a card taller than the viewport).
 */
export function computePreviewPosition(cursor: Point, card: Size, viewport: Viewport): Point {
  let x = cursor.x + CURSOR_OFFSET_X
  let y = cursor.y + CURSOR_OFFSET_Y

  if (x + card.width + EDGE_MARGIN > viewport.width) x = cursor.x - CURSOR_OFFSET_X - card.width
  if (y + card.height + EDGE_MARGIN > viewport.height) y = cursor.y - CURSOR_OFFSET_Y - card.height

  x = clamp(x, EDGE_MARGIN, viewport.width - card.width - EDGE_MARGIN)
  y = clamp(y, EDGE_MARGIN, viewport.height - card.height - EDGE_MARGIN)

  return { x, y }
}
