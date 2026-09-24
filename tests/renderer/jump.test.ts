import { describe, expect, it } from 'vitest'
import { highlightSegments, scoreMatch } from '../../src/renderer/features/commands/filter'
import { HALF_LIFE_MS, MAX_ENTRIES, bumpFrecency, type FrecencyStore, frecencyBoost, frecencyScore } from '../../src/renderer/features/commands/frecency'
import { blendScore, looksLikeEmail, orderGroups, rankScored } from '../../src/renderer/features/commands/jump'
import { conversationsLine, lastSeenLabel } from '../../src/renderer/features/people/format'
import { tidyOptions } from '../../src/renderer/features/whichkey/logic'
import { groupShortcuts } from '../../src/renderer/features/commands/sheet'
import type { ShortcutDef } from '../../src/renderer/features/commands/shortcuts'

describe('highlightSegments', () => {
  it('marks matching runs and keeps the original casing', () => {
    expect(highlightSegments('Priya Patel', 'pat')).toEqual([{ text: 'Priya ', hit: false }, { text: 'Pat', hit: true }, { text: 'el', hit: false }])
  })
  it('prefers a word start over an inner occurrence', () => {
    const segs = highlightSegments('Brian Ana', 'an')
    expect(segs.find((s) => s.hit)?.text).toBe('An')
    expect(segs.map((s) => s.text).join('')).toBe('Brian Ana')
    expect(segs[0]).toEqual({ text: 'Brian ', hit: false })
  })
  it('merges overlapping tokens and handles no match / empty query', () => {
    expect(highlightSegments('invoice', 'inv voi')).toEqual([{ text: 'invoi', hit: true }, { text: 'ce', hit: false }])
    expect(highlightSegments('hello', 'zzz')).toEqual([{ text: 'hello', hit: false }])
    expect(highlightSegments('hello', '  ')).toEqual([{ text: 'hello', hit: false }])
  })
  it('escapes regex characters in the query', () => {
    expect(() => highlightSegments('a (b) c', '(b')).not.toThrow()
  })
})

describe('frecency', () => {
  const t0 = 1_700_000_000_000
  it('grows with picks and halves after one half-life', () => {
    let s = bumpFrecency({}, 'cmd:a', t0)
    s = bumpFrecency(s, 'cmd:a', t0)
    expect(frecencyScore(s, 'cmd:a', t0)).toBeCloseTo(2)
    expect(frecencyScore(s, 'cmd:a', t0 + HALF_LIFE_MS)).toBeCloseTo(1)
    expect(frecencyScore(s, 'never', t0)).toBe(0)
  })
  it('boost is monotonic, capped and zero for unknown keys', () => {
    let s: FrecencyStore = {}
    let prev = 0
    for (let i = 0; i < 50; i++) { s = bumpFrecency(s, 'k', t0); const b = frecencyBoost(s, 'k', t0); expect(b).toBeGreaterThanOrEqual(prev); prev = b }
    expect(prev).toBeLessThanOrEqual(45)
    expect(frecencyBoost(s, 'other', t0)).toBe(0)
  })
  it('prunes to the strongest entries', () => {
    let s: FrecencyStore = {}
    for (let i = 0; i < MAX_ENTRIES + 20; i++) s = bumpFrecency(s, `k${i}`, t0 + i)
    s = bumpFrecency(s, 'hot', t0 + 500); s = bumpFrecency(s, 'hot', t0 + 500)
    expect(Object.keys(s).length).toBeLessThanOrEqual(MAX_ENTRIES)
    expect(s['hot']).toBeDefined()
  })
})

