import { describe, expect, it } from 'vitest'
import { openDb } from '../../src/main/db/db'
import { Repo } from '../../src/main/db/repo'
import { SyncEngine } from '../../src/main/sync/engine'
import { FollowUps } from '../../src/main/sync/followups'
import { MockAdapter } from '../../src/main/providers/mock/adapter'
import type { NormalizedThread } from '../../src/main/providers/types'
import type { Account, SyncEvent } from '../../src/shared/types'

const account: Account = { id: 'm1', provider: 'mock', email: 'me@x.io', name: 'Me', color: '#000', createdAt: 1, syncCursor: null, lastSyncAt: null, status: 'ok' }
const DAY = 86_400_000

async function setup(): Promise<{ repo: Repo; engine: SyncEngine; adapter: MockAdapter; sent: string; events: SyncEvent[] }> {
  const repo = new Repo(openDb(':memory:'))
  repo.upsertAccount(account)
  const engine = new SyncEngine(repo)
  const adapter = new MockAdapter('m1', 'me@x.io', 'Me', 'personal')
  engine.register(adapter)
  await engine.syncAccount('m1')
  const events: SyncEvent[] = []
  engine.onEvent((e) => events.push(e))
  const sent = repo.listThreads({ filter: { role: 'sent' } }).threads[0]
  return { repo, engine, adapter, sent: sent.id, events }
}

/** Simulate the provider delivering `from`'s message into an existing thread. */
async function deliverReply(repo: Repo, adapter: MockAdapter, threadId: string, from: string, at: number): Promise<void> {
  const t = repo.getThreadRow(threadId)!
  const n: NormalizedThread = await adapter.fetchThread(t.remoteId)
  const last = n.messages[n.messages.length - 1]
  n.messages = [...n.messages, { ...last, id: `${threadId}:reply:${at}`, remoteId: `reply-${at}`, from: { email: from, name: 'Them' }, date: at, unread: true }]
  n.thread = { ...n.thread, lastMessageAt: at, messageCount: n.messages.length, unread: true }
  repo.upsertNormalized(n)
}

