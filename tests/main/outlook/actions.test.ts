import { describe, expect, it } from 'vitest'
import type { Label, ThreadAction } from '../../../src/shared/types'
import { FOLDERS, conversationHandler, gmsg, iso, makeAdapter, type Handler } from './fake'

const ACC = 'outlook-me-outlook-com'
const labels: Label[] = [
  { id: `${ACC}:cat:Clients`, accountId: ACC, remoteId: 'cat:Clients', name: 'Clients', kind: 'user', color: 'blue' },
  { id: `${ACC}:inbox`, accountId: ACC, remoteId: 'inbox', name: 'Inbox', kind: 'system', role: 'inbox' }
]

const ok: Handler = (c) => (c.method === 'POST' && c.path.endsWith('/move') ? { status: 201, json: {} } : c.method === 'PATCH' || c.method === 'DELETE' ? { status: 200, json: {} } : undefined)

async function run(action: ThreadAction, conv = [
  gmsg('in1', 'C', 'inbox', { receivedDateTime: iso(1), isRead: false }),
  gmsg('in2', 'C', 'inbox', { receivedDateTime: iso(3), isRead: true, categories: ['Clients'] }),
  gmsg('sent1', 'C', 'sentitems', { receivedDateTime: iso(2), from: { emailAddress: { address: 'me@outlook.com' } } })
], extra: Handler[] = []) {
  const h = makeAdapter([conversationHandler({ C: conv }), ok])
  for (const e of extra) h.use(e)
  const before = h.calls.length
  await h.adapter.applyAction('C', action, { labels })
  return h.calls.slice(before).filter((c) => c.method !== 'GET')
}
const moves = (cs: Awaited<ReturnType<typeof run>>): [string, string][] => cs.filter((c) => c.path.endsWith('/move')).map((c) => [c.path.split('/')[3], c.body.destinationId])

