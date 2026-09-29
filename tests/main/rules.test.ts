import { describe, expect, it } from 'vitest'
import { openDb } from '../../src/main/db/db'
import { Repo } from '../../src/main/db/repo'
import { SyncEngine } from '../../src/main/sync/engine'
import { RulesStore, matchExisting } from '../../src/main/sync/rules'
import { MockAdapter } from '../../src/main/providers/mock/adapter'
import type { NormalizedThread, SyncPage } from '../../src/main/providers/types'
import {
  bareAddress, describeActions, describeCondition, domainMatches, groupSteps, isRuleComplete, matchCondition, matchRule,
  planThread, sameRule, stripSubjectPrefixes, subjectOf, suggestRule, type RuleSubject
} from '../../src/shared/rules'
import type { Account, Label, Rule, SyncEvent } from '../../src/shared/types'

const rule = (over: Partial<Rule> = {}): Rule => ({
  id: 'r1', enabled: true, position: 0, accountId: null, createdAt: 1,
  conditions: [{ field: 'from', value: 'news@acme.com' }], actions: [{ type: 'archive' }], ...over
})
const subj = (over: Partial<RuleSubject> = {}): RuleSubject => ({ accountId: 'a', subject: 'Weekly digest', from: 'news@acme.com', ...over })

describe('matcher', () => {
  it('matches a sender address case-insensitively, tolerating "Name <addr>" in the rule', () => {
    expect(matchCondition({ field: 'from', value: 'News@Acme.com' }, subj())).toBe(true)
    expect(matchCondition({ field: 'from', value: 'Acme News <news@acme.com>' }, subj())).toBe(true)
    expect(matchCondition({ field: 'from', value: 'other@acme.com' }, subj())).toBe(false)
    expect(bareAddress(' "A" <X@Y.io> ')).toBe('x@y.io')
  })

  it('domain matches the domain and its subdomains, never a look-alike suffix', () => {
    expect(domainMatches('acme.com', 'acme.com')).toBe(true)
    expect(domainMatches('mail.acme.com', '@Acme.com')).toBe(true)
    expect(domainMatches('notacme.com', 'acme.com')).toBe(false)
    expect(domainMatches('acme.com.evil.io', 'acme.com')).toBe(false)
    expect(matchCondition({ field: 'fromDomain', value: 'acme.com' }, subj({ from: 'x@mail.acme.com' }))).toBe(true)
  })

  it('subject is a case-insensitive substring; empty values never match', () => {
    expect(matchCondition({ field: 'subject', value: 'DIGEST' }, subj())).toBe(true)
    expect(matchCondition({ field: 'subject', value: 'invoice' }, subj())).toBe(false)
    expect(matchCondition({ field: 'subject', value: '  ' }, subj())).toBe(false)
  })

  it('requires ALL conditions, honours account scope, and an empty rule matches nothing', () => {
    const r = rule({ conditions: [{ field: 'fromDomain', value: 'acme.com' }, { field: 'subject', value: 'digest' }] })
    expect(matchRule(r, subj())).toBe(true)
    expect(matchRule(r, subj({ subject: 'Invoice' }))).toBe(false)
    expect(matchRule(rule({ accountId: 'b' }), subj())).toBe(false)
    expect(matchRule(rule({ accountId: 'a' }), subj())).toBe(true)
    expect(matchRule(rule({ conditions: [] }), subj())).toBe(false)
  })

  it('subjectOf uses the newest inbound message and ignores yours and drafts', () => {
    const from = (email: string) => ({ email })
    expect(subjectOf('a', 'S', [
      { from: from('me@x.io'), date: 9, isDraft: false }, { from: from('a@b.co'), date: 3, isDraft: false }, { from: from('c@d.co'), date: 5, isDraft: false },
      { from: from('e@f.co'), date: 8, isDraft: true }
    ], 'ME@x.io')).toEqual({ accountId: 'a', subject: 'S', from: 'c@d.co' })
    expect(subjectOf('a', 'S', [{ from: from('me@x.io'), date: 1, isDraft: false }], 'me@x.io')).toBeNull()
  })
})

