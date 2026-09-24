import { describe, expect, it, beforeEach } from 'vitest'
import { openDb } from '../../src/main/db/db'
import { Repo } from '../../src/main/db/repo'
import { buildMockMailbox } from '../../src/main/providers/mock/fixtures'
import type { Account } from '../../src/shared/types'

let repo: Repo
const acct = (id: string): Account => ({ id, provider: 'mock', email: `${id}@x.io`, name: id, color: '#000', createdAt: 1, syncCursor: null, lastSyncAt: null, status: 'ok' })

beforeEach(() => {
  repo = new Repo(openDb(':memory:'))
  repo.upsertAccount(acct('a'))
  const box = buildMockMailbox('a', 'a@x.io', 'a', 'personal')
  repo.replaceLabels('a', box.labels)
  for (const t of box.threads) repo.upsertNormalized(t)
})

describe('people (local, derived from thread participants)', () => {
  it('finds people by name or email, never listing your own address', () => {
    const all = repo.searchPeople('', 500)
    expect(all.length).toBeGreaterThan(3)
    expect(all.some((p) => p.email === 'a@x.io')).toBe(false)
    const first = all[0]
    expect(repo.searchPeople(first.email.split('@')[0]).some((p) => p.email === first.email)).toBe(true)
    if (first.name) expect(repo.searchPeople(first.name.slice(0, 3).toUpperCase()).some((p) => p.email === first.email)).toBe(true)
  })
  it('orders by conversation count', () => {
    const all = repo.searchPeople('', 500)
    for (let i = 1; i < all.length; i++) expect(all[i - 1].threadCount).toBeGreaterThanOrEqual(all[i].threadCount)
  })
  it('personInfo returns up to 3 newest threads that include that address', () => {
    const p = repo.searchPeople('', 500)[0]
    const info = repo.personInfo(p.email.toUpperCase())
    expect(info.email).toBe(p.email)
    expect(info.threadCount).toBeGreaterThan(0)
    expect(info.recent.length).toBeGreaterThan(0)
    expect(info.recent.length).toBeLessThanOrEqual(3)
    for (const t of info.recent) expect(t.participants.some((x) => x.email.toLowerCase() === p.email)).toBe(true)
    for (let i = 1; i < info.recent.length; i++) expect(info.recent[i - 1].lastMessageAt).toBeGreaterThanOrEqual(info.recent[i].lastMessageAt)
  })
  it('unknown address yields zeros', () => {
    const info = repo.personInfo('nobody@nowhere.test')
    expect(info.threadCount).toBe(0)
    expect(info.recent).toEqual([])
  })
  it('LIKE wildcards in the query are literal', () => {
    expect(repo.searchPeople('%')).toEqual([])
  })
})
