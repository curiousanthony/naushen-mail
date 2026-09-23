/**
 * Pure geometry + timing helpers for the tooltip system. Kept dependency-free (no DOM, no
 * React) so they're cheap to unit test — see tests/renderer/tooltip.test.ts.
 */

export interface Rect { top: number; left: number; right: number; bottom: number; width: number; height: number }
export interface Size { width: number; height: number }
export interface Viewport { width: number; height: number }
export type Placement = 'top' | 'bottom'

export interface TooltipPosition { x: number; y: number; placement: Placement }

/** Gap kept between the anchor and the tooltip. */
export const GAP = 8
/** Minimum distance kept from the window edge — this is a fixed-size Electron window, not a
 *  scrollable page, so a tooltip that would clip off-screen needs to flip or clamp, not scroll. */
export const EDGE_MARGIN = 8

/** Delay before a tooltip appears on a "cold" hover — Notion Mail's tooltip felt instant once
 *  you were already moving between adjacent controls, so this only applies to the first hover. */
export const SHOW_DELAY_MS = 450
/** How long the tooltip system stays "warm" after hiding one tooltip — a hover that lands on a
 *  new target within this window skips the delay so tooltips feel responsive while scanning a
 *  toolbar, instead of re-waiting on every single icon. */
export const WARM_WINDOW_MS = 400

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/**
 * Centers the tooltip under the anchor, flipping above it when there isn't room below, and
 * clamps it horizontally so it never renders past the window edge.
 */
export function computeTooltipPosition(anchor: Rect, tooltip: Size, viewport: Viewport): TooltipPosition {
  const centerX = anchor.left + anchor.width / 2
  const x = clamp(centerX - tooltip.width / 2, EDGE_MARGIN, viewport.width - tooltip.width - EDGE_MARGIN)

  const spaceBelow = viewport.height - anchor.bottom
  const spaceAbove = anchor.top
  const fitsBelow = spaceBelow >= tooltip.height + GAP + EDGE_MARGIN
  const placement: Placement = fitsBelow || spaceBelow >= spaceAbove ? 'bottom' : 'top'
  const y = placement === 'bottom' ? anchor.bottom + GAP : anchor.top - GAP - tooltip.height

  return { x, y, placement }
}

/** True if `now` still falls within the "warm" window after the tooltip system last hid something. */
export function isWarm(lastHideAt: number | null, now: number): boolean {
  return lastHideAt !== null && now - lastHideAt <= WARM_WINDOW_MS
}

/**
 * Splits a "Label (⌘X)" string into separate label/shortcut parts, for call sites that already
 * bake a shortcut hint into their title text (e.g. "Discard draft (⌘⇧D)", "Bold (⌘B)") and want
 * it rendered as the tooltip's separate key chip instead of one long string.
 */
export function splitShortcutHint(label: string): { text: string; shortcut?: string } {
  const m = /^(.*)\s+\(([^()]+)\)$/.exec(label)
  if (!m) return { text: label }
  const [, text, hint] = m
  // Only treat the parenthetical as a shortcut if it looks like one.
  if (!/[⌘⇧⌥⌃]|^esc$|^[a-z0-9#!]$/i.test(hint)) return { text: label }
  return { text, shortcut: hint }
}
