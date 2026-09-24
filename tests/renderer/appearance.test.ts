import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/types'
import { appearanceAttrs } from '@/features/settings/lib/appearance'
import { readExt } from '@/features/settings/lib/settings-ext'
import { flipDeltas } from '@/features/threadlist/useListFlip'

const withExt = (p: Record<string, unknown>): AppSettings => ({ ...DEFAULT_SETTINGS, ...p }) as AppSettings

describe('appearance attributes', () => {
  it('defaults to comfortable + blue (no accent attribute)', () => {
    expect(appearanceAttrs(DEFAULT_SETTINGS)).toEqual({ density: 'comfortable', accent: null })
  })
  it('maps compact density and a chosen accent', () => {
    expect(appearanceAttrs(withExt({ density: 'compact', accent: 'violet' }))).toEqual({ density: 'compact', accent: 'violet' })
  })
  it('ignores unknown accent values', () => {
    expect(readExt(withExt({ accent: 'chartreuse' })).accent).toBe('blue')
    expect(appearanceAttrs(withExt({ accent: 42 })).accent).toBeNull()
  })
})

describe('list flip deltas', () => {
  it('glides rows that moved, ignores new/unmoved/huge jumps', () => {
    const prev = new Map([['a', 0], ['b', 44], ['c', 88], ['d', 132], ['z', 0]])
    const next = new Map([['a', 0], ['c', 44], ['d', 88], ['n', 132], ['z', 5000]])
    expect([...flipDeltas(prev, next)]).toEqual([['c', 44], ['d', 44]])
  })
})
