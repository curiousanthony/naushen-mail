import { describe, expect, it } from 'vitest'
import { decodeCursor } from '../../../src/main/providers/outlook/adapter'
import type { SyncPage } from '../../../src/main/providers/types'
import { FOLDERS, categoriesHandler, conversationHandler, gmsg, iso, makeAdapter, type Handler } from './fake'

const G = 'https://graph.microsoft.com/v1.0'

type Adapter = ReturnType<typeof makeAdapter>['adapter']
async function drain(adapter: Adapter, cursor: string | null): Promise<{ pages: SyncPage[]; cursor: string | null }> {
  const pages: SyncPage[] = []
  for (let i = 0; i < 50; i++) {
    const p = await adapter.sync(cursor)
    pages.push(p); cursor = p.cursor
    if (!p.hasMore) break
  }
  return { pages, cursor }
}

/** /me/messages listing across pages. */
const listing = (pages: { id: string; conv: string; at: number }[][]): Handler => (c) => {
  if (c.method !== 'GET' || c.path !== '/me/messages' || c.query.get('$filter')) return
  const idx = Number(c.query.get('$skiptoken') ?? 0)
  const page = pages[idx]
  return { json: { value: page.map((m) => ({ id: m.id, conversationId: m.conv, receivedDateTime: iso(m.at), parentFolderId: FOLDERS.inbox })), ...(pages[idx + 1] ? { '@odata.nextLink': `${G}/me/messages?$skiptoken=${idx + 1}` } : {}) } }
}

/** Delta feed: per folder, initial round -> deltaLink token; token rounds pop queued item batches. */
function deltaFeed(initial: Record<string, any[]> = {}) {
  const rounds: Record<string, any[][]> = {}
  const feed: Handler = (c) => {
    const m = /^\/me\/mailFolders\/(\w+)\/messages\/delta$/.exec(c.path)
    if (m && !c.query.get('$deltatoken')) return { json: { value: initial[m[1]] ?? [], '@odata.deltaLink': `${G}/me/mailFolders/${m[1]}/messages/delta?$deltatoken=${m[1]}-0` } }
    if (c.path.endsWith('/messages/delta') && c.query.get('$deltatoken')) {
      const wk = /\/mailFolders\/(\w+)\//.exec(c.path)![1]
      const n = Number(c.query.get('$deltatoken')!.split('-')[1])
      return { json: { value: (rounds[wk] ?? [])[n] ?? [], '@odata.deltaLink': `${G}/me/mailFolders/${wk}/messages/delta?$deltatoken=${wk}-${n + 1}` } }
    }
  }
  return { feed, queue: (wk: string, ...batches: any[][]) => { rounds[wk] = [...(rounds[wk] ?? []), ...batches] } }
}

describe('initial sync: backfill -> baseline -> delta', () => {
  const convs = {
    C1: [gmsg('m1', 'C1', 'inbox', { receivedDateTime: iso(10) }), gmsg('m3', 'C1', 'sentitems', { receivedDateTime: iso(20) })],
    C2: [gmsg('m2', 'C2', 'inbox', { receivedDateTime: iso(15), isRead: false })],
    C3: [gmsg('m9', 'C3', 'inbox', { receivedDateTime: iso(40) })]
  }

  it('pages the backfill, fetches each conversation once, snapshots every folder delta, then settles', async () => {
    const d = deltaFeed({ inbox: [{ id: 'm1', conversationId: 'C1' }, { id: 'm2', conversationId: 'C2' }, { id: 'm9', conversationId: 'C3' }], sentitems: [{ id: 'm3', conversationId: 'C1' }] })
    const { adapter, calls } = makeAdapter([
      listing([[{ id: 'm2', conv: 'C2', at: 15 }, { id: 'm1', conv: 'C1', at: 10 }], [{ id: 'm3', conv: 'C1', at: 20 }]]),
      conversationHandler(convs), d.feed
    ])
    const { pages, cursor } = await drain(adapter, null)
    const threads = pages.flatMap((p) => p.threads).map((t) => t.thread.remoteId).sort()
    expect(threads).toEqual(['C1', 'C2', 'C3']) // C3 arrived between backfill and baseline -> picked up in the gap
    // C1 appears in both listing pages but its conversation is fetched a single time
    const convFetches = calls.filter((c) => c.query.get('$filter')?.startsWith('conversationId'))
    expect(convFetches.filter((c) => c.query.get('$filter') === "conversationId eq 'C1'")).toHaveLength(1)
    // the listing is light; conversations carry bodies, attachments and headers
    const listCall = calls.find((c) => c.path === '/me/messages' && !c.query.get('$filter'))!
    expect(listCall.query.get('$orderby')).toBe('receivedDateTime desc')
    expect(listCall.query.get('$top')).toBe('50')
    expect(convFetches[0].query.get('$select')).toContain('body')
    expect(convFetches[0].query.get('$select')).toContain('internetMessageHeaders')
    expect(convFetches[0].query.get('$expand')).toContain('attachments')
    expect(convFetches[0].query.get('$orderby')).toBeNull()
    expect(convFetches[0].headers.prefer).toContain('outlook.body-content-type="html"')
    // whole mailbox was listed => baseline deltas are unfiltered
    const baseline = calls.filter((c) => c.path.endsWith('/messages/delta'))
    expect(baseline).toHaveLength(6)
    expect(baseline.every((c) => c.query.get('$filter') === null)).toBe(true)
    expect(baseline[0].query.get('$select')).toBe('id,conversationId')
    // final cursor stores a deltaLink per folder
    const cur = decodeCursor(cursor)!
    expect(cur.phase).toBe('delta')
    expect(Object.keys(cur.links).sort()).toEqual(['archive', 'deleteditems', 'drafts', 'inbox', 'junkemail', 'sentitems'])
    expect(cur.links.inbox).toContain('$deltatoken=inbox-0')
    expect(pages.at(-1)!.hasMore).toBe(false)
  })

  it('bounds the backfill and filters the baseline deltas to the backfilled window', async () => {
    const d = deltaFeed()
    const { adapter, calls } = makeAdapter([
      listing([[{ id: 'm2', conv: 'C2', at: 15 }, { id: 'm1', conv: 'C1', at: 10 }], [{ id: 'm3', conv: 'C1', at: 5 }]]),
      conversationHandler(convs), d.feed
    ], { backfillLimit: 2 })
    const { pages } = await drain(adapter, null)
    expect(calls.filter((c) => c.path === '/me/messages' && !c.query.get('$filter'))).toHaveLength(1) // stopped after the first page
    const baseline = calls.filter((c) => c.path.endsWith('/messages/delta'))
    expect(baseline[0].query.get('$filter')).toBe(`receivedDateTime ge ${iso(10)}`)
    expect(baseline[0].query.get('$orderby')).toBe('receivedDateTime desc')
    expect(pages.flatMap((p) => p.threads).map((t) => t.thread.remoteId).sort()).toEqual(['C1', 'C2'])
  })
})

