import { describe, expect, it, beforeEach } from 'vitest'
import { openDb } from '../../src/main/db/db'
import { Repo } from '../../src/main/db/repo'
import { buildMockMailbox } from '../../src/main/providers/mock/fixtures'
import type { Account } from '../../src/shared/types'

let repo: Repo
const acct = (id: string): Account => ({ id, provider: 'mock', email: `${id}@x.io`, name: id, color: '#000', createdAt: 1, syncCursor: null, lastSyncAt: null, status: 'ok' })

beforeEach(() => {
  repo = new Repo(openDb(':memory:'))
  for (const [id, flavor] of [['a', 'personal'], ['b', 'work']] as const) {
    repo.upsertAccount(acct(id))
    const box = buildMockMailbox(id, `${id}@x.io`, id, flavor)
    repo.replaceLabels(id, box.labels)
    for (const t of box.threads) repo.upsertNormalized(t)
  }
})

describe('repo', () => {
  it('lists inbox threads newest-first and excludes trash/spam/sent-only', () => {
    const { threads } = repo.listThreads({ filter: { role: 'inbox' } })
    expect(threads.length).toBeGreaterThan(10)
    for (let i = 1; i < threads.length; i++) expect(threads[i - 1].lastMessageAt).toBeGreaterThanOrEqual(threads[i].lastMessageAt)
    expect(threads.some((t) => t.subject.includes('free cruise'))).toBe(false) // spam
  })
  it('scopes by account and never merges across accounts', () => {
    const a = repo.listThreads({ filter: { role: 'inbox', accountIds: ['a'] } }).total
    const b = repo.listThreads({ filter: { role: 'inbox', accountIds: ['b'] } }).total
    expect(repo.listThreads({ filter: { role: 'inbox' } }).total).toBe(a + b)
  })
  it('archive removes from inbox but keeps in archive view; undo restores', () => {
    const t = repo.listThreads({ filter: { role: 'inbox' } }).threads[0]
    repo.applyLocal([t.id], { type: 'archive' })
    expect(repo.listThreads({ filter: { role: 'inbox' } }).threads.find((x) => x.id === t.id)).toBeUndefined()
    expect(repo.listThreads({ filter: { role: 'archive' } }).threads.find((x) => x.id === t.id)).toBeDefined()
    repo.applyLocal([t.id], { type: 'unarchive' })
    expect(repo.listThreads({ filter: { role: 'inbox' } }).threads.find((x) => x.id === t.id)).toBeDefined()
  })
  it('snooze hides from inbox until woken', () => {
    const t = repo.listThreads({ filter: { role: 'inbox' } }).threads[0]
    repo.applyLocal([t.id], { type: 'snooze', until: Date.now() + 1000 })
    expect(repo.listThreads({ filter: { role: 'inbox' } }).threads.some((x) => x.id === t.id)).toBe(false)
    expect(repo.listThreads({ filter: { onlySnoozed: true } }).total).toBe(1)
    expect(repo.wakeSnoozed(Date.now() + 5000)).toEqual([t.id])
    expect(repo.listThreads({ filter: { role: 'inbox' } }).threads.find((x) => x.id === t.id)?.unread).toBe(true)
  })
  it('full-text search hits subject and body, prefix matches', () => {
    expect(repo.listThreads({ filter: { text: 'lisb' } }).threads.some((t) => t.subject.includes('Lisbon'))).toBe(true)
    expect(repo.listThreads({ filter: { text: 'kubernetes-not-here' } }).total).toBe(0)
  })
  it('filters by unread, attachment, label, from', () => {
    expect(repo.listThreads({ filter: { role: 'inbox', unread: true } }).threads.every((t) => t.unread)).toBe(true)
    expect(repo.listThreads({ filter: { hasAttachment: true } }).threads.every((t) => t.hasAttachments)).toBe(true)
    const lid = repo.listLabels().find((l) => l.name === 'Newsletters' && l.accountId === 'a')!.id
    expect(repo.listThreads({ filter: { labelIds: [lid] } }).total).toBeGreaterThan(0)
    expect(repo.listThreads({ filter: { from: ['github'] } }).total).toBeGreaterThan(0)
  })
  it('upsert preserves local snooze/reminder', () => {
    const t = repo.listThreads({ filter: { role: 'inbox' } }).threads[0]
    repo.applyLocal([t.id], { type: 'remind', at: 12345 })
    const full = repo.getThread(t.id)!
    repo.upsertNormalized({ thread: full, messages: full.messages })
    expect(repo.getThreadRow(t.id)?.reminderAt).toBe(12345)
  })
  it('counts unread per role', () => {
    expect(repo.counts().unread['all:inbox']).toBeGreaterThan(0)
  })
  it('counts unread for "All Mail" (a thread with several labels is not double-counted)', () => {
    const allUnread = repo.listThreads({ filter: { role: 'all', unread: true } }).total
    expect(allUnread).toBeGreaterThan(0)
    expect(repo.counts().unread['all:all']).toBe(allUnread)
    const aUnread = repo.listThreads({ filter: { role: 'all', unread: true, accountIds: ['a'] } }).total
    expect(repo.counts().unread['a:all']).toBe(aUnread)
  })
  it('upsertAccount round-trips avatarUrl through getAccount', () => {
    repo.upsertAccount({ ...acct('a'), avatarUrl: 'https://i.pravatar.cc/150?img=12' })
    expect(repo.getAccount('a')?.avatarUrl).toBe('https://i.pravatar.cc/150?img=12')
    repo.upsertAccount(acct('a'))
    expect(repo.getAccount('a')?.avatarUrl).toBeUndefined()
  })
  it('settings merge nested oauth', () => {
    repo.setSettings({ oauth: { googleClientId: 'x', googleClientSecret: '', microsoftClientId: '' } })
    expect(repo.getSettings().oauth.googleClientId).toBe('x')
    expect(repo.getSettings().theme).toBe('system')
  })
})
