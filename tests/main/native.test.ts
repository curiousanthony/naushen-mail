import { describe, expect, it } from 'vitest'
import { openDb } from '../../src/main/db/db'
import { Repo } from '../../src/main/db/repo'
import { SyncEngine } from '../../src/main/sync/engine'
import { MockAdapter } from '../../src/main/providers/mock/adapter'
import { NewMailNotifier } from '../../src/main/newmail'
import {
  badgeText, cleanSnippet, diffInbox, looksAutomated, planNotification, restoreBounds, safeFileName,
  type Candidate, type NotifyPlan, type ViewState
} from '../../src/main/notify-plan'
import type { Account } from '../../src/shared/types'

const cand = (o: Partial<Candidate> = {}): Candidate => ({
  threadId: 't1', accountId: 'a1', lastMessageAt: 100, unread: true, fromName: 'Ada', fromEmail: 'ada@x.io',
  subject: 'Lunch?', snippet: 'Are you free at noon', fromSelf: false, automated: false, ...o
})
const away: ViewState = { windowFocused: false, accountId: 'all', inInbox: false }

describe('planNotification', () => {
  it('is silent when off', () => expect(planNotification([cand()], 'off', away).kind).toBe('none'))
  it('one message: sender title, subject + snippet body', () => {
    const p = planNotification([cand()], 'all', away)
    expect(p).toMatchObject({ kind: 'single', title: 'Ada', body: 'Lunch?\nAre you free at noon' })
  })
  it('coalesces a burst into one notification', () => {
    const p = planNotification([cand({ threadId: 'a' }), cand({ threadId: 'b', fromName: 'Bo', lastMessageAt: 200 }), cand({ threadId: 'c', fromName: 'Cy' })], 'all', away)
    expect(p).toMatchObject({ kind: 'burst', count: 3, title: '3 new messages', threadId: 'b' })
  })
  it('skips read mail and mail from yourself', () => {
    expect(planNotification([cand({ unread: false }), cand({ fromSelf: true })], 'all', away).kind).toBe('none')
  })
  it('people-only skips automated senders', () => {
    expect(planNotification([cand({ automated: true })], 'people', away).kind).toBe('none')
    expect(planNotification([cand({ automated: true })], 'all', away).kind).toBe('single')
  })
  it('suppresses only when focused on that account inbox', () => {
    const v: ViewState = { windowFocused: true, accountId: 'a1', inInbox: true }
    expect(planNotification([cand()], 'all', v).kind).toBe('none')
    expect(planNotification([cand()], 'all', { ...v, accountId: 'all' }).kind).toBe('none')
    expect(planNotification([cand()], 'all', { ...v, accountId: 'other' }).kind).toBe('single')
    expect(planNotification([cand()], 'all', { ...v, inInbox: false }).kind).toBe('single')
    expect(planNotification([cand()], 'all', { ...v, windowFocused: false }).kind).toBe('single')
  })
  it('strips html and truncates snippets', () => {
    expect(cleanSnippet('<b>Hi</b>&nbsp;there\n\n  friend')).toBe('Hi there friend')
    expect(cleanSnippet('x'.repeat(300)).length).toBe(140)
  })
  it('detects automated senders', () => {
    expect(looksAutomated('noreply@github.com', false)).toBe(true)
    expect(looksAutomated('ada@x.io', true)).toBe(true)
    expect(looksAutomated('ada@x.io', false)).toBe(false)
  })
})