describe('ranking', () => {
  it('a habit lifts a weaker match above a stronger one, but not above an exact-prefix win', () => {
    let store: FrecencyStore = {}
    for (let i = 0; i < 6; i++) store = bumpFrecency(store, 'cmd:weak', Date.now())
    const strong = blendScore('arch', 'Archive conversation', undefined, 'cmd:strong', store)
    const habitual = blendScore('arch', 'Go to All Mail', ['archive'], 'cmd:weak', store)
    expect(scoreMatch('arch', 'Go to All Mail', ['archive'])).toBeLessThan(scoreMatch('arch', 'Archive conversation'))
    expect(habitual).toBeGreaterThan(scoreMatch('arch', 'Go to All Mail', ['archive']))
    expect(strong).toBeGreaterThan(0)
    expect(blendScore('zzz', 'Archive', undefined, 'cmd:weak', store)).toBe(0)
  })
  it('contextual Actions lead; others by best score, ties by fixed order', () => {
    const g = orderGroups([
      { group: 'Threads' as const, best: 60 }, { group: 'People' as const, best: 100 },
      { group: 'Actions' as const, best: 10 }, { group: 'Commands' as const, best: 60 }
    ])
    expect(g.map((x) => x.group)).toEqual(['Actions', 'People', 'Commands', 'Threads'])
  })
  it('rankScored is stable for ties', () => {
    expect(rankScored([{ item: 'a', score: 1 }, { item: 'b', score: 2 }, { item: 'c', score: 1 }])).toEqual(['b', 'a', 'c'])
  })
  it('recognises typed addresses', () => {
    expect(looksLikeEmail('a@b.co')).toBe(true)
    expect(looksLikeEmail('a@b')).toBe(false)
    expect(looksLikeEmail('a b@c.io')).toBe(false)
  })
})

describe('sender card copy', () => {
  const now = new Date(2026, 8, 24, 12).getTime() // Thu 24 Sep 2026
  it('labels recency', () => {
    expect(lastSeenLabel(now - 3600_000, now)).toBe('today')
    expect(lastSeenLabel(new Date(2026, 8, 23, 9).getTime(), now)).toBe('yesterday')
    expect(lastSeenLabel(new Date(2026, 8, 22, 9).getTime(), now)).toBe('last Tue')
    expect(lastSeenLabel(new Date(2026, 5, 3, 9).getTime(), now)).toBe('Jun 3')
    expect(lastSeenLabel(new Date(2024, 5, 3, 9).getTime(), now)).toBe('Jun 3, 2024')
    expect(lastSeenLabel(0, now)).toBe('')
  })
  it('builds the summary line', () => {
    expect(conversationsLine(12, new Date(2026, 8, 22, 9).getTime(), now)).toBe('12 conversations · last Tue')
    expect(conversationsLine(1, now - 1000, now)).toBe('1 conversation · today')
    expect(conversationsLine(0, 0, now)).toBe('No conversations yet')
  })
})

describe('which-key', () => {
  it('drops a shared "Go to" verb and keeps table order', () => {
    const out = tidyOptions([{ keys: 't', label: 'Go to Sent' }, { keys: 'i', label: 'Go to Inbox' }, { keys: 'a', label: 'Go to All Mail' }])
    expect(out).toEqual([{ keys: 't', label: 'Sent' }, { keys: 'i', label: 'Inbox' }, { keys: 'a', label: 'All Mail' }])
  })
  it('leaves mixed labels alone', () => {
    expect(tidyOptions([{ keys: 'x', label: 'Archive' }, { keys: 'y', label: 'Go to Sent' }]).map((o) => o.label)).toEqual(['Archive', 'Go to Sent'])
  })
})

describe('shortcuts sheet is generic over registered shortcuts', () => {
  const table: ShortcutDef[] = [
    { id: 'a', label: 'Copy verification code', section: 'Threads', keys: ['shift+c'], keywords: ['otp'] },
    { id: 'b', label: 'Sender info', section: 'Messages', keys: ['i'] }
  ]
  it('finds a newly registered shortcut by label, keyword or key', () => {
    expect(groupShortcuts('otp', table).flatMap((g) => g.items.map((i) => i.id))).toEqual(['a'])
    expect(groupShortcuts('sender', table).flatMap((g) => g.items.map((i) => i.id))).toEqual(['b'])
    expect(groupShortcuts('', table).flatMap((g) => g.items).length).toBe(2)
  })
})
