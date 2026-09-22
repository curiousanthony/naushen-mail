import { describe, expect, it } from 'vitest'
import {
  chipLabel, dedupeAddresses, formatAddress, isValidEmail, parseAddress, parseAddressList,
  shouldCommit, splitAddressList, validateCompose
} from '@/features/compose/recipients'
import {
  daysUntilNextMonday, fromLocalInputValue, scheduleOptions, scheduledToast, toLocalInputValue
} from '@/features/compose/schedule'
import {
  SNIPPETS_KEY, deleteSnippet, findSnippets, fuzzyScore, loadSnippets, upsertSnippet, type SnippetStorage
} from '@/features/compose/snippets'

describe('recipients', () => {
  it('validates addresses pragmatically', () => {
    for (const ok of ['a@b.test', 'ada.lovelace+tag@sub.domain.test', 'x_y@a-b.co.uk']) {
      expect(isValidEmail(ok), ok).toBe(true)
    }
    for (const bad of ['', 'ada', 'ada@', '@b.test', 'a b@c.test', 'a@b', 'a@@b.test', 'a@b..test']) {
      expect(isValidEmail(bad), bad).toBe(false)
    }
  })

  it('parses the shapes people actually paste', () => {
    expect(parseAddress('ada@x.test')).toEqual({ email: 'ada@x.test' })
    expect(parseAddress('Ada Lovelace <ada@x.test>')).toEqual({ name: 'Ada Lovelace', email: 'ada@x.test' })
    expect(parseAddress('"Lovelace, Ada" <ada@x.test>')).toEqual({ name: 'Lovelace, Ada', email: 'ada@x.test' })
    expect(parseAddress('<ada@x.test>')).toEqual({ email: 'ada@x.test' })
    expect(parseAddress('Ada Lovelace ada@x.test')).toEqual({ name: 'Ada Lovelace', email: 'ada@x.test' })
    expect(parseAddress('   ')).toBeNull()
  })

  it('keeps a quoted comma inside one address when splitting', () => {
    expect(splitAddressList('"Lovelace, Ada" <ada@x.test>, bob@x.test'))
      .toEqual(['"Lovelace, Ada" <ada@x.test>', 'bob@x.test'])
  })

  it('splits on commas, semicolons and newlines', () => {
    expect(parseAddressList('a@x.test, b@x.test; c@x.test\nd@x.test').map((a) => a.email))
      .toEqual(['a@x.test', 'b@x.test', 'c@x.test', 'd@x.test'])
  })

  it('drops duplicates case-insensitively, keeping the first', () => {
    expect(dedupeAddresses([{ name: 'Ada', email: 'A@x.test' }, { email: 'a@x.test' }]))
      .toEqual([{ name: 'Ada', email: 'A@x.test' }])
  })

  it('keeps an invalid address as a chip so it can be shown as invalid', () => {
    expect(parseAddressList('not-an-email, ok@x.test').map((a) => a.email)).toEqual(['not-an-email', 'ok@x.test'])
  })

  it('formats chips and header text', () => {
    expect(chipLabel({ name: 'Ada', email: 'a@x.test' })).toBe('Ada')
    expect(chipLabel({ email: 'a@x.test' })).toBe('a@x.test')
    expect(formatAddress({ name: 'Ada', email: 'a@x.test' })).toBe('Ada <a@x.test>')
    expect(formatAddress({ email: 'a@x.test' })).toBe('a@x.test')
  })

  it('commits on separators only', () => {
    expect(shouldCommit('ada@x.test')).toBe(false)
    expect(shouldCommit('ada@x.test,')).toBe(true)
    expect(shouldCommit('a;b')).toBe(true)
  })
})