describe('delta sync', () => {
  const convs: Record<string, ReturnType<typeof gmsg>[]> = {
    C1: [gmsg('m1', 'C1', 'inbox', { receivedDateTime: iso(10) })],
    C2: [gmsg('m2', 'C2', 'inbox', { receivedDateTime: iso(15) })]
  }
  async function primed(extra: Parameters<typeof makeAdapter>[1] = {}) {
    const d = deltaFeed({ inbox: [{ id: 'm1', conversationId: 'C1' }, { id: 'm2', conversationId: 'C2' }] })
    const h = makeAdapter([listing([[{ id: 'm1', conv: 'C1', at: 10 }, { id: 'm2', conv: 'C2', at: 15 }]]), conversationHandler(convs), d.feed], extra)
    const { cursor } = await drain(h.adapter, null)
    return { ...h, d, cursor: cursor! }
  }

  it('polls one folder per page and rebuilds the threads of updated messages', async () => {
    const { adapter, d, calls, cursor } = await primed()
    convs.C1 = [gmsg('m1', 'C1', 'inbox', { receivedDateTime: iso(10), isRead: false }), gmsg('m1b', 'C1', 'inbox', { receivedDateTime: iso(50), bodyPreview: 'new reply', isRead: false })]
    d.queue('inbox', [{ id: 'm1', conversationId: 'C1' }, { id: 'm1b', conversationId: 'C1' }]) // same conversation twice => one refetch
    const before = calls.length
    const { pages } = await drain(adapter, cursor)
    expect(pages).toHaveLength(6) // one page per well-known folder
    const threads = pages.flatMap((p) => p.threads)
    expect(threads).toHaveLength(1)
    expect(threads[0].thread.remoteId).toBe('C1')
    expect(threads[0].thread.messageCount).toBe(2)
    expect(threads[0].thread.unread).toBe(true)
    expect(threads[0].thread.snippet).toBe('new reply')
    expect(calls.slice(before).filter((c) => c.query.get('$filter') === "conversationId eq 'C1'")).toHaveLength(1)
    expect(decodeCursor(pages.at(-1)!.cursor)!.links.inbox).toContain('inbox-1')
    expect(pages.at(-1)!.deletedRemoteThreadIds).toEqual([])
  })

  it('a permanently deleted message removes its thread when the conversation is empty (local store lookup)', async () => {
    const { adapter, d, cursor } = await primed({ lookupConversation: (id) => ({ m2: 'C2' } as Record<string, string>)[id] })
    convs.C2 = []
    d.queue('inbox', [{ id: 'm2', '@removed': { reason: 'deleted' } }])
    const { pages } = await drain(adapter, cursor)
    expect(pages.flatMap((p) => p.deletedRemoteThreadIds)).toEqual(['C2'])
    expect(pages.flatMap((p) => p.threads)).toHaveLength(0)
  })

  it('a message moved out of the folder (removed) rebuilds the thread from its new location', async () => {
    const { adapter, d, cursor } = await primed({ lookupConversation: (id) => ({ m1: 'C1' } as Record<string, string>)[id] })
    convs.C1 = [gmsg('m1', 'C1', 'archive', { receivedDateTime: iso(10) })]
    d.queue('inbox', [{ id: 'm1', '@removed': { reason: 'changed' } }])
    const { pages } = await drain(adapter, cursor)
    const t = pages.flatMap((p) => p.threads)[0]
    expect(t.thread.labelIds).toEqual(['outlook-me-outlook-com:archive'])
  })

  it('without a local lookup, a removed id is resolved via Graph; 404 (gone for good) is ignored', async () => {
    const { adapter, d, cursor, calls } = await primed()
    adapter['msgConv'].clear() // forget what we saw during backfill
    d.queue('inbox', [{ id: 'ghost', '@removed': { reason: 'deleted' } }])
    const { pages } = await drain(adapter, cursor)
    expect(calls.some((c) => c.path === '/me/messages/ghost')).toBe(true)
    expect(pages.flatMap((p) => p.threads)).toHaveLength(0)
    expect(pages.flatMap((p) => p.deletedRemoteThreadIds)).toHaveLength(0)
  })

  it('syncStateNotFound / 410 => reset page that restarts the backfill', async () => {
    const { cursor } = await primed()
    const h = makeAdapter([(c) => (c.path.endsWith('/messages/delta') ? { status: 410, json: { error: { code: 'syncStateNotFound', message: 'gone' } } } : undefined)])
    const page = await h.adapter.sync(cursor)
    expect(page).toMatchObject({ reset: true, cursor: null, hasMore: true, threads: [], deletedRemoteThreadIds: [] })
  })

  it('a plain 410 without an error code also resets; unrelated errors propagate', async () => {
    const { cursor } = await primed()
    const gone = makeAdapter([(c) => (c.path.endsWith('/messages/delta') ? { status: 410 } : undefined)])
    expect((await gone.adapter.sync(cursor)).reset).toBe(true)
    const boom = makeAdapter([(c) => (c.path.endsWith('/messages/delta') ? { status: 500, json: { error: { code: 'boom', message: 'x' } } } : undefined)])
    await expect(boom.adapter.sync(cursor)).rejects.toMatchObject({ status: 500 })
  })

  it('an unreadable cursor resets instead of crashing', async () => {
    const { adapter } = makeAdapter([])
    expect((await adapter.sync('not-a-cursor')).reset).toBe(true)
  })
})

