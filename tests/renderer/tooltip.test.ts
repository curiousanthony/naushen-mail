import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computeTooltipPosition, isWarm, splitShortcutHint } from '@/features/tooltip/position'
import { useTooltipStore } from '@/features/tooltip/tooltipStore'

const viewport = { width: 1280, height: 820 }
const anchor = (over: Partial<{ top: number; left: number; width: number; height: number }> = {}) => {
  const a = { top: 100, left: 600, width: 24, height: 24, ...over }
  return { ...a, right: a.left + a.width, bottom: a.top + a.height }
}
const size = { width: 80, height: 24 }

describe('computeTooltipPosition', () => {
  it('centers the tooltip under the anchor when there is room', () => {
    const pos = computeTooltipPosition(anchor(), size, viewport)
    expect(pos.placement).toBe('bottom')
    expect(pos.y).toBe(100 + 24 + 8) // anchor.bottom + GAP
    expect(pos.x).toBe(600 + 12 - 40) // anchor center - tooltip.width / 2
  })

  it('flips above the anchor when there is no room below', () => {
    const pos = computeTooltipPosition(anchor({ top: 800, height: 16 }), size, viewport)
    expect(pos.placement).toBe('top')
    expect(pos.y).toBe(800 - 8 - 24) // anchor.top - GAP - tooltip.height
  })

  it('clamps horizontally instead of rendering off the left edge', () => {
    const pos = computeTooltipPosition(anchor({ left: 0, width: 16 }), size, viewport)
    expect(pos.x).toBe(8) // EDGE_MARGIN
  })

  it('clamps horizontally instead of rendering off the right edge', () => {
    const pos = computeTooltipPosition(anchor({ left: 1260, width: 16 }), size, viewport)
    expect(pos.x).toBe(viewport.width - size.width - 8) // viewport.width - tooltip.width - EDGE_MARGIN
  })

  it('falls back to whichever side has more room when the tooltip fits neither', () => {
    // A tiny viewport where the tooltip (200px tall) can't fully fit above or below the anchor.
    const tiny = { width: 400, height: 100 }
    const below = computeTooltipPosition(anchor({ top: 40, height: 10 }), { width: 80, height: 200 }, tiny)
    expect(below.placement).toBe('bottom') // spaceBelow (50) >= spaceAbove (40)
    const above = computeTooltipPosition(anchor({ top: 70, height: 10 }), { width: 80, height: 200 }, tiny)
    expect(above.placement).toBe('top') // spaceAbove (70) > spaceBelow (20)
  })
})

describe('isWarm', () => {
  it('is not warm before anything has hidden', () => {
    expect(isWarm(null, Date.now())).toBe(false)
  })

  it('is warm just after a hide, and stays warm right up to the window edge', () => {
    const hideAt = 1_000
    expect(isWarm(hideAt, 1_000)).toBe(true)
    expect(isWarm(hideAt, 1_399)).toBe(true) // WARM_WINDOW_MS = 400
    expect(isWarm(hideAt, 1_400)).toBe(true)
  })

  it('cools back down once the warm window has passed', () => {
    expect(isWarm(1_000, 1_401)).toBe(false)
    expect(isWarm(1_000, 5_000)).toBe(false)
  })
})

describe('useTooltipStore', () => {
  const el = {} as Element
  const reset = (): void => useTooltipStore.setState({ visible: false, anchorEl: null, label: '', shortcut: undefined, lastHideAt: null })

  beforeEach(() => { vi.useFakeTimers(); reset() })
  afterEach(() => { vi.useRealTimers() })

  it('waits the full show delay on a cold hover', () => {
    useTooltipStore.getState().scheduleShow(el, 'Archive')
    expect(useTooltipStore.getState().visible).toBe(false)
    vi.advanceTimersByTime(449)
    expect(useTooltipStore.getState().visible).toBe(false)
    vi.advanceTimersByTime(1)
    expect(useTooltipStore.getState().visible).toBe(true)
  })

  it('shows instantly for a second hover within the warm window after a hide', () => {
    useTooltipStore.getState().scheduleShow(el, 'Archive')
    vi.advanceTimersByTime(450)
    expect(useTooltipStore.getState().visible).toBe(true)

    useTooltipStore.getState().hide()
    expect(useTooltipStore.getState().visible).toBe(false)

    vi.advanceTimersByTime(100) // well inside the 400ms warm window
    useTooltipStore.getState().scheduleShow(el, 'Trash')
    expect(useTooltipStore.getState().visible).toBe(true) // no delay this time
    expect(useTooltipStore.getState().label).toBe('Trash')
  })

  it('does not grant a warm instant-show from a hide that never actually showed anything', () => {
    // Hovering briefly and leaving before the 450ms delay elapses must not count as "warm" —
    // otherwise every stray mouse pass over the app would arm the next tooltip's fast path.
    useTooltipStore.getState().scheduleShow(el, 'Archive')
    vi.advanceTimersByTime(100)
    useTooltipStore.getState().hide() // cancels the pending timer; nothing was ever shown
    expect(useTooltipStore.getState().lastHideAt).toBeNull()

    useTooltipStore.getState().scheduleShow(el, 'Trash')
    expect(useTooltipStore.getState().visible).toBe(false) // still cold, still delayed
    vi.advanceTimersByTime(450)
    expect(useTooltipStore.getState().visible).toBe(true)
  })

  it('hide() is a no-op when nothing is visible or pending', () => {
    const before = useTooltipStore.getState()
    useTooltipStore.getState().hide()
    expect(useTooltipStore.getState()).toBe(before) // same reference: no unnecessary re-render
  })
})

describe('splitShortcutHint', () => {
  it('pulls a trailing modifier-key hint into its own field', () => {
    expect(splitShortcutHint('Discard draft (⌘⇧D)')).toEqual({ text: 'Discard draft', shortcut: '⌘⇧D' })
    expect(splitShortcutHint('Bold (⌘B)')).toEqual({ text: 'Bold', shortcut: '⌘B' })
  })

  it('recognises a single letter or symbol as a shortcut too', () => {
    expect(splitShortcutHint('Archive (e)')).toEqual({ text: 'Archive', shortcut: 'e' })
    expect(splitShortcutHint('Report spam (!)')).toEqual({ text: 'Report spam', shortcut: '!' })
    expect(splitShortcutHint('Close (esc)')).toEqual({ text: 'Close', shortcut: 'esc' })
  })

  it('leaves a label with no parenthetical, or a non-shortcut parenthetical, untouched', () => {
    expect(splitShortcutHint('Attach files')).toEqual({ text: 'Attach files' })
    expect(splitShortcutHint('No accounts yet (really)')).toEqual({ text: 'No accounts yet (really)' })
  })
})