describe('applyAction -> Graph requests', () => {
  it('looks up the conversation without $orderby and applies to per-message ids', async () => {
    const h = makeAdapter([conversationHandler({ C: [gmsg('a', 'C', 'inbox')] }), ok])
    await h.adapter.applyAction('C', { type: 'markUnread' }, { labels })
    const get = h.calls.find((c) => c.query.get('$filter'))!
    expect(get.query.get('$filter')).toBe("conversationId eq 'C'")
    expect(get.query.get('$orderby')).toBeNull()
    expect(h.calls.every((c) => c.headers.prefer.includes('IdType="ImmutableId"'))).toBe(true)
  })

  it('archive moves only the inbox messages to the archive folder', async () => {
    expect(moves(await run({ type: 'archive' }))).toEqual([['in1', 'archive'], ['in2', 'archive']])
  })

  it('archive creates an Archive folder when the mailbox has none', async () => {
    const noArchive: Handler = (c) => (c.path === '/me/mailFolders/archive' ? { status: 404, json: { error: { code: 'ErrorItemNotFound', message: 'x' } } } : undefined)
    const cs = await run({ type: 'archive' }, undefined, [noArchive, (c) => (c.method === 'POST' && c.path === '/me/mailFolders' ? { status: 201, json: { id: 'NEW_ARCH' } } : undefined)])
    expect(cs[0]).toMatchObject({ method: 'POST', path: '/me/mailFolders', body: { displayName: 'Archive' } })
    expect(moves(cs)).toEqual([['in1', 'NEW_ARCH'], ['in2', 'NEW_ARCH']])
  })

  it('unarchive moves archived messages back to the inbox, leaving Sent alone', async () => {
    const conv = [gmsg('a', 'C', 'archive'), gmsg('s', 'C', 'sentitems', { from: { emailAddress: { address: 'me@outlook.com' } } })]
    expect(moves(await run({ type: 'unarchive' }, conv))).toEqual([['a', 'inbox']])
  })

  it('trash moves every message that is not already in Deleted Items', async () => {
    const conv = [gmsg('a', 'C', 'inbox'), gmsg('b', 'C', 'sentitems'), gmsg('c', 'C', 'deleteditems')]
    expect(moves(await run({ type: 'trash' }, conv))).toEqual([['a', 'deleteditems'], ['b', 'deleteditems']])
  })

  it('untrash restores by author: mine -> Sent, drafts -> Drafts, others -> Inbox', async () => {
    const conv = [
      gmsg('a', 'C', 'deleteditems'),
      gmsg('mine', 'C', 'deleteditems', { from: { emailAddress: { address: 'ME@outlook.com' } } }),
      gmsg('d', 'C', 'deleteditems', { isDraft: true })
    ]
    expect(moves(await run({ type: 'untrash' }, conv)).sort()).toEqual([['a', 'inbox'], ['d', 'drafts'], ['mine', 'sentitems']])
  })

  it('spam / notSpam', async () => {
    expect(moves(await run({ type: 'spam' }, [gmsg('a', 'C', 'inbox'), gmsg('j', 'C', 'junkemail')]))).toEqual([['a', 'junkemail']])
    expect(moves(await run({ type: 'notSpam' }, [gmsg('j', 'C', 'junkemail')]))).toEqual([['j', 'inbox']])
  })

  it('markRead / markUnread only patch messages that differ', async () => {
    const r = await run({ type: 'markRead' })
    expect(r.map((c) => [c.method, c.path, c.body])).toEqual([['PATCH', '/me/messages/in1', { isRead: true }]])
    const u = await run({ type: 'markUnread' })
    expect(u.map((c) => c.path).sort()).toEqual(['/me/messages/in2', '/me/messages/sent1'])
    expect(u.every((c) => c.body.isRead === false)).toBe(true)
  })

  it('star flags the newest message; unstar clears every flagged one', async () => {
    const s = await run({ type: 'star' })
    expect(s.map((c) => [c.path, c.body])).toEqual([['/me/messages/in2', { flag: { flagStatus: 'flagged' } }]])
    const conv = [gmsg('a', 'C', 'inbox', { flag: { flagStatus: 'flagged' } }), gmsg('b', 'C', 'inbox', { flag: { flagStatus: 'flagged' } }), gmsg('c', 'C', 'inbox')]
    const u = await run({ type: 'unstar' }, conv)
    expect(u.map((c) => [c.path, c.body])).toEqual([['/me/messages/a', { flag: { flagStatus: 'notFlagged' } }], ['/me/messages/b', { flag: { flagStatus: 'notFlagged' } }]])
  })

  it('addLabel appends the category (read-modify-write) only where missing', async () => {
    const cs = await run({ type: 'addLabel', labelId: `${ACC}:cat:Clients` }, [
      gmsg('a', 'C', 'inbox', { categories: ['Red'] }), gmsg('b', 'C', 'inbox', { categories: ['clients'] }), gmsg('c', 'C', 'inbox')
    ])
    expect(cs.map((c) => [c.path, c.body])).toEqual([['/me/messages/a', { categories: ['Red', 'Clients'] }], ['/me/messages/c', { categories: ['Clients'] }]])
  })

  it('removeLabel filters the category out of each message that has it', async () => {
    const cs = await run({ type: 'removeLabel', labelId: `${ACC}:cat:Clients` }, [gmsg('a', 'C', 'inbox', { categories: ['Red', 'Clients'] }), gmsg('b', 'C', 'inbox')])
    expect(cs.map((c) => [c.path, c.body])).toEqual([['/me/messages/a', { categories: ['Red'] }]])
  })

  it('label actions on system labels are ignored', async () => {
    expect(await run({ type: 'addLabel', labelId: `${ACC}:inbox` })).toEqual([])
  })

  it('deleteForever DELETEs every message; already-gone messages are tolerated', async () => {
    const cs = await run({ type: 'deleteForever' }, undefined, [(c) => (c.method === 'DELETE' && c.path.endsWith('/in2') ? { status: 404, json: { error: { code: 'ErrorItemNotFound', message: 'gone' } } } : undefined)])
    expect(cs.map((c) => [c.method, c.path]).sort()).toEqual([['DELETE', '/me/messages/in1'], ['DELETE', '/me/messages/in2'], ['DELETE', '/me/messages/sent1']])
  })

  it('local-only actions never hit the network', async () => {
    const h = makeAdapter([])
    for (const a of [{ type: 'snooze', until: 1 }, { type: 'unsnooze' }, { type: 'remind', at: null }] as ThreadAction[]) await h.adapter.applyAction('C', a, { labels })
    expect(h.calls).toHaveLength(0)
  })

  it('real errors propagate so the sync engine can reconcile', async () => {
    await expect(run({ type: 'markRead' }, undefined, [(c) => (c.method === 'PATCH' ? { status: 403, json: { error: { code: 'ErrorAccessDenied', message: 'no' } } } : undefined)])).rejects.toMatchObject({ status: 403 })
  })
})

