import { describe, expect, it, beforeEach } from 'vitest'
import { openDb } from '../../src/main/db/db'
import { Repo } from '../../src/main/db/repo'
import { buildMockMailbox } from '../../src/main/providers/mock/fixtures'
import type { Account, ThreadFilter } from '../../src/shared/types'
import {
  compileCondition, compileConditions, describeCondition, isActive, mergeFilters, newCondition, parseDay, resolveRecent,
  type FilterCondition
} from '../../src/shared/filters'

let repo: Repo
const acct = (id: string): Account => ({ id, provider: 'mock', email: `${id}@x.io`, name: id, color: '#000', createdAt: 1, syncCursor: null, lastSyncAt: null, status: 'ok' })
const list = (f: ThreadFilter) => repo.listThreads({ filter: { role: 'inbox', ...f }, limit: 500 }).threads
const c = (over: Partial<FilterCondition> & Pick<FilterCondition, 'prop' | 'op'>): FilterCondition => ({ id: 'x', ...over })

beforeEach(() => {
  repo = new Repo(openDb(':memory:'))
  for (const [id, flavor] of [['a', 'personal'], ['b', 'work']] as const) {
    repo.upsertAccount(acct(id))
    const box = buildMockMailbox(id, `${id}@x.io`, id, flavor)
    repo.replaceLabels(id, box.labels)
    for (const t of box.threads) repo.upsertNormalized(t)
  }
})