describe('diffInbox / badge / bounds / filenames', () => {
  it('reports new threads and newer messages only', () => {
    const { fresh } = diffInbox(new Map([['a', 1], ['b', 1]]), [{ threadId: 'a', lastMessageAt: 1 }, { threadId: 'b', lastMessageAt: 2 }, { threadId: 'c', lastMessageAt: 1 }])
    expect(fresh.map((f) => f.threadId).sort()).toEqual(['b', 'c'])
  })
  it('badge text', () => {
    expect(badgeText(0, true)).toBe('')
    expect(badgeText(7, true)).toBe('7')
    expect(badgeText(7, false)).toBe('')
    expect(badgeText(123456, true)).toBe('9999+')
  })
  const screen = [{ x: 0, y: 0, width: 1440, height: 900 }]
  it('restores on-screen bounds, drops off-screen ones', () => {
    expect(restoreBounds({ x: 100, y: 80, width: 1100, height: 700 }, screen)).toMatchObject({ x: 100, y: 80, width: 1100 })
    expect(restoreBounds({ x: 3000, y: 80, width: 1100, height: 700 }, screen)).toBeUndefined()
    expect(restoreBounds({ x: 1, y: 1, width: 100, height: 100 }, screen)).toMatchObject({ width: 900, height: 560 })
    expect(restoreBounds('junk', screen)).toBeUndefined()
  })
  it('sanitises dragged file names', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd')
    expect(safeFileName('a:b?.pdf')).toBe('a_b_.pdf')
    expect(safeFileName('..')).toBe('attachment')
  })
})

describe('NewMailNotifier (real store + mock provider)', () => {
  const account: Account = { id: 'm1', provider: 'mock', email: 'me@x.io', name: 'Me', color: '#000', createdAt: 1, syncCursor: null, lastSyncAt: null, status: 'ok' }

  async function setup(): Promise<{ repo: Repo; engine: SyncEngine; plans: NotifyPlan[]; notifier: NewMailNotifier; inject: (n: number, over?: object) => void }> {
    const repo = new Repo(openDb(':memory:'))
    repo.upsertAccount(account)
    const engine = new SyncEngine(repo)
    engine.register(new MockAdapter('m1', 'me@x.io', 'Me', 'personal'))
    const plans: NotifyPlan[] = []
    const notifier = new NewMailNotifier(repo, { getView: async () => away, deliver: (p) => plans.push(p) })
    notifier.attach(engine)
    const tpl = () => {
      const id = repo.listThreads({ filter: { role: 'inbox' } }).threads[0].id
      return repo.getThread(id)!
    }
    let seq = 0
    const inject = (n: number, over: object = {}): void => {
      for (let i = 0; i < n; i++) {
        const t = tpl(); seq++
        const tid = `m1:new${seq}`
        const m = t.messages[t.messages.length - 1]
        repo.upsertNormalized({
          thread: { ...t, id: tid, remoteId: `new${seq}`, subject: `New ${seq}`, unread: true, lastMessageAt: Date.now() + seq, messageCount: 1 },
          messages: [{ ...m, id: `m1:newmsg${seq}`, threadId: tid, remoteId: `newmsg${seq}`, unread: true, date: Date.now(), from: { name: 'Zed', email: 'zed@x.io' }, listUnsubscribe: undefined, isDraft: false, labelIds: t.labelIds, ...over }]
        })
      }
    }
    return { repo, engine, plans, notifier, inject }
  }

  it('never notifies for the first sync; notifies once for one new message; coalesces a burst', async () => {
    const { engine, plans, notifier, inject } = await setup()
    await engine.syncAccount('m1')
    await new Promise((r) => setTimeout(r, 20))
    expect(plans).toHaveLength(0) // baseline: whole backfill stays quiet

    inject(1)
    await notifier.check('m1')
    expect(plans).toHaveLength(1)
    expect(plans[0]).toMatchObject({ kind: 'single', title: 'Zed' })

    await notifier.check('m1') // nothing new: no repeat
    expect(plans).toHaveLength(1)

    inject(3)
    await notifier.check('m1')
    expect(plans).toHaveLength(2)
    expect(plans[1]).toMatchObject({ kind: 'burst', count: 3 })
  })

  it('does not notify for mail already read, and respects the Off setting', async () => {
    const { repo, engine, plans, notifier, inject } = await setup()
    await engine.syncAccount('m1')
    await new Promise((r) => setTimeout(r, 20))
    inject(1, { unread: false })
    // thread row itself is unread=true from inject; mark it read like another device would
    repo.db.prepare("UPDATE threads SET unread = 0 WHERE id = 'm1:new1'").run()
    await notifier.check('m1')
    expect(plans).toHaveLength(0)
    repo.setSettings({ notifications: false })
    inject(1)
    await notifier.check('m1')
    expect(plans).toHaveLength(0)
  })
})
