import { describe, expect, it } from 'vitest'
import { IMAGE_MIN_WIDTH, resizedWidth } from '@/features/compose/imageResize'

describe('resizedWidth', () => {
  it('grows when the right handle moves right', () => {
    expect(resizedWidth({ startWidth: 200, deltaX: 40, side: 'right', maxWidth: 640 })).toBe(240)
  })

  it('shrinks when the right handle moves left', () => {
    expect(resizedWidth({ startWidth: 200, deltaX: -40, side: 'right', maxWidth: 640 })).toBe(160)
  })

  it('grows when the left handle moves left', () => {
    expect(resizedWidth({ startWidth: 200, deltaX: -40, side: 'left', maxWidth: 640 })).toBe(240)
  })

  it('shrinks when the left handle moves right', () => {
    expect(resizedWidth({ startWidth: 200, deltaX: 40, side: 'left', maxWidth: 640 })).toBe(160)
  })

  it('clamps to the minimum width', () => {
    expect(resizedWidth({ startWidth: 100, deltaX: -500, side: 'right', maxWidth: 640 })).toBe(IMAGE_MIN_WIDTH)
    expect(resizedWidth({ startWidth: 100, deltaX: -500, side: 'right', maxWidth: 640, minWidth: 50 })).toBe(50)
  })

  it('clamps to the max width (the editor content width)', () => {
    expect(resizedWidth({ startWidth: 400, deltaX: 1000, side: 'right', maxWidth: 500 })).toBe(500)
  })

  it('rounds to a whole pixel', () => {
    expect(resizedWidth({ startWidth: 200.4, deltaX: 0.3, side: 'right', maxWidth: 640 })).toBe(201)
  })

  it('never exceeds maxWidth even if that is narrower than minWidth', () => {
    expect(resizedWidth({ startWidth: 200, deltaX: 1000, side: 'right', maxWidth: 40 })).toBe(40)
    expect(resizedWidth({ startWidth: 200, deltaX: -1000, side: 'right', maxWidth: 40 })).toBe(40)
  })
})
