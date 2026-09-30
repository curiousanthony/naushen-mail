import { describe, expect, it } from 'vitest'
import { joinAddresses } from '../../src/renderer/features/reader/addressCopy'

describe('joinAddresses', () => {
  it('joins bare addresses with comma+space', () => {
    expect(joinAddresses([{ name: 'A', email: 'a@x.com' }, { email: 'b@y.org' }])).toBe('a@x.com, b@y.org')
  })
  it('keeps the display name for a single address', () => {
    expect(joinAddresses([{ name: 'Ann', email: 'ann@x.com' }])).toBe('Ann <ann@x.com>')
    expect(joinAddresses([{ email: 'ann@x.com' }])).toBe('ann@x.com')
  })
  it('handles empty input and skips blank emails', () => {
    expect(joinAddresses([])).toBe('')
    expect(joinAddresses([{ email: '' }, { email: 'a@x.com' }, { email: 'b@x.com' }])).toBe('a@x.com, b@x.com')
  })
})