describe('validateCompose', () => {
  const base = { to: [], cc: [], bcc: [], subject: 'Hi', bodyText: 'Body', attachmentCount: 0 }

  it('requires a recipient', () => {
    expect(validateCompose(base).errors).toEqual(['Add at least one recipient.'])
    expect(validateCompose({ ...base, bcc: [{ email: 'a@x.test' }] }).errors).toEqual([])
  })

  it('reports invalid recipients', () => {
    expect(validateCompose({ ...base, to: [{ email: 'nope' }] }).errors[0]).toContain('nope')
    expect(validateCompose({ ...base, to: [{ email: 'nope' }, { email: 'also bad' }] }).errors[0]).toContain('2 recipients')
  })

  it('warns about an empty subject and an empty body', () => {
    const v = validateCompose({ ...base, to: [{ email: 'a@x.test' }], subject: '  ', bodyText: '' })
    expect(v.errors).toEqual([])
    expect(v.warnings).toContain('This message has no subject.')
    expect(v.warnings).toContain('This message is empty.')
  })

  it('warns when the body promises an attachment and there is none', () => {
    const msg = { ...base, to: [{ email: 'a@x.test' }], bodyText: 'See attached for details' }
    expect(validateCompose(msg).warnings).toContain('You mentioned an attachment but nothing is attached.')
    expect(validateCompose({ ...msg, attachmentCount: 1 }).warnings).toEqual([])
    expect(validateCompose({ ...msg, bodyText: 'I detached the trailer' }).warnings).toEqual([])
  })
})

describe('schedule presets', () => {
  // Tuesday 12 May 2026, 15:30 local.
  const NOW = new Date(2026, 4, 12, 15, 30)

  it('offers tomorrow morning, tomorrow afternoon, next Monday and a custom picker', () => {
    const [m, a, w, c] = scheduleOptions(NOW)
    expect([m.label, a.label, w.label, c.label])
      .toEqual(['Tomorrow morning', 'Tomorrow afternoon', 'Next week', 'Pick date & time'])
    expect(new Date(m.at!).getHours()).toBe(8)
    expect(new Date(m.at!).getDate()).toBe(13)
    expect(new Date(a.at!).getHours()).toBe(13)
    expect(new Date(w.at!).getDay()).toBe(1)
    expect(new Date(w.at!).getDate()).toBe(18)
    expect(c.at).toBeNull()
  })

  it('never schedules in the past', () => {
    for (const day of [10, 11, 12, 13, 14, 15, 16]) {
      const now = new Date(2026, 4, day, 23, 59)
      for (const o of scheduleOptions(now)) if (o.at) expect(o.at, `${day}/${o.id}`).toBeGreaterThan(now.getTime())
    }
  })

  it('never calls today "next Monday"', () => {
    expect(daysUntilNextMonday(new Date(2026, 4, 11))).toBe(7) // a Monday
    expect(daysUntilNextMonday(new Date(2026, 4, 10))).toBe(1) // a Sunday
    expect(daysUntilNextMonday(new Date(2026, 4, 12))).toBe(6) // a Tuesday
  })

  it('labels a far date with the month', () => {
    const opts = scheduleOptions(new Date(2026, 4, 12, 15, 30))
    expect(opts[0].detail).toBe('Wed, 08:00')
    expect(opts[2].detail).toBe('Mon, 08:00')
  })

  it('round-trips the datetime-local input value', () => {
    const d = new Date(2026, 4, 12, 8, 5)
    expect(toLocalInputValue(d)).toBe('2026-05-12T08:05')
    expect(fromLocalInputValue('2026-05-12T08:05', new Date(2026, 4, 11))).toBe(d.getTime())
  })

  it('rejects an empty, malformed or past custom time', () => {
    expect(fromLocalInputValue('', NOW)).toBeNull()
    expect(fromLocalInputValue('tomorrow', NOW)).toBeNull()
    expect(fromLocalInputValue('2020-01-01T08:00', NOW)).toBeNull()
  })

  it('formats the scheduled toast', () => {
    expect(scheduledToast(new Date(2026, 4, 13, 8, 0).getTime(), NOW)).toBe('Scheduled for Wed, 08:00')
  })
})