describe('buildWhere: new criteria', () => {
  it('read / not-starred / starred', () => {
    const all = list({}).length
    const unread = list({ unread: true }), read = list({ unread: false })
    expect(unread.length + read.length).toBe(all)
    expect(unread.every((t) => t.unread)).toBe(true)
    const starred = list({ starred: true }), notStarred = list({ starred: false })
    expect(starred.length).toBeGreaterThan(0)
    expect(starred.length + notStarred.length).toBe(all)
    expect(notStarred.some((t) => t.starred)).toBe(false)
  })

  it('attachment presence, type and size', () => {
    const with_ = list({ hasAttachment: true }), without = list({ hasAttachment: false })
    expect(with_.length).toBeGreaterThan(0)
    expect(with_.length + without.length).toBe(list({}).length)
    const pdf = list({ attachmentKinds: ['pdf'] })
    expect(pdf.length).toBeGreaterThan(0)
    expect(pdf.every((t) => t.hasAttachments)).toBe(true)
    expect(list({ attachmentKinds: ['archive'] })).toHaveLength(0)
    expect(list({ minAttachmentSize: 50 * 1024 * 1024 })).toHaveLength(0)
    expect(list({ minAttachmentSize: 50_000 }).length).toBeGreaterThanOrEqual(pdf.length)
  })

  it('newsletter (List-Unsubscribe) and its negation partition the set', () => {
    const news = list({ hasUnsubscribe: true }), rest = list({ hasUnsubscribe: false })
    expect(news.length).toBeGreaterThan(0)
    expect(news.length + rest.length).toBe(list({}).length)
  })

  it('calendar invite', () => {
    const inv = list({ hasInvite: true })
    expect(inv.some((t) => t.subject.startsWith('Invitation'))).toBe(true)
    expect(inv.length + list({ hasInvite: false }).length).toBe(list({}).length)
  })

  it('thread size', () => {
    expect(list({ minMessages: 2 }).every((t) => t.messageCount >= 2)).toBe(true)
    expect(list({ minMessages: 2 }).length).toBeGreaterThan(0)
    const single = list({ maxMessages: 1 })
    expect(single.every((t) => t.messageCount === 1)).toBe(true)
    expect(single.length + list({ minMessages: 2 }).length).toBe(list({}).length)
  })

  it('date range: after / before / between', () => {
    const now = Date.now()
    const recent = list({ after: now - 24 * 3600_000 })
    expect(recent.every((t) => t.lastMessageAt >= now - 24 * 3600_000)).toBe(true)
    expect(list({ recent: '7d' }).every((t) => t.lastMessageAt >= now - 7 * 86400_000 - 1000)).toBe(true)
    const old = list({ before: now - 24 * 3600_000 })
    expect(recent.length + old.length).toBe(list({}).length)
    expect(list({ after: now - 3 * 86400_000, before: now - 86400_000 }).every((t) => t.lastMessageAt < now - 86400_000)).toBe(true)
  })

  it('addressed to me vs only Cc\'d', () => {
    const to = list({ addressedTo: 'to' })
    expect(to.length).toBeGreaterThan(0)
    // Nobody in the fixtures Cc's me, so "only Cc'd" is empty and never a superset of "to".
    expect(list({ addressedTo: 'cc' })).toHaveLength(0)
  })

  it('reply status keys off the latest non-draft message', () => {
    const mine = repo.listThreads({ filter: { role: 'sent', lastFrom: 'me' }, limit: 100 }).threads
    expect(mine.length).toBeGreaterThan(0)
    const theirs = list({ lastFrom: 'them' }), awaiting = list({ lastFrom: 'me' })
    expect(theirs.length + awaiting.length).toBe(list({}).length)
    expect(theirs.length).toBeGreaterThan(0)
  })

  it('reminders / snooze', () => {
    const t = list({})[0]
    repo.applyLocal([t.id], { type: 'remind', at: Date.now() + 3600_000 })
    expect(list({ reminderState: 'reminder' }).map((x) => x.id)).toEqual([t.id])
    expect(list({ reminderState: 'none' }).some((x) => x.id === t.id)).toBe(false)
    repo.applyLocal([t.id], { type: 'remind', at: null })
    const u = list({})[1]
    repo.applyLocal([u.id], { type: 'snooze', until: Date.now() + 3600_000 })
    // Snoozed threads are hidden by default but shown by the Reminder filter (in any mailbox).
    expect(list({}).some((x) => x.id === u.id)).toBe(false)
    expect(repo.listThreads({ filter: { reminderState: 'snoozed' } }).threads.map((x) => x.id)).toEqual([u.id])
    expect(repo.listThreads({ filter: { reminderState: 'any' } }).threads.map((x) => x.id)).toContain(u.id)
  })

  it('label groups AND across groups, OR within', () => {
    const labels = repo.listLabels().filter((l) => l.kind === 'user' && l.accountId === 'b')
    expect(labels.length).toBeGreaterThan(1)
    const [l1, l2] = labels
    const either = list({ labelGroups: [[l1.id, l2.id]] })
    const one = list({ labelGroups: [[l1.id]] })
    const both = list({ labelGroups: [[l1.id], [l2.id]] })
    expect(either.length).toBeGreaterThanOrEqual(one.length)
    expect(both.length).toBeLessThanOrEqual(one.length)
    expect(one.every((t) => t.labelIds.includes(l1.id))).toBe(true)
  })

  it('subjectAll ANDs words; from supports domain', () => {
    expect(list({ subjectAll: ['invoice'] }).length).toBeGreaterThan(0)
    expect(list({ subjectAll: ['invoice', 'zzzz-nope'] })).toHaveLength(0)
    expect(list({ from: ['@studionova.example'] }).length).toBeGreaterThan(0)
    expect(list({ from: ['@studionova.example', 'nobody'] })).toHaveLength(0)
  })

  it('combines several criteria with AND, and old view filters still work', () => {
    const legacy: ThreadFilter = { role: 'inbox', unread: true, hasAttachment: true, from: ['a'], labelIds: [] }
    expect(() => repo.listThreads({ filter: legacy })).not.toThrow()
    const both = list({ unread: true, hasAttachment: true })
    expect(both.every((t) => t.unread && t.hasAttachments)).toBe(true)
  })
})

