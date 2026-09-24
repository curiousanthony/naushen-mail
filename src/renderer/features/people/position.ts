import type { AnchorRect } from './store'

export const CARD_W = 320
export const GAP = 6
export const MARGIN = 8

/**
 * Card goes just under the name, left-aligned with it; flips above when the bottom would clip;
 * clamped to the window. Pure so it is unit-testable.
 */
export function placeCard(anchor: AnchorRect, size: { width: number; height: number }, vp: { width: number; height: number }): { left: number; top: number; above: boolean } {
  let top = anchor.bottom + GAP
  let above = false
  if (top + size.height + MARGIN > vp.height && anchor.top - GAP - size.height >= MARGIN) { top = anchor.top - GAP - size.height; above = true }
  top = Math.max(MARGIN, Math.min(top, vp.height - size.height - MARGIN))
  const left = Math.max(MARGIN, Math.min(anchor.left, vp.width - size.width - MARGIN))
  return { left, top, above }
}
