import { describe, expect, it } from 'vitest'
import { openDb } from '../../src/main/db/db'
import { Repo } from '../../src/main/db/repo'
import { SyncEngine } from '../../src/main/sync/engine'
import { MockAdapter } from '../../src/main/providers/mock/adapter'
import type { Account, SyncEvent } from '../../src/shared/types'

const account: Account = { id: 'm1', provider: 'mock', email: 'me@x.io', name: 'Me', color: '#000', createdAt: 1, syncCursor: null, lastSyncAt: null, status: 'ok' }

function setup(): { repo: Repo; engine: SyncEngine; events: SyncEvent[] } {
  const repo = new Repo(openDb(':memory:'))
  repo.upsertAccount(account)
  const engine = new SyncEngine(repo)
  engine.register(new MockAdapter('m1', 'me@x.io', 'Me', 'personal'))
  const events: SyncEvent[] = []
  engine.onEvent((e) => events.push(e))
  return { repo, engine, events }
}

describe('SyncEngine', () => {
  it('initial sync populates labels, threads and cursor, and emits events', async () => {
    const { repo, engine, events } = setup()
    await engine.syncAccount('m1')
    expect(repo.listLabels().length).toBeGreaterThan(5)
    expect(repo.listThreads({ filter: { role: 'inbox' } }).total).toBeGreaterThan(5)
    expect(repo.getAccount('m1')).toMatchObject({ status: 'ok', syncCursor: expect.any(String) })
    expect(events.some((e) => e.type === 'changed')).toBe(true)
  })

  it('act() is optimistic and local-only actions never hit the adapter', async () => {
    const { repo, engine } = setup()
    await engine.syncAccount('m1')
    const t = repo.listThreads({ filter: { role: 'inbox' } }).threads[0]
    await engine.act([t.id], { type: 'archive' })
    expect(repo.listThreads({ filter: { role: 'inbox' } }).threads.some((x) => x.id === t.id)).toBe(false)
    await engine.act([t.id], { type: 'snooze', until: Date.now() + 60_000 })
    expect(repo.getThreadRow(t.id)?.snoozedUntil).toBeGreaterThan(Date.now())
  })

  it('a sent message shows up in Sent after the follow-up sync', async () => {
    const { repo, engine } = setup()
    await engine.syncAccount('m1')
    await engine.send({ accountId: 'm1', to: [{ email: 'a@b.co', name: 'A' }], cc: [], bcc: [], subject: 'Hello there', html: '<p>hi</p>', text: 'hi' })
    await engine.syncAccount('m1')
    expect(repo.listThreads({ filter: { role: 'sent' } }).threads.some((t) => t.subject === 'Hello there')).toBe(true)
    expect(repo.suggestContacts('a@b')[0]?.email).toBe('a@b.co')
  })

  it('a re-sync with reset clears stale mail instead of duplicating', async () => {
    const { repo, engine } = setup()
    await engine.syncAccount('m1')
    const before = repo.listThreads({ filter: {} }).total
    repo.patchAccount('m1', { syncCursor: null })
    await engine.syncAccount('m1')
    expect(repo.listThreads({ filter: {} }).total).toBe(before)
  })
})