describe('planning', () => {
  const labels: Label[] = [
    { id: 'a:INBOX', accountId: 'a', remoteId: 'INBOX', name: 'Inbox', kind: 'system', role: 'inbox' },
    { id: 'a:SPAM', accountId: 'a', remoteId: 'SPAM', name: 'Spam', kind: 'system', role: 'spam' },
    { id: 'a:TRASH', accountId: 'a', remoteId: 'TRASH', name: 'Trash', kind: 'system', role: 'trash' },
    { id: 'a:L_Receipts', accountId: 'a', remoteId: 'L_Receipts', name: 'Receipts', kind: 'user' }
  ]
  const th = (over = {}) => ({ id: 'a:t1', accountId: 'a', labelIds: ['a:INBOX'], unread: true, starred: false, ...over })

  it('only emits actions that change something, each with its inverse', () => {
    const r = rule({ actions: [{ type: 'archive' }, { type: 'markRead' }, { type: 'star' }, { type: 'label', name: 'receipts' }] })
    const plan = planThread([r], subj(), th(), labels)
    expect(plan.map((p) => p.action.type)).toEqual(['addLabel', 'star', 'markRead', 'archive'])
    expect(plan.find((p) => p.action.type === 'addLabel')?.inverse).toEqual({ type: 'removeLabel', labelId: 'a:L_Receipts' })
    // already archived, read, starred and labelled -> nothing to do
    expect(planThread([r], subj(), th({ labelIds: ['a:L_Receipts'], unread: false, starred: true }), labels)).toEqual([])
  })

  it('skips a label that does not exist in that account, and disabled rules', () => {
    expect(planThread([rule({ actions: [{ type: 'label', name: 'Nope' }] })], subj(), th(), labels)).toEqual([])
    expect(planThread([rule({ enabled: false })], subj(), th(), labels)).toEqual([])
  })

  it('never send to spam rescues the thread into the inbox, and composes with archive', () => {
    const r = rule({ actions: [{ type: 'neverSpam' }, { type: 'archive' }] })
    const plan = planThread([r], subj(), th({ labelIds: ['a:SPAM'] }), labels)
    expect(plan.map((p) => p.action.type)).toEqual(['notSpam', 'archive'])
    expect(plan[0].inverse).toEqual({ type: 'spam' })
  })

  it('two rules do not fight: trash then archive leaves only the trash', () => {
    const plan = planThread([rule({ id: 't', position: 0, actions: [{ type: 'trash' }] }), rule({ id: 'a', position: 1, actions: [{ type: 'archive' }] })], subj(), th(), labels)
    expect(plan.map((p) => p.action.type)).toEqual(['trash'])
  })

  it('groups per-thread steps into one bulk step per rule+action', () => {
    const planned = ['a:t1', 'a:t2'].flatMap((id) => planThread([rule()], subj(), th({ id }), labels))
    const g = groupSteps(planned)
    expect(g).toHaveLength(1)
    expect(g[0].step.threadIds).toEqual(['a:t1', 'a:t2'])
  })
})

describe('describing and suggesting', () => {
  it('prefers the domain, except for shared mailbox providers', () => {
    expect(suggestRule(subj({ from: 'x@acme.com' }), 'Re: Fwd: Hello')).toMatchObject({ field: 'fromDomain', domain: 'acme.com', subject: 'Hello' })
    expect(suggestRule(subj({ from: 'friend@gmail.com' }), 'Hi')).toMatchObject({ field: 'from', from: 'friend@gmail.com' })
    expect(suggestRule(null, 'x')).toBeNull()
    expect(stripSubjectPrefixes('RE: re: Plan')).toBe('Plan')
  })
  it('words conditions and actions, and validates completeness / duplicates', () => {
    expect(describeCondition({ field: 'fromDomain', value: '@Acme.com' })).toBe('From @acme.com')
    expect(describeActions([{ type: 'archive' }, { type: 'label', name: 'Receipts' }])).toBe('Label “Receipts”, skip the inbox')
    expect(isRuleComplete(rule({ actions: [] }))).toBe(false)
    expect(isRuleComplete(rule({ conditions: [{ field: 'from', value: ' ' }] }))).toBe(false)
    expect(sameRule(rule(), rule({ id: 'zz', conditions: [{ field: 'from', value: 'NEWS@acme.com ' }] }))).toBe(true)
    expect(sameRule(rule(), rule({ actions: [{ type: 'trash' }] }))).toBe(false)
  })
})

