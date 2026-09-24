import { describe, expect, it } from 'vitest'
import { placeCard } from '../../src/renderer/features/people/position'

const vp = { width: 1280, height: 820 }
const size = { width: 340, height: 230 }

describe('placeCard', () => {
  it('sits under the name, left-aligned', () => {
    expect(placeCard({ left: 100, top: 100, right: 180, bottom: 118 }, size, vp)).toEqual({ left: 100, top: 124, above: false })
  })
  it('flips above near the bottom edge', () => {
    const p = placeCard({ left: 100, top: 700, right: 180, bottom: 718 }, size, vp)
    expect(p.above).toBe(true)
    expect(p.top).toBe(700 - 6 - 230)
  })
  it('clamps horizontally into the window', () => {
    expect(placeCard({ left: 1200, top: 100, right: 1270, bottom: 118 }, size, vp).left).toBe(1280 - 340 - 8)
  })
})