describe('filters model', () => {
  const NOW = new Date(2026, 5, 15, 14, 30).getTime()

  it('date presets and custom bounds', () => {
    expect(compileCondition(c({ prop: 'date', op: 'within', value: '7d' }), NOW)).toEqual({ recent: '7d' })
    expect(resolveRecent('today', NOW)).toBe(new Date(2026, 5, 15).getTime())
    expect(resolveRecent('7d', NOW)).toBe(NOW - 7 * 86400_000)
    expect(resolveRecent('year', NOW)).toBe(new Date(2026, 0, 1).getTime())
    const between = compileCondition(c({ prop: 'date', op: 'between', from: '2026-03-01', to: '2026-03-31' }), NOW)
    expect(between.after).toBe(parseDay('2026-03-01'))
    expect(between.before).toBe(parseDay('2026-03-31')! + 86400_000 - 1)
    expect(compileCondition(c({ prop: 'date', op: 'before', to: '2026-03-05' }), NOW).before).toBe(parseDay('2026-03-05')! - 1)
    expect(compileCondition(c({ prop: 'date', op: 'after', from: '2026-03-05' }), NOW).after).toBe(parseDay('2026-03-06')!)
  })

  it('incomplete conditions are inactive and compile to nothing', () => {
    for (const cond of [c({ prop: 'from', op: 'contains', value: '  ' }), c({ prop: 'label', op: 'any', values: [] }), c({ prop: 'date', op: 'between' }), c({ prop: 'attachment', op: 'type', values: [] })]) {
      expect(isActive(cond)).toBe(false)
      expect(compileCondition(cond, NOW)).toEqual({})
    }
  })

  it('compiles each property', () => {
    expect(compileCondition(newCondition('read', 'x'))).toEqual({ unread: true })
    expect(compileCondition(c({ prop: 'read', op: 'is', value: 'read' }))).toEqual({ unread: false })
    expect(compileCondition(c({ prop: 'from', op: 'domain', value: 'acme.example' }))).toEqual({ from: ['@acme.example'] })
    expect(compileCondition(c({ prop: 'attachment', op: 'larger', n: 5 }))).toEqual({ hasAttachment: true, minAttachmentSize: 5 * 1024 * 1024 })
    expect(compileCondition(c({ prop: 'size', op: 'single' }))).toEqual({ maxMessages: 1 })
    expect(compileCondition(c({ prop: 'reply', op: 'is', value: 'needs' }))).toEqual({ lastFrom: 'them' })
    expect(compileCondition(c({ prop: 'newsletter', op: 'is', value: 'no' }))).toEqual({ hasUnsubscribe: false })
  })

  it('merges with the nav filter: bounds tighten, arrays accumulate, accounts intersect', () => {
    const merged = mergeFilters(
      { accountIds: ['a'], labelIds: ['L1'], after: 100, from: ['x'] },
      compileConditions([
        c({ prop: 'label', op: 'any', values: ['L2', 'L3'] }), c({ prop: 'from', op: 'contains', value: 'y' }),
        c({ prop: 'account', op: 'is', values: ['a', 'b'] })
      ], NOW)
    )
    expect(merged.labelIds).toEqual(['L1'])
    expect(merged.labelGroups).toEqual([['L2', 'L3']])
    expect(merged.from).toEqual(['x', 'y'])
    expect(merged.accountIds).toEqual(['a'])
    expect(mergeFilters({ after: 100, before: 900 }, { after: 50, before: 500 })).toMatchObject({ after: 100, before: 500 })
    expect(mergeFilters({ accountIds: ['a'] }, { accountIds: ['b'] }).accountIds).not.toContain('a')
  })

  it('describes a chip as property / operator / value', () => {
    const ctx = { labelName: (id: string) => `L-${id}`, accountName: (id: string) => id }
    expect(describeCondition(c({ prop: 'date', op: 'within', value: '7d' }), ctx)).toEqual(['Date', 'is within', 'past 7 days'])
    expect(describeCondition(c({ prop: 'from', op: 'contains', value: 'lea' }), ctx)).toEqual(['From', 'is', 'lea'])
    expect(describeCondition(c({ prop: 'label', op: 'any', values: ['1', '2', '3'] }), ctx)[2]).toBe('L-1, L-2 +1')
  })
})
