import { describe, expect, it } from 'vitest'
import type { Label, Thread } from '../../src/shared/types'
import {
  emptyCopy, flatten, groupThreads, offsetsOf, rangeIds,
  rowLabels, scrollOffsetFor, senderText, unionIds, windowRange, WINDOW_THRESHOLD
} from '../../src/renderer/features/threadlist/lib'

/**
 * Anchored to midday *today*: `groupLabel` delegates "Today"/"Yesterday" to date-fns' isToday /
 * isYesterday, which compare against the real clock and ignore the injected `now`. A fixed
 * calendar date would therefore start failing the day after it was written.
 */
const NOW = new Date().setHours(12, 0, 0, 0)
const D = 86_400_000

const thread = (p: Partial<Thread> & { id: string }): Thread => ({
  accountId: 'a', remoteId: p.id, subject: 'S', snippet: '', lastMessageAt: NOW, messageCount: 1,
  unread: false, starred: false, hasAttachments: false, labelIds: [], participants: [],
  snoozedUntil: null, reminderAt: null, ...p
})

const metrics = { rowH: 40, headerH: 28 }

describe('groupThreads', () => {
  it('buckets by date label, keeping list order', () => {
    const groups = groupThreads([
      thread({ id: '1', lastMessageAt: NOW - 1000 }),
      thread({ id: '2', lastMessageAt: NOW - 2000 }),
      thread({ id: '3', lastMessageAt: NOW - 1 * D }),
      thread({ id: '4', lastMessageAt: NOW - 10 * D })
    ], true, NOW)
    expect(groups.map((g) => [g.label, g.threads.length])).toEqual([
      ['Today', 2], ['Yesterday', 1], ['Previous 30 days', 1]
    ])
  })

  it('returns one unlabelled group when grouping is off, and nothing when empty', () => {
    expect(groupThreads([thread({ id: '1' })], false, NOW)).toEqual([
      { key: 'all', label: '', threads: [thread({ id: '1' })] }
    ])
    expect(groupThreads([], false, NOW)).toEqual([])
    expect(groupThreads([], true, NOW)).toEqual([])
  })
})

describe('windowing', () => {
  const many = Array.from({ length: 400 }, (_, i) => thread({ id: `t${i}`, lastMessageAt: NOW - i * 1000 }))
  const items = flatten(groupThreads(many, true, NOW))
  const offsets = offsetsOf(items, metrics)

  it('flattens headers and rows and measures them', () => {
    expect(items[0]).toMatchObject({ kind: 'header', label: 'Today' })
    expect(offsets[0]).toBe(0)
    expect(offsets[1]).toBe(metrics.headerH)
    expect(offsets[items.length]).toBe(
      items.filter((i) => i.kind === 'header').length * metrics.headerH +
      items.filter((i) => i.kind === 'row').length * metrics.rowH
    )
  })

  it('renders everything below the threshold', () => {
    const few = flatten(groupThreads(many.slice(0, 20), true, NOW))
    expect(few.length).toBeLessThan(WINDOW_THRESHOLD)
    expect(windowRange(few, offsetsOf(few, metrics), 0, 800, metrics))
      .toEqual({ start: 0, end: few.length, padTop: 0, padBottom: 0, header: null })
  })

  it('renders only the visible slice plus overscan, and conserves total height', () => {
    const w = windowRange(items, offsets, 4000, 800, metrics)
    expect(w.start).toBeGreaterThan(0)
    expect(w.end - w.start).toBeLessThan(items.length / 2)
    const rendered = offsets[w.end] - offsets[w.start] + (w.header ? metrics.headerH : 0)
    expect(w.padTop + rendered + w.padBottom).toBe(offsets[items.length])
  })

  it('re-emits the group header when the slice starts inside a group', () => {
    const w = windowRange(items, offsets, 4000, 800, metrics)
    expect(items[w.start].kind).toBe('row')
    expect(w.header).toEqual({ label: 'Today', count: 400 })
    expect(w.padTop).toBe(offsets[w.start] - metrics.headerH)
  })

  it('does not re-emit a header when the slice already starts on one', () => {
    const spread = Array.from({ length: 400 }, (_, i) => thread({ id: `s${i}`, lastMessageAt: NOW - i * 0.4 * D }))
    const spreadItems = flatten(groupThreads(spread, true, NOW))
    const spreadOffsets = offsetsOf(spreadItems, metrics)
    const headerIdx = spreadItems.findIndex((it, i) => i > 0 && it.kind === 'header')
    const w = windowRange(spreadItems, spreadOffsets, spreadOffsets[headerIdx], 800, metrics, 0)
    expect(spreadItems[w.start].kind).toBe('header')
    expect(w.header).toBeNull()
    expect(w.padTop).toBe(spreadOffsets[w.start])
  })

  it('scrolls an item into view only when it is outside the viewport', () => {
    expect(scrollOffsetFor(offsets, 0, metrics.headerH, 0, 800)).toBeNull()
    expect(scrollOffsetFor(offsets, 60, metrics.rowH, 0, 800)).toBe(offsets[60] + metrics.rowH + 8 - 800)
    expect(scrollOffsetFor(offsets, 2, metrics.rowH, 500, 800)).toBe(Math.max(0, offsets[2] - 8))
  })
})