// ------------------------------------------------------------------ storage & engine

const account: Account = { id: 'm1', provider: 'mock', email: 'me@x.io', name: 'Me', color: '#000', createdAt: 1, syncCursor: null, lastSyncAt: null, status: 'ok' }

describe('RulesStore', () => {
  it('creates its own table on a database that is already at the current schema version', () => {
    const db = openDb(':memory:') // user_version is already current: SCHEMA will not run again
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(2)
    const store = new RulesStore(db)
    new RulesStore(db) // idempotent
    expect(store.list()).toEqual([])
    const a = store.save(rule({ id: 'a' }))
    const b = store.save(rule({ id: 'b' }))
    expect([a.position, b.position]).toEqual([0, 1])
    store.save({ ...a, enabled: false })
    expect(store.list().map((r) => [r.id, r.enabled])).toEqual([['a', false], ['b', true]])
    store.reorder(['b'])
    expect(store.list().map((r) => r.id)).toEqual(['b', 'a'])
    store.delete('b')
    expect(store.list().map((r) => r.id)).toEqual(['a'])
  })
})

/** Mock provider whose incremental syncs return whatever the test queues. */
class QueueAdapter extends MockAdapter {
  queue: NormalizedThread[] = []
  acted: string[] = []
  async sync(cursor: string | null): Promise<SyncPage> {
    if (cursor === null) return super.sync(cursor)
    const threads = this.queue
    this.queue = []
    return { threads, deletedRemoteThreadIds: [], cursor: `q-${Date.now()}`, hasMore: false }
  }
  async applyAction(id: string, a: { type: string }): Promise<void> { this.acted.push(`${id}:${a.type}`) }
}

function arrival(id: string, from: string, subject: string, at: number, labelIds = ['m1:INBOX']): NormalizedThread {
  const tid = `m1:${id}`
  return {
    thread: { id: tid, accountId: 'm1', remoteId: id, subject, snippet: '', lastMessageAt: at, messageCount: 1, unread: true, starred: false, hasAttachments: false, labelIds, participants: [{ email: from }, { email: 'me@x.io' }] },
    messages: [{
      id: `m1:M_${id}`, threadId: tid, accountId: 'm1', remoteId: `M_${id}`, from: { email: from }, to: [{ email: 'me@x.io' }], cc: [], bcc: [],
      subject, date: at, snippet: '', bodyHtml: null, bodyText: 'hi', attachments: [], unread: true, labelIds, isDraft: false
    }]
  }
}

function setup(): { repo: Repo; engine: SyncEngine; adapter: QueueAdapter; events: SyncEvent[] } {
  const repo = new Repo(openDb(':memory:'))
  repo.upsertAccount(account)
  const engine = new SyncEngine(repo)
  const adapter = new QueueAdapter('m1', 'me@x.io', 'Me', 'personal')
  engine.register(adapter)
  const events: SyncEvent[] = []
  engine.onEvent((e) => events.push(e))
  return { repo, engine, adapter, events }
}

const inInbox = (repo: Repo, id: string): boolean => repo.getThreadRow(id)!.labelIds.includes('m1:INBOX')