describe('snippets', () => {
  const store = (): SnippetStorage => {
    const map = new Map<string, string>()
    return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) }
  }
  const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

  it('creates, lists and deletes', () => {
    const s = store()
    expect(loadSnippets(s)).toEqual([])
    const one = upsertSnippet({ name: 'Intro', doc: doc('Hello!') }, s)
    expect(one).toHaveLength(1)
    expect(one[0].name).toBe('Intro')
    expect(loadSnippets(s)[0].doc).toEqual(doc('Hello!'))
    expect(deleteSnippet(one[0].id, s)).toEqual([])
  })

  it('replaces a snippet with the same name instead of duplicating it', () => {
    const s = store()
    upsertSnippet({ name: 'Intro', doc: doc('v1') }, s)
    const list = upsertSnippet({ name: ' intro ', doc: doc('v2') }, s)
    expect(list).toHaveLength(1)
    expect(list[0].doc).toEqual(doc('v2'))
  })

  it('keeps the list sorted and survives corrupt storage', () => {
    const s = store()
    upsertSnippet({ name: 'Zulu', doc: doc('z') }, s)
    upsertSnippet({ name: 'Alpha', doc: doc('a') }, s)
    expect(loadSnippets(s).map((x) => x.name)).toEqual(['Alpha', 'Zulu'])
    s.setItem(SNIPPETS_KEY, '{not json')
    expect(loadSnippets(s)).toEqual([])
    s.setItem(SNIPPETS_KEY, '{"a":1}')
    expect(loadSnippets(s)).toEqual([])
  })

  it('names an untitled snippet', () => {
    expect(upsertSnippet({ name: '  ', doc: doc('x') }, store())[0].name).toBe('Untitled snippet')
  })

  it('shares its storage key and row shape with the Settings snippet list', () => {
    const s = store()
    upsertSnippet({ name: 'Intro', doc: doc('Hello!') }, s)
    const row = JSON.parse(s.getItem(SNIPPETS_KEY)!)[0]
    // Settings' loader only requires string `id` + `title`, and reads `html` for its editor.
    expect(row).toMatchObject({ id: expect.any(String), title: 'Intro', html: expect.stringContaining('Hello!') })
  })

  it('reads a snippet written by Settings (no `doc`), synthesizing one from its HTML', () => {
    const s = store()
    s.setItem(SNIPPETS_KEY, JSON.stringify([{ id: 'x1', title: 'From settings', html: '<p>Plain body</p>' }]))
    const [snip] = loadSnippets(s)
    expect(snip.name).toBe('From settings')
    expect(snip.doc.type).toBe('doc')
    expect(JSON.stringify(snip.doc)).toContain('Plain body')
  })

  it('filters fuzzily, best match first', () => {
    const s = store()
    upsertSnippet({ name: 'Meeting follow-up', doc: doc('a') }, s)
    upsertSnippet({ name: 'Meeting notes', doc: doc('b') }, s)
    upsertSnippet({ name: 'Out of office', doc: doc('c') }, s)
    const list = loadSnippets(s)
    // Both are prefix matches, so the shorter name wins.
    expect(findSnippets(list, 'meet').map((x) => x.name)).toEqual(['Meeting notes', 'Meeting follow-up'])
    // Subsequence matching: "ooo" still finds "Out of office".
    expect(findSnippets(list, 'ooo').map((x) => x.name)).toEqual(['Out of office'])
    expect(findSnippets(list, 'zzz')).toEqual([])
    expect(findSnippets(list, 'office').map((x) => x.name)).toEqual(['Out of office'])
    expect(findSnippets(list, '')).toHaveLength(3)
  })

  it('scores exact, prefix and subsequence matches in order', () => {
    expect(fuzzyScore('quote', 'quote')).toBeGreaterThan(fuzzyScore('quote block', 'quote'))
    expect(fuzzyScore('quote block', 'quote')).toBeGreaterThan(fuzzyScore('block quote', 'quote'))
    expect(fuzzyScore('bulleted list', 'xyz')).toBe(0)
    expect(fuzzyScore('anything', '')).toBe(1)
  })
})
