import { beforeEach, describe, expect, it } from 'vitest'
import { openDb } from '../../src/main/db/db'
import { Repo } from '../../src/main/db/repo'
import { buildMockMailbox } from '../../src/main/providers/mock/fixtures'
import type { Account } from '../../src/shared/types'

let repo: Repo
let box: ReturnType<typeof buildMockMailbox>
const acct: Account = { id: 'a', provider: 'mock', email: 'a@x.io', name: 'a', color: '#000', createdAt: 1, syncCursor: null, lastSyncAt: null, status: 'ok' }

beforeEach(() => {
  repo = new Repo(openDb(':memory:'))
  repo.upsertAccount(acct)
  box = buildMockMailbox('a', 'a@x.io', 'a', 'personal')
  repo.replaceLabels('a', box.labels)
  for (const t of box.threads) repo.upsertNormalized(t)
})

const inboxIds = (): string[] => repo.listThreads({ filter: { role: 'inbox' } }).threads.map((t) => t.id)

describe('mute (local)', () => {
  it('mute leaves the inbox, flags the thread, and unmute brings it back', () => {
    const id = inboxIds()[0]
    repo.applyLocal([id], { type: 'mute' })
    expect(inboxIds()).not.toContain(id)
    expect(repo.getThreadRow(id)?.muted).toBe(true)
    expect(repo.listThreads({ filter: { role: 'archive' } }).threads.find((t) => t.id === id)?.muted).toBe(true)
    repo.applyLocal([id], { type: 'unmute' })
    expect(inboxIds()).toContain(id)
    expect(repo.getThreadRow(id)?.muted).toBeUndefined()
  })

  it('a reply synced later does not resurface a muted conversation in the inbox', () => {
    const id = inboxIds()[0]
    repo.applyLocal([id], { type: 'mute' })
    // The server still says INBOX on the thread (Gmail would after a reply): re-sync it.
    const fresh = box.threads.find((n) => n.thread.id === id)!
    repo.upsertNormalized(fresh)
    expect(inboxIds()).not.toContain(id)
    expect(repo.getThreadRow(id)?.muted).toBe(true)
  })

  it('un-muted threads keep syncing into the inbox as before', () => {
    const id = inboxIds()[0]
    repo.applyLocal([id], { type: 'archive' })
    repo.upsertNormalized(box.threads.find((n) => n.thread.id === id)!)
    expect(inboxIds()).toContain(id)
  })
})