describe('rules in the sync engine', () => {
  it('files newly arrived mail, pushes it to the provider, and announces it for undo', async () => {
    const { repo, engine, adapter, events } = setup()
    await engine.syncAccount('m1') // initial backfill
    engine.rules.save(rule({ accountId: null, conditions: [{ field: 'fromDomain', value: 'promo.example' }], actions: [{ type: 'archive' }, { type: 'markRead' }] }))

    adapter.queue = [arrival('N1', 'deals@promo.example', 'Big sale', Date.now()), arrival('N2', 'friend@x.org', 'Lunch?', Date.now())]
    await engine.syncAccount('m1')

    expect(inInbox(repo, 'm1:N1')).toBe(false)
    expect(repo.getThreadRow('m1:N1')!.unread).toBe(false)
    expect(inInbox(repo, 'm1:N2')).toBe(true) // not matched
    expect(adapter.acted).toEqual(expect.arrayContaining(['N1:archive', 'N1:markRead']))
    const ev = events.find((e) => e.type === 'rules-applied')
    expect(ev).toMatchObject({ type: 'rules-applied', ruleId: 'r1', threadCount: 1 })
    expect(ev && ev.type === 'rules-applied' && ev.steps.every((s) => s.inverse)).toBe(true)
  })

  it('does not re-file the initial backfill or a thread that merely changed', async () => {
    const { repo, engine, adapter } = setup()
    engine.rules.save(rule({ conditions: [{ field: 'fromDomain', value: 'sundaydigest.example' }] }))
    await engine.syncAccount('m1') // backfill: the demo mailbox has a Sunday Digest in the inbox
    const digest = repo.listThreads({ filter: { role: 'inbox' } }).threads.find((t) => t.subject.includes('Sunday Digest'))!
    expect(inInbox(repo, digest.id)).toBe(true)

    // The same thread comes back (say, marked read elsewhere): same lastMessageAt, so not "arrived".
    const again = arrival(digest.remoteId, 'digest@sundaydigest.example', digest.subject, digest.lastMessageAt)
    adapter.queue = [again]
    await engine.syncAccount('m1')
    expect(inInbox(repo, digest.id)).toBe(true)

    // A newer message on it *is* new mail.
    adapter.queue = [arrival(digest.remoteId, 'digest@sundaydigest.example', digest.subject, digest.lastMessageAt + 60_000)]
    await engine.syncAccount('m1')
    expect(inInbox(repo, digest.id)).toBe(false)
  })

  it('never files your own sent mail, and never trashes on a mere subject match in a sent thread', async () => {
    const { repo, engine, adapter } = setup()
    await engine.syncAccount('m1')
    engine.rules.save(rule({ conditions: [{ field: 'fromDomain', value: 'x.io' }], actions: [{ type: 'trash' }] }))
    adapter.queue = [arrival('S1', 'me@x.io', 'Note to self', Date.now())]
    await engine.syncAccount('m1')
    expect(inInbox(repo, 'm1:S1')).toBe(true)
  })

  it('applyExisting-style matching uses the same matcher (domain, not look-alikes)', async () => {
    const { repo, engine, adapter } = setup()
    await engine.syncAccount('m1')
    adapter.queue = [arrival('X1', 'a@acme.com', 'one', 1000), arrival('X2', 'a@notacme.com', 'two', 1000)]
    await engine.syncAccount('m1')
    const found = matchExisting(repo, { accountId: null, conditions: [{ field: 'fromDomain', value: 'acme.com' }], actions: [{ type: 'archive' }] })
    expect(found.map((t) => t.id)).toEqual(['m1:X1'])
  })

  it('a disabled rule does nothing', async () => {
    const { repo, engine, adapter } = setup()
    await engine.syncAccount('m1')
    engine.rules.save(rule({ enabled: false, conditions: [{ field: 'fromDomain', value: 'promo.example' }] }))
    adapter.queue = [arrival('N1', 'deals@promo.example', 'Big sale', Date.now())]
    await engine.syncAccount('m1')
    expect(inInbox(repo, 'm1:N1')).toBe(true)
  })

  it('Never send to Spam pulls a spam arrival into the inbox', async () => {
    const { repo, engine, adapter } = setup()
    await engine.syncAccount('m1')
    engine.rules.save(rule({ conditions: [{ field: 'from', value: 'boss@work.io' }], actions: [{ type: 'neverSpam' }] }))
    adapter.queue = [arrival('P1', 'boss@work.io', 'Important', Date.now(), ['m1:SPAM'])]
    await engine.syncAccount('m1')
    const t = repo.getThreadRow('m1:P1')!
    expect(t.labelIds).toContain('m1:INBOX')
    expect(t.labelIds).not.toContain('m1:SPAM')
  })
})