describe('listLabels / fetchThread', () => {
  it('returns system labels with roles and categories as coloured user labels', async () => {
    const h = makeAdapter([])
    h.use(categoriesHandler([{ id: 'c1', displayName: 'Clients', color: 'preset7' }, { id: 'c2', displayName: 'Plain', color: 'none' }]))
    const labels = await h.adapter.listLabels()
    const sys = labels.filter((l) => l.kind === 'system')
    expect(sys.map((l) => [l.remoteId, l.role, l.name])).toEqual([
      ['inbox', 'inbox', 'Inbox'], ['sentitems', 'sent', 'Sent'], ['drafts', 'drafts', 'Drafts'],
      ['deleteditems', 'trash', 'Trash'], ['junkemail', 'spam', 'Spam'], ['archive', 'archive', 'Archive']
    ])
    expect(sys[0].id).toBe('outlook-me-outlook-com:inbox')
    const user = labels.filter((l) => l.kind === 'user')
    expect(user.map((l) => [l.id, l.name, l.color])).toEqual([
      ['outlook-me-outlook-com:cat:Clients', 'Clients', 'blue'], ['outlook-me-outlook-com:cat:Plain', 'Plain', undefined]
    ])
  })

  it('tolerates a missing archive folder', async () => {
    const h = makeAdapter([(c) => (c.path === '/me/mailFolders/archive' ? { status: 404, json: { error: { code: 'ErrorItemNotFound', message: 'x' } } } : undefined)])
    const labels = await h.adapter.listLabels()
    expect(labels.filter((l) => l.kind === 'system')).toHaveLength(6)
  })

  it('fetchThread returns headers-derived fields (List-Unsubscribe, In-Reply-To)', async () => {
    const m = gmsg('m1', 'C1', 'inbox', { internetMessageHeaders: [{ name: 'List-Unsubscribe', value: '<https://u.example>' }, { name: 'In-Reply-To', value: '<p@x>' }] })
    const { adapter } = makeAdapter([conversationHandler({ C1: [m] })])
    const t = await adapter.fetchThread('C1')
    expect(t.messages[0].listUnsubscribe).toBe('<https://u.example>')
    expect(t.messages[0].inReplyTo).toBe('<p@x>')
    await expect(makeAdapter([conversationHandler({})]).adapter.fetchThread('nope')).rejects.toThrow(/not found/i)
  })
})