describe('follow up if no reply', () => {
  it('set: arms the deadline and records the baseline; nothing fires early', async () => {
    const { repo, engine, sent } = await setup()
    const at = Date.now() + 3 * DAY
    await engine.act([sent], { type: 'remind', at })
    expect(repo.getThreadRow(sent)).toMatchObject({ reminderAt: at, followUpFiredAt: null })
    engine.settleFollowUps()
    expect(repo.getThreadRow(sent)).toMatchObject({ reminderAt: at, followUpFiredAt: null })
  })

  it('an inbound reply before the deadline silently clears it', async () => {
    const { repo, engine, adapter, sent } = await setup()
    await engine.act([sent], { type: 'remind', at: Date.now() + 3 * DAY })
    await deliverReply(repo, adapter, sent, 'them@y.io', Date.now() + 1000)
    engine.settleFollowUps()
    expect(repo.getThreadRow(sent)).toMatchObject({ reminderAt: null, followUpFiredAt: null })
  })

  it('my own follow-up message does not count as a reply', async () => {
    const { repo, engine, adapter, sent } = await setup()
    await engine.act([sent], { type: 'remind', at: Date.now() + 3 * DAY })
    await deliverReply(repo, adapter, sent, 'ME@x.io', Date.now() + 1000)
    engine.settleFollowUps()
    expect(repo.getThreadRow(sent)!.reminderAt).not.toBeNull()
  })

  it('a reply older than the arming time is ignored', async () => {
    const { repo, engine, adapter, sent } = await setup()
    await deliverReply(repo, adapter, sent, 'them@y.io', Date.now() - DAY)
    await engine.act([sent], { type: 'remind', at: Date.now() + DAY })
    engine.settleFollowUps()
    expect(repo.getThreadRow(sent)!.reminderAt).not.toBeNull()
  })

  it('the deadline fires: unread, "No reply yet", top of the Inbox, counted', async () => {
    const { repo, engine, sent, events } = await setup()
    const before = repo.counts().unread['all:inbox'] ?? 0
    expect(repo.listThreads({ filter: { role: 'inbox' } }).threads.some((t) => t.id === sent)).toBe(false)
    await engine.act([sent], { type: 'remind', at: Date.now() + 5 })
    events.length = 0
    await new Promise((r) => setTimeout(r, 15))
    engine.settleFollowUps()
    const t = repo.getThreadRow(sent)!
    expect(t).toMatchObject({ reminderAt: null, unread: true })
    expect(t.followUpFiredAt).toBeGreaterThan(0)
    // Resurfaced to the top even though its last message is old.
    expect(repo.listThreads({ filter: { role: 'inbox' } }).threads[0].id).toBe(sent)
    expect(repo.counts().unread['all:inbox']).toBe(before + 1)
    expect(events).toContainEqual({ type: 'changed', threadIds: [sent] })
    // Idempotent: a second settle changes nothing.
    events.length = 0
    engine.settleFollowUps()
    expect(events).toHaveLength(0)
  })

  it('an already-due deadline fires immediately when set', async () => {
    const { repo, engine, sent } = await setup()
    await engine.act([sent], { type: 'remind', at: Date.now() - 1000 })
    expect(repo.getThreadRow(sent)!.followUpFiredAt).toBeGreaterThan(0)
  })

  it('cancel before the deadline, and dismissing after it fired', async () => {
    const { repo, engine, sent } = await setup()
    await engine.act([sent], { type: 'remind', at: Date.now() + DAY })
    await engine.act([sent], { type: 'remind', at: null })
    expect(repo.getThreadRow(sent)).toMatchObject({ reminderAt: null, followUpFiredAt: null })
    await engine.act([sent], { type: 'remind', at: Date.now() - 1 })
    expect(repo.getThreadRow(sent)!.followUpFiredAt).not.toBeNull()
    await engine.act([sent], { type: 'remind', at: null })
    expect(repo.getThreadRow(sent)!.followUpFiredAt).toBeNull()
    expect(repo.listThreads({ filter: { role: 'inbox' } }).threads.some((t) => t.id === sent)).toBe(false)
  })

  it('archiving a fired follow-up sends it away again', async () => {
    const { repo, engine, sent } = await setup()
    await engine.act([sent], { type: 'remind', at: Date.now() - 1 })
    await engine.act([sent], { type: 'archive' })
    expect(repo.getThreadRow(sent)!.followUpFiredAt).toBeNull()
    expect(repo.listThreads({ filter: { role: 'inbox' } }).threads.some((t) => t.id === sent)).toBe(false)
  })

  it('a late reply clears a fired follow-up', async () => {
    const { repo, engine, adapter, sent } = await setup()
    await engine.act([sent], { type: 'remind', at: Date.now() - 1 })
    await deliverReply(repo, adapter, sent, 'them@y.io', Date.now() + 1000)
    engine.settleFollowUps()
    expect(repo.getThreadRow(sent)!.followUpFiredAt).toBeNull()
  })

  it('app closed across the deadline: the next launch fires it', async () => {
    const { repo, engine, sent } = await setup()
    const at = Date.now() + 3 * DAY
    await engine.act([sent], { type: 'remind', at })
    // "Quit", then relaunch four days later: a brand new service over the same database.
    const relaunch = new FollowUps(repo, () => at + DAY)
    expect(relaunch.settle().fired).toEqual([sent])
    expect(repo.getThreadRow(sent)!.followUpFiredAt).toBe(at + DAY)
  })

  it('app closed across the deadline but the reply arrived meanwhile: no false alarm', async () => {
    const { repo, engine, adapter, sent } = await setup()
    const at = Date.now() + 3 * DAY
    await engine.act([sent], { type: 'remind', at })
    await deliverReply(repo, adapter, sent, 'them@y.io', at - DAY) // synced on relaunch
    const relaunch = new FollowUps(repo, () => at + DAY)
    expect(relaunch.settle()).toEqual({ fired: [], cleared: [sent] })
  })

  it('a provider sync keeps the fired thread unread', async () => {
    const { repo, engine, adapter, sent } = await setup()
    await engine.act([sent], { type: 'remind', at: Date.now() - 1 })
    repo.upsertNormalized(await adapter.fetchThread(repo.getThreadRow(sent)!.remoteId)) // provider still says "read"
    expect(repo.getThreadRow(sent)).toMatchObject({ unread: true })
    expect(repo.getThreadRow(sent)!.followUpFiredAt).not.toBeNull()
  })

  it('legacy armed rows (no baseline) start counting from now instead of firing retroactively', async () => {
    const { repo, sent } = await setup()
    repo.db.prepare('UPDATE threads SET reminder_at = ?, followup_set_at = NULL WHERE id = ?').run(Date.now() + DAY, sent)
    expect(new FollowUps(repo).settle()).toEqual({ fired: [], cleared: [] })
    expect(repo.getThreadRow(sent)!.reminderAt).not.toBeNull()
  })
})

describe('follow-up armed at send time', () => {
  it('a reply arms it on the replied-to thread, counted from the actual send', async () => {
    const { repo, engine } = await setup()
    const inbox = repo.listThreads({ filter: { role: 'inbox' } }).threads[0]
    const t0 = Date.now()
    await engine.send({
      accountId: 'm1', to: [{ email: 'a@b.co' }], cc: [], bcc: [], subject: 'Re: x', html: '<p>hi</p>', text: 'hi',
      inReplyTo: { threadId: inbox.id, messageId: 'm', mode: 'reply' }, followUpDays: 3
    })
    const at = repo.getThreadRow(inbox.id)!.reminderAt!
    expect(at).toBeGreaterThanOrEqual(t0 + 3 * DAY)
    expect(at).toBeLessThan(Date.now() + 3 * DAY + 1000)
  })

  it('a new message is matched to its thread once the provider reports it', async () => {
    const { repo, engine } = await setup()
    await engine.send({ accountId: 'm1', to: [{ email: 'a@b.co' }], cc: [], bcc: [], subject: 'Brand new thing', html: '<p>hi</p>', text: 'hi', followUpDays: 2 })
    await engine.syncAccount('m1')
    const t = repo.listThreads({ filter: { role: 'sent' } }).threads.find((x) => x.subject === 'Brand new thing')!
    expect(t.reminderAt).toBeGreaterThan(Date.now() + DAY)
  })

  it('a forward starts a new thread, so it is not armed on the original', async () => {
    const { repo, engine } = await setup()
    const inbox = repo.listThreads({ filter: { role: 'inbox' } }).threads[0]
    await engine.send({
      accountId: 'm1', to: [{ email: 'a@b.co' }], cc: [], bcc: [], subject: 'Fwd: x', html: '<p>hi</p>', text: 'hi',
      inReplyTo: { threadId: inbox.id, messageId: 'm', mode: 'forward' }, followUpDays: 3
    })
    expect(repo.getThreadRow(inbox.id)!.reminderAt).toBeNull()
  })
})
