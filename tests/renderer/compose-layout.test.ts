import { describe, expect, it } from 'vitest'
import { COMPOSER_MIN_W, EDGE, MIN_W, WINDOW_W, layoutComposers, type LayoutItem } from '@/features/compose/layout'

const open = (n: number): LayoutItem[] =>
  Array.from({ length: n }, (_, i) => ({ id: `c${i}`, minimised: false }))

/** No composer's left edge may fall left of the viewport (the clipping bug this guards). */
function leftEdges(items: LayoutItem[], viewportWidth: number): number[] {
  return layoutComposers(items, viewportWidth).map((p) => viewportWidth - p.offsetRight - p.width)
}

describe('layoutComposers', () => {
  it('gives a single composer its full width at a roomy viewport', () => {
    const [placed] = layoutComposers(open(1), 1280)
    expect(placed.width).toBe(WINDOW_W)
    expect(placed.offsetRight).toBe(EDGE)
  })

  it.each([1280, 900])('never clips any composer off the left edge — 2 open at %ipx', (vw) => {
    const edges = leftEdges(open(2), vw)
    for (const x of edges) expect(x).toBeGreaterThanOrEqual(0)
  })

  it.each([1280, 900])('never clips any composer off the left edge — 3 open at %ipx', (vw) => {
    const edges = leftEdges(open(3), vw)
    for (const x of edges) expect(x).toBeGreaterThanOrEqual(0)
  })

  it('shrinks composers to fit side by side before it resorts to cascading', () => {
    // At 1280px, 2 and 3 composers both fit side by side at or above the floor width.
    for (const n of [2, 3]) {
      const placed = layoutComposers(open(n), 1280)
      const widths = new Set(placed.map((p) => p.width))
      expect(widths.size).toBe(1)
      const [{ width }] = placed
      expect(width).toBeGreaterThanOrEqual(COMPOSER_MIN_W)
      // Side-by-side: every composer's offset is a plain function of position, i.e. no overlap.
      const sorted = [...placed].sort((a, b) => a.offsetRight - b.offsetRight)
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].offsetRight).toBeGreaterThanOrEqual(sorted[i - 1].offsetRight + width)
      }
    }
  })

  it('never shrinks an open composer below the floor width', () => {
    for (const n of [2, 3, 5]) {
      for (const width of layoutComposers(open(n), 900).map((p) => p.width)) {
        expect(width).toBeGreaterThanOrEqual(COMPOSER_MIN_W)
      }
    }
  })

  it('cascades instead of clipping when even the floor width does not fit side by side', () => {
    // 3 composers at the floor width need more than the 900px minimum has to offer.
    const placed = layoutComposers(open(3), 900)
    const sorted = [...placed].sort((a, b) => a.offsetRight - b.offsetRight)
    const [a, b] = sorted
    // They overlap: the next composer starts before the previous one's width would allow.
    expect(b.offsetRight).toBeLessThan(a.offsetRight + a.width)
    // But every one is still fully positioned on-screen.
    for (const x of leftEdges(open(3), 900)) expect(x).toBeGreaterThanOrEqual(0)
  })

  it('keeps a minimised bar at its fixed width and leaves room for it in the open composers', () => {
    const items: LayoutItem[] = [{ id: 'min', minimised: true }, { id: 'a', minimised: false }, { id: 'b', minimised: false }]
    const placed = layoutComposers(items, 1280)
    expect(placed[0].width).toBe(MIN_W)
    for (const x of leftEdges(items, 1280)) expect(x).toBeGreaterThanOrEqual(0)
  })

  it('is stable: same inputs produce the same layout', () => {
    expect(layoutComposers(open(3), 1024)).toEqual(layoutComposers(open(3), 1024))
  })
})
