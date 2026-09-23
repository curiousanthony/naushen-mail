import { describe, expect, it } from 'vitest'
import { gravatarUrl, md5Hex } from '../../src/renderer/lib/avatar'

describe('md5Hex', () => {
  // RFC 1321 test vectors.
  it('matches known MD5 digests', () => {
    expect(md5Hex('')).toBe('d41d8cd98f00b204e9800998ecf8427e')
    expect(md5Hex('a')).toBe('0cc175b9c0f1b6a831c399e269772661')
    expect(md5Hex('abc')).toBe('900150983cd24fb0d6963f7d28e17f72')
    expect(md5Hex('message digest')).toBe('f96b697d7cb7938d525a2f31aaf161d0')
    expect(md5Hex('abcdefghijklmnopqrstuvwxyz')).toBe('c3fcd3d76192e4007dfb496cca67e13b')
    expect(md5Hex('The quick brown fox jumps over the lazy dog')).toBe('9e107d9d372bb6826bd81d3542a419d6')
  })

  it('handles multi-block input (>55 bytes) and unicode', () => {
    expect(md5Hex('a'.repeat(100))).toHaveLength(32)
    expect(md5Hex('café ☕️ 日本語')).toHaveLength(32)
  })
})

describe('gravatarUrl', () => {
  it('lowercases and trims the email before hashing (Gravatar spec)', () => {
    expect(gravatarUrl('  Person@Example.com  ')).toBe(gravatarUrl('person@example.com'))
  })

  it('uses the well-known Gravatar hash for a documented example address', () => {
    // Gravatar's own docs use this exact address/hash pair as their canonical example.
    expect(gravatarUrl('MyEmailAddress@example.com')).toContain('0bc83cb571cd1c50ba6f3e8a78ef1346')
  })

  it('requests a 404 instead of a default placeholder, so callers can fall back to initials', () => {
    expect(gravatarUrl('a@b.co')).toMatch(/[?&]d=404(&|$)/)
  })
})