describe('labels (categories)', () => {
  const cats = [{ id: 'cid1', displayName: 'Clients', color: 'preset7' }]
  const setup = (extra: Handler[] = []) => {
    const h = makeAdapter([])
    h.use((c) => (c.method === 'GET' && c.path === '/me/outlook/masterCategories' ? { json: { value: cats } } : undefined))
    for (const e of extra) h.use(e)
    h.use(ok)
    return h
  }

  it('createLabel POSTs a preset colour', async () => {
    const h = setup([(c) => (c.method === 'POST' && c.path === '/me/outlook/masterCategories' ? { status: 201, json: { id: 'n1', displayName: c.body.displayName, color: c.body.color } } : undefined)])
    const l = await h.adapter.createLabel('Ideas', 'purple')
    expect(h.calls.at(-1)!.body).toEqual({ displayName: 'Ideas', color: 'preset8' })
    expect(l).toMatchObject({ id: `${ACC}:cat:Ideas`, remoteId: 'cat:Ideas', name: 'Ideas', color: 'purple', kind: 'user' })
  })

  it('updateLabel colour PATCHes the category', async () => {
    const h = setup()
    await h.adapter.updateLabel('cat:Clients', { color: 'red' })
    expect(h.calls.at(-1)).toMatchObject({ method: 'PATCH', path: '/me/outlook/masterCategories/cid1', body: { color: 'preset0' } })
  })

  it('updateLabel rename = create new + retag messages + delete old (Graph cannot rename)', async () => {
    const h = setup([
      (c) => (c.method === 'POST' && c.path === '/me/outlook/masterCategories' ? { status: 201, json: { id: 'cid2', displayName: 'VIPs', color: 'preset7' } } : undefined),
      (c) => (c.method === 'GET' && c.path === '/me/messages' && c.query.get('$filter')?.startsWith('categories/any') ? { json: { value: [{ id: 'm1', categories: ['Clients', 'Red'] }] } } : undefined)
    ])
    await h.adapter.updateLabel('cat:Clients', { name: 'VIPs' })
    const writes = h.calls.filter((c) => c.method !== 'GET').map((c) => [c.method, c.path, c.body])
    expect(writes).toEqual([
      ['POST', '/me/outlook/masterCategories', { displayName: 'VIPs', color: 'preset7' }],
      ['PATCH', '/me/messages/m1', { categories: ['VIPs', 'Red'] }],
      ['DELETE', '/me/outlook/masterCategories/cid1', ''] // no body
    ].map((w) => (w[2] === '' ? [w[0], w[1], undefined] : w)))
    expect(h.calls.find((c) => c.query.get('$filter')?.startsWith('categories'))!.query.get('$filter')).toBe("categories/any(c:c eq 'Clients')")
  })

  it('deleteLabel removes the master category', async () => {
    const h = setup()
    await h.adapter.deleteLabel('cat:Clients')
    expect(h.calls.at(-1)).toMatchObject({ method: 'DELETE', path: '/me/outlook/masterCategories/cid1' })
    await expect(h.adapter.deleteLabel('inbox')).rejects.toThrow(/categories/i)
  })
})

void FOLDERS