describe('selection', () => {
  const threads = ['1', '2', '3', '4'].map((id) => thread({ id }))

  it('selects an inclusive range in either direction', () => {
    expect(rangeIds(threads, '2', '4')).toEqual(['2', '3', '4'])
    expect(rangeIds(threads, '4', '2')).toEqual(['2', '3', '4'])
  })

  it('falls back to the target alone without a usable anchor', () => {
    expect(rangeIds(threads, null, '3')).toEqual(['3'])
    expect(rangeIds(threads, 'gone', '3')).toEqual(['3'])
    expect(rangeIds(threads, '1', 'gone')).toEqual([])
  })

  it('unions without duplicates, preserving order', () => {
    expect(unionIds(['1', '2'], ['2', '3'])).toEqual(['1', '2', '3'])
  })
})

describe('row text', () => {
  const me = new Set(['me@x.io'])
  const t = (...emails: string[]): Thread =>
    thread({ id: 'x', participants: emails.map((e) => ({ email: e, name: e.split('@')[0] })) })

  it('shows me as "Me" and prefers the other participants', () => {
    expect(senderText(t('me@x.io'), me)).toBe('Me')
    expect(senderText(t('me@x.io', 'lea@x.io'), me)).toBe('lea')
    expect(senderText(t('a@x.io', 'b@x.io', 'c@x.io', 'd@x.io'), me)).toBe('a, b +2')
  })

  it('de-duplicates repeated participants', () => {
    expect(senderText(t('a@x.io', 'a@x.io', 'b@x.io'), me)).toBe('a, b')
  })

  it('keeps only user labels, capped', () => {
    const labels: Label[] = [
      { id: 'a:L1', accountId: 'a', remoteId: 'L1', name: 'Travel', kind: 'user' },
      { id: 'a:INBOX', accountId: 'a', remoteId: 'INBOX', name: 'Inbox', kind: 'system', role: 'inbox' },
      { id: 'a:L2', accountId: 'a', remoteId: 'L2', name: 'Team', kind: 'user' }
    ]
    const th = thread({ id: '1', labelIds: ['a:L1', 'a:INBOX', 'a:L2'] })
    expect(rowLabels(th, labels).map((l) => l.name)).toEqual(['Travel', 'Team'])
    expect(rowLabels(th, labels, 1).map((l) => l.name)).toEqual(['Travel'])
  })
})

describe('emptyCopy', () => {
  it('uses the inbox-zero line for the inbox', () => {
    expect(emptyCopy({ kind: 'role', role: 'inbox' }).title).toBe("You're all caught up.")
  })
  it('names the query for search and the view for views', () => {
    expect(emptyCopy({ kind: 'search', text: 'invoice' }).body).toContain('invoice')
    expect(emptyCopy({ kind: 'view', viewId: 'v' }, 'Unread').body).toContain('Unread')
  })
  it('explains an empty result caused by filter chips', () => {
    expect(emptyCopy({ kind: 'role', role: 'inbox' }, undefined, true).title).toBe('No matches')
  })
})
