/**
 * Pure width-from-drag-delta math for the image resize handles (`ImageBlock.tsx`). Kept in
 * its own dependency-free module so it is unit-testable without a DOM (this repo's tests run
 * in vitest's `node` environment — see `vitest.config.ts`).
 */

export const IMAGE_MIN_WIDTH = 72

export type ImageResizeSide = 'left' | 'right'

export interface ResizeDragArgs {
  /** Image width in px when the drag started. */
  startWidth: number
  /** `event.clientX - dragStartClientX`, signed. */
  deltaX: number
  /** Which handle is being dragged. */
  side: ImageResizeSide
  /** The editor content's rendered width — an image can never be resized past it. */
  maxWidth: number
  minWidth?: number
}

/**
 * Dragging the right handle right (positive `deltaX`) grows the image; dragging the left
 * handle left (negative `deltaX`) also grows it, so the left handle's delta is inverted.
 * Only `width` is ever stored — the image keeps `height:auto` everywhere it's rendered
 * (editor and email HTML alike), so aspect ratio falls out for free.
 */
export function resizedWidth({ startWidth, deltaX, side, maxWidth, minWidth = IMAGE_MIN_WIDTH }: ResizeDragArgs): number {
  const signedDelta = side === 'right' ? deltaX : -deltaX
  const raw = startWidth + signedDelta
  // maxWidth is a hard ceiling (never resize wider than the composer can show); if the
  // composer is so narrow that maxWidth < minWidth, maxWidth wins so the ceiling still holds.
  const hi = maxWidth
  const lo = Math.min(minWidth, maxWidth)
  return Math.round(Math.min(hi, Math.max(lo, raw)))
}
