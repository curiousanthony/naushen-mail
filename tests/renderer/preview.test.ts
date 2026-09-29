import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computePreviewPosition, CURSOR_OFFSET_X, CURSOR_OFFSET_Y, EDGE_MARGIN } from '@/features/preview/position'
import { usePreviewStore } from '@/features/preview/previewStore'

const viewport = { width: 1280, height: 820 }
const card = { width: 320, height: 160 }

describe('computePreviewPosition', () => {
  it('places the card below-and-right of the cursor when there is room', () => {
    const pos = computePreviewPosition({ x: 100, y: 100 }, card, viewport)
    expect(pos.x).toBe(100 + CURSOR_OFFSET_X)
    expect(pos.y).toBe(100 + CURSOR_OFFSET_Y)
  })

  it('flips to the left when the card would overflow the right edge', () => {
    const cursor = { x: 1200, y: 100 }
    const pos = computePreviewPosition(cursor, card, viewport)
    expect(pos.x).toBe(cursor.x - CURSOR_OFFSET_X - card.width)
    expect(pos.y).toBe(cursor.y + CURSOR_OFFSET_Y) // vertical placement unaffected
  })

  it('flips above when the card would overflow the bottom edge', () => {
    const cursor = { x: 100, y: 780 }
    const pos = computePreviewPosition(cursor, card, viewport)
    expect(pos.y).toBe(cursor.y - CURSOR_OFFSET_Y - card.height)
    expect(pos.x).toBe(cursor.x + CURSOR_OFFSET_X) // horizontal placement unaffected
  })

  it('flips both ways in the bottom-right corner', () => {
    const cursor = { x: 1250, y: 800 }
    const pos = computePreviewPosition(cursor, card, viewport)
    expect(pos.x).toBe(cursor.x - CURSOR_OFFSET_X - card.width)
    expect(pos.y).toBe(cursor.y - CURSOR_OFFSET_Y - card.height)
  })

  it('clamps to the edge margin when the card is wider/taller than the viewport itself', () => {
    const huge = { width: 1400, height: 900 } // bigger than the 1280x820 viewport
    const pos = computePreviewPosition({ x: 10, y: 10 }, huge, viewport)
    expect(pos.x).toBe(EDGE_MARGIN)
    expect(pos.y).toBe(EDGE_MARGIN)
  })

  it('never places the card past the window edge', () => {
    const cursor = { x: 1270, y: 10 }
    const pos = computePreviewPosition(cursor, card, viewport)
    expect(pos.x + card.width).toBeLessThanOrEqual(viewport.width - EDGE_MARGIN + 1)
    expect(pos.x).toBeGreaterThanOrEqual(EDGE_MARGIN)
  })
})

describe('usePreviewStore', () => {
  const reset = (): void => usePreviewStore.setState({ visible: false, threadId: null, x: 0, y: 0 })

  beforeEach(() => { vi.useFakeTimers(); reset() })
  afterEach(() => { vi.useRealTimers() })

  it('waits the full show delay before appearing', () => {
    usePreviewStore.getState().scheduleShow('t1', 10, 20)
    expect(usePreviewStore.getState().visible).toBe(false)
    expect(usePreviewStore.getState().threadId).toBe('t1') // recorded immediately, shown later
    vi.advanceTimersByTime(449)
    expect(usePreviewStore.getState().visible).toBe(false)
    vi.advanceTimersByTime(1)
    expect(usePreviewStore.getState().visible).toBe(true)
  })

  it('tracks horizontal cursor updates for the currently hovered thread once visible', () => {
    usePreviewStore.getState().scheduleShow('t1', 10, 20)
    vi.advanceTimersByTime(450)
    usePreviewStore.getState().updateCursor('t1', 50)
    // y never moves: the card is anchored to the row it was shown for, not the cursor.
    expect(usePreviewStore.getState()).toMatchObject({ x: 50, y: 20 })
  })

  it('ignores a cursor update for a thread that is no longer the active hover', () => {
    usePreviewStore.getState().scheduleShow('t1', 10, 20)
    usePreviewStore.getState().updateCursor('t2', 999)
    expect(usePreviewStore.getState()).toMatchObject({ x: 10, y: 20, threadId: 't1' })
  })

  it('a hover on a new row before the delay elapses cancels the pending one', () => {
    usePreviewStore.getState().scheduleShow('t1', 10, 20)
    vi.advanceTimersByTime(200)
    usePreviewStore.getState().scheduleShow('t2', 30, 40)
    vi.advanceTimersByTime(250) // t1's original 450ms mark passes here
    expect(usePreviewStore.getState().visible).toBe(false) // t1's timer was cancelled
    vi.advanceTimersByTime(200) // t2's own 450ms mark
    expect(usePreviewStore.getState()).toMatchObject({ visible: true, threadId: 't2' })
  })

  it('hide() with no argument always hides, regardless of which thread is active', () => {
    usePreviewStore.getState().scheduleShow('t1', 10, 20)
    vi.advanceTimersByTime(450)
    usePreviewStore.getState().hide()
    expect(usePreviewStore.getState()).toMatchObject({ visible: false, threadId: null })
  })

  it('hide(id) only hides when that id is the currently active thread', () => {
    usePreviewStore.getState().scheduleShow('t1', 10, 20)
    vi.advanceTimersByTime(450)
    usePreviewStore.getState().hide('t2') // stale unmount from a row that lost the race
    expect(usePreviewStore.getState()).toMatchObject({ visible: true, threadId: 't1' })
    usePreviewStore.getState().hide('t1')
    expect(usePreviewStore.getState()).toMatchObject({ visible: false, threadId: null })
  })

  it('cancels a pending show when hidden before the delay elapses', () => {
    usePreviewStore.getState().scheduleShow('t1', 10, 20)
    vi.advanceTimersByTime(100)
    usePreviewStore.getState().hide('t1')
    vi.advanceTimersByTime(450)
    expect(usePreviewStore.getState().visible).toBe(false)
  })
})
