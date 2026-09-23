import { beforeEach, describe, expect, it, vi } from 'vitest'

// tokens.ts imports Electron's safeStorage at module scope; the adapter only needs its pure ensureAccessToken().
vi.mock('electron', () => ({ safeStorage: {}, shell: {} }))

import { GmailAdapter } from '../../../src/main/providers/gmail/adapter'
import { GmailApiError } from '../../../src/main/providers/gmail/http'
import { decodeCursor, encodeCursor } from '../../../src/main/providers/gmail/cursor'
import { mapLabels } from '../../../src/main/providers/gmail/labels'
import type { AdapterFactoryDeps, StoredTokens } from '../../../src/main/providers/types'
import type { Account, Label, OutgoingMessage, ThreadAction } from '../../../src/shared/types'
import { DEFAULT_SETTINGS } from '../../../src/shared/types'
import { b64, fakeFetch, hdr, json, msg, route, thread, type Call, type Handler } from './helpers'

const account: Account = { id: 'gmail-a', provider: 'gmail', email: 'me@example.com', name: 'Me', color: '', createdAt: 0, syncCursor: null, lastSyncAt: null, status: 'ok' }
const noSleep = { sleep: async () => {}, random: () => 0 }

interface Rig { adapter: GmailAdapter; calls: Call[]; tokens: { current: StoredTokens | null }; reauth: ReturnType<typeof vi.fn> }

function rig(handlers: Handler[], tokenOver: Partial<StoredTokens> = {}, opts: ConstructorParameters<typeof GmailAdapter>[1] = {}): Rig {
  const tokens = { current: { accessToken: 'AT', refreshToken: 'RT', expiresAt: Date.now() + 3_600_000, ...tokenOver } as StoredTokens | null }
  const reauth = vi.fn()
  const { fetch, calls } = fakeFetch(...handlers)
  const deps: AdapterFactoryDeps = {
    account,
    getTokens: () => tokens.current,
    saveTokens: (t) => { tokens.current = t },
    getSettings: () => ({ ...DEFAULT_SETTINGS, oauth: { ...DEFAULT_SETTINGS.oauth, googleClientId: 'cid', googleClientSecret: 'sec' } }),
    markReauthNeeded: reauth
  }
  return { adapter: new GmailAdapter(deps, { fetch, ...noSleep, ...opts }), calls, tokens, reauth }
}

const threadsGet = (map: Record<string, ReturnType<typeof thread> | number>): Handler =>
  route('GET', /\/threads\/([^/]+)$/, (_c, m) => {
    const t = map[m[1]]
    return typeof t === 'number' ? json({ error: { message: 'not found' } }, t) : t ?? json({ error: { message: 'nf' } }, 404)
  })

const modifyBodies = (calls: Call[]): unknown[] => calls.filter((c) => c.url.pathname.endsWith('/modify')).map((c) => c.body)

describe('listLabels', () => {
  it('maps the labels endpoint', async () => {
    const { adapter } = rig([route('GET', /\/labels$/, () => ({ labels: [{ id: 'INBOX', name: 'INBOX', type: 'system' }, { id: 'Label_1', name: 'Work', type: 'user', color: { backgroundColor: '#4a86e8', textColor: '#fff' } }] }))])
    const l = await adapter.listLabels()
    expect(l.map((x) => [x.id, x.role ?? x.color])).toEqual([['gmail-a:INBOX', 'inbox'], ['gmail-a:Label_1', 'blue']])
  })
})

describe('initial backfill', () => {
  const ids = (from: number, n: number): { id: string }[] => Array.from({ length: n }, (_, i) => ({ id: `t${from + i}` }))
  const listHandler = (total: number): Handler => route('GET', /\/threads$/, (c) => {
    const q = c.url.searchParams
    if (q.get('labelIds')) return { threads: q.get('labelIds') === 'TRASH' ? [{ id: 'trashed' }] : [] }
    const start = Number(q.get('pageToken') ?? 0)
    const n = Math.min(Number(q.get('maxResults')), total - start)
    return { threads: ids(start, n), ...(start + n < total ? { nextPageToken: String(start + n) } : {}) }
  })
  const anyThread: Handler = route('GET', /\/threads\/([^/]+)$/, (_c, m) => thread(m[1], [msg(`m-${m[1]}`, m[1], { labelIds: m[1] === 'trashed' ? ['TRASH'] : ['INBOX'] })]))
  const profile = route('GET', /\/profile$/, () => ({ emailAddress: 'me@example.com', historyId: '777' }))

  it('reads the profile first, pages threads.list, hydrates with bounded concurrency, then finishes with extras + incremental cursor', async () => {
    let active = 0, peak = 0
    const slow: Handler = async (c) => {
      if (!/\/threads\/[^/]+$/.test(c.url.pathname)) return undefined
      active++; peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 2))
      active--
      return undefined
    }
    const { adapter, calls } = rig([slow, profile, listHandler(230), anyThread])

    let cursor: string | null = null
    const pages = []
    for (let i = 0; i < 20; i++) {
      const p = await adapter.sync(cursor)
      pages.push(p)
      cursor = p.cursor
      if (!p.hasMore) break
    }
    expect(calls[0].url.pathname).toMatch(/\/profile$/) // historyId captured before the crawl
    expect(pages.map((p) => p.threads.length)).toEqual([100, 100, 30, 1]) // 3 list pages + trash/spam extras
    expect(pages.map((p) => p.hasMore)).toEqual([true, true, true, false])
    expect(pages.map((p) => !!p.reset)).toEqual([false, false, false, false]) // fresh account: no reset flag
    expect(decodeCursor(pages[0].cursor)).toMatchObject({ phase: 'backfill', historyId: '777', pageToken: '100', fetched: 100 })
    expect(decodeCursor(pages[2].cursor)).toMatchObject({ phase: 'backfill', extras: true, fetched: 230 })
    expect(decodeCursor(cursor)).toEqual({ v: 1, phase: 'incremental', historyId: '777' })
    expect(pages[3].threads[0].thread.labelIds).toEqual(['gmail-a:TRASH'])
    expect(peak).toBeLessThanOrEqual(5)
    expect(peak).toBeGreaterThan(1)
  })

  it('stops at the backfill limit even if more pages exist', async () => {
    const { adapter } = rig([profile, listHandler(10_000), anyThread], {}, { backfillLimit: 250 })
    let cursor: string | null = null
    let total = 0
    for (let i = 0; i < 20; i++) {
      const p = await adapter.sync(cursor)
      total += p.threads.length
      cursor = p.cursor
      if (!p.hasMore) break
    }
    expect(total).toBe(251) // 250 + 1 trashed
  })

  it('skips threads that vanish between list and get', async () => {
    const { adapter } = rig([profile, route('GET', /\/threads$/, () => ({ threads: [{ id: 'a' }, { id: 'gone' }] })), threadsGet({ a: thread('a', [msg('m', 'a')]), gone: 404 })])
    const p = await adapter.sync(null)
    expect(p.threads.map((t) => t.thread.remoteId)).toEqual(['a'])
  })

  it('inlines large bodies delivered by attachmentId', async () => {
    const big = thread('t', [msg('m1', 't')])
    big.messages![0].payload = { mimeType: 'text/html', filename: '', headers: [hdr('Subject', 'Big')], body: { size: 9e6, attachmentId: 'BIGBODY' } }
    const { adapter } = rig([threadsGet({ t: big }), route('GET', /\/messages\/m1\/attachments\/BIGBODY$/, () => ({ data: b64('<p>huge</p>') }))])
    expect((await adapter.fetchThread('t')).messages[0].bodyHtml).toBe('<p>huge</p>')
  })
})

describe('incremental sync', () => {
  const cursor = (o: object = {}): string => encodeCursor({ v: 1, phase: 'incremental', historyId: '100', ...o } as never)

  it('lists history with all four types, refetches only affected threads and advances historyId', async () => {
    const { adapter, calls } = rig([
      route('GET', /\/history$/, (c) => {
        expect(c.url.searchParams.get('startHistoryId')).toBe('100')
        if (!c.url.searchParams.get('pageToken')) return { history: [{ id: '101', messagesAdded: [{ message: { id: 'm1', threadId: 't1' } }] }], historyId: '150', nextPageToken: 'p2' }
        return { history: [{ id: '120', labelsRemoved: [{ message: { id: 'm9', threadId: 't2' }, labelIds: ['UNREAD'] }] }, { id: '130', messagesDeleted: [{ message: { id: 'm3', threadId: 't3' } }] }], historyId: '200' }
      }),
      threadsGet({ t1: thread('t1', [msg('m1', 't1')]), t2: thread('t2', [msg('m9', 't2', { labelIds: ['INBOX'] })]), t3: 404 })
    ])
    const p = await adapter.sync(cursor())
    const hist = calls.filter((c) => c.url.pathname.endsWith('/history'))
    expect(hist[0].url.searchParams.getAll('historyTypes')).toEqual(['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved'])
    expect(p.threads.map((t) => t.thread.remoteId).sort()).toEqual(['t1', 't2'])
    expect(p.deletedRemoteThreadIds).toEqual(['t3'])
    expect(p.hasMore).toBe(false)
    expect(p.reset).toBeUndefined()
    expect(decodeCursor(p.cursor)).toEqual({ v: 1, phase: 'incremental', historyId: '200' })
  })

  it('is a cheap no-op when nothing changed', async () => {
    const { adapter, calls } = rig([route('GET', /\/history$/, () => ({ historyId: '100' }))])
    const p = await adapter.sync(cursor())
    expect(p.threads).toEqual([])
    expect(calls).toHaveLength(1)
  })

  it('spreads large change sets over several calls via pending ids in the cursor', async () => {
    const affected = Array.from({ length: 7 }, (_, i) => `t${i}`)
    const map = Object.fromEntries(affected.map((id) => [id, thread(id, [msg(`m${id}`, id)])]))
    const { adapter, calls } = rig([
      route('GET', /\/history$/, () => ({ history: affected.map((id, i) => ({ id: String(i), labelsAdded: [{ message: { id: 'x', threadId: id } }] })), historyId: '300' })),
      threadsGet(map)
    ], {}, { hydrateBatch: 3 })
    const a = await adapter.sync(cursor())
    expect([a.threads.length, a.hasMore]).toEqual([3, true])
    expect(decodeCursor(a.cursor)).toEqual({ v: 1, phase: 'incremental', historyId: '300', pending: ['t3', 't4', 't5', 't6'] })
    const b = await adapter.sync(a.cursor)
    expect([b.threads.length, b.hasMore]).toEqual([3, true])
    const c = await adapter.sync(b.cursor)
    expect([c.threads.length, c.hasMore]).toEqual([1, false])
    expect(decodeCursor(c.cursor)).toEqual({ v: 1, phase: 'incremental', historyId: '300' })
    expect(calls.filter((x) => x.url.pathname.endsWith('/history'))).toHaveLength(1) // pending calls do not re-query history
  })

  it('an expired historyId (404) triggers a full resync with reset=true and hasMore so the mailbox is never left empty', async () => {
    const { adapter } = rig([
      route('GET', /\/history$/, () => json({ error: { message: 'Requested entity was not found.' } }, 404)),
      route('GET', /\/profile$/, () => ({ historyId: '900' })),
      route('GET', /\/threads$/, () => ({ threads: [{ id: 'a' }] })),
      threadsGet({ a: thread('a', [msg('m', 'a')]) })
    ])
    const p = await adapter.sync(cursor())
    expect(p.reset).toBe(true)
    expect(p.hasMore).toBe(true)
    expect(p.threads).toHaveLength(1)
    expect(decodeCursor(p.cursor)).toMatchObject({ phase: 'backfill', historyId: '900' })
  })

  it('an unrecognised non-null cursor also resets', async () => {
    const { adapter } = rig([route('GET', /\/profile$/, () => ({ historyId: '5' })), route('GET', /\/threads$/, () => ({}))])
    const p = await adapter.sync('garbage')
    expect(p.reset).toBe(true)
  })

  it('propagates other API errors', async () => {
    const { adapter } = rig([route('GET', /\/history$/, () => json({ error: { message: 'nope' } }, 400))])
    await expect(adapter.sync(cursor())).rejects.toBeInstanceOf(GmailApiError)
  })
})

describe('applyAction -> request bodies', () => {
  const labels: Label[] = mapLabels('gmail-a', [{ id: 'Label_5', name: 'Work', type: 'user' }])
  const ok = route('POST', /\/threads\/[^/]+\/(modify|trash|untrash)$/, () => ({}))
  const run = async (action: ThreadAction): Promise<Call[]> => {
    const r = rig([ok])
    await r.adapter.applyAction('T1', action, { labels })
    return r.calls
  }
  const cases: [ThreadAction, unknown][] = [
    [{ type: 'archive' }, { removeLabelIds: ['INBOX'] }],
    [{ type: 'unarchive' }, { addLabelIds: ['INBOX'], removeLabelIds: ['TRASH', 'SPAM'] }],
    [{ type: 'spam' }, { addLabelIds: ['SPAM'], removeLabelIds: ['INBOX'] }],
    [{ type: 'notSpam' }, { addLabelIds: ['INBOX'], removeLabelIds: ['SPAM'] }],
    [{ type: 'markRead' }, { removeLabelIds: ['UNREAD'] }],
    [{ type: 'markUnread' }, { addLabelIds: ['UNREAD'] }],
    [{ type: 'star' }, { addLabelIds: ['STARRED'] }],
    [{ type: 'unstar' }, { removeLabelIds: ['STARRED'] }],
    [{ type: 'addLabel', labelId: 'gmail-a:Label_5' }, { addLabelIds: ['Label_5'] }], // local id -> Gmail id
    [{ type: 'removeLabel', labelId: 'gmail-a:Label_5' }, { removeLabelIds: ['Label_5'] }]
  ]
  it.each(cases)('%j', async (action, body) => {
    const calls = await run(action)
    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('POST')
    expect(calls[0].url.pathname).toBe('/gmail/v1/users/me/threads/T1/modify')
    expect(calls[0].body).toEqual(body)
  })

  it('trash uses threads.trash; untrash restores to inbox', async () => {
    const t = await run({ type: 'trash' })
    expect(t.map((c) => c.url.pathname)).toEqual(['/gmail/v1/users/me/threads/T1/trash'])
    const u = await run({ type: 'untrash' })
    expect(u.map((c) => c.url.pathname.split('/').pop())).toEqual(['untrash', 'modify'])
    expect(u[1].body).toEqual({ addLabelIds: ['INBOX'] })
  })

  it('local-only actions never touch the network; ids may arrive with the account prefix', async () => {
    for (const a of [{ type: 'snooze', until: 1 }, { type: 'unsnooze' }, { type: 'remind', at: null }] as ThreadAction[]) expect(await run(a)).toHaveLength(0)
    const r = rig([ok])
    await r.adapter.applyAction('gmail-a:T9', { type: 'archive' }, { labels })
    expect(r.calls[0].url.pathname).toContain('/threads/T9/modify')
  })

  it('deleteForever calls threads.delete, and degrades to trash when the scope forbids it', async () => {
    const good = rig([route('DELETE', /\/threads\/T1$/, () => new Response(null, { status: 204 }))])
    await good.adapter.applyAction('T1', { type: 'deleteForever' }, { labels })
    expect(good.calls.map((c) => c.method)).toEqual(['DELETE'])
    const denied = rig([route('DELETE', /\/threads\/T1$/, () => json({ error: { message: 'Insufficient Permission' } }, 403)), ok])
    await denied.adapter.applyAction('T1', { type: 'deleteForever' }, { labels })
    expect(denied.calls.map((c) => c.url.pathname.split('/').pop())).toEqual(['T1', 'trash'])
    const boom = rig([route('DELETE', /\/threads\/T1$/, () => json({ error: { message: 'x' } }, 400))])
    await expect(boom.adapter.applyAction('T1', { type: 'deleteForever' }, { labels })).rejects.toThrow()
  })
})

describe('token refresh + reauth', () => {
  it('refreshes an expired access token once (shared by concurrent calls) and persists it, keeping the refresh token', async () => {
    let refreshes = 0
    const r = rig([
      route('POST', /\/token$/, () => { refreshes++; return { access_token: 'FRESH', expires_in: 3600 } }),
      route('GET', /\/labels$/, () => ({ labels: [] }))
    ], { expiresAt: Date.now() - 1000 })
    await Promise.all([r.adapter.listLabels(), r.adapter.listLabels(), r.adapter.listLabels()])
    expect(refreshes).toBe(1)
    expect(r.tokens.current).toMatchObject({ accessToken: 'FRESH', refreshToken: 'RT' })
    const labelCall = r.calls.find((c) => c.url.pathname.endsWith('/labels'))!
    expect((labelCall.headers as Record<string, string>).Authorization).toBe('Bearer FRESH')
    const form = new URLSearchParams(r.calls[0].rawBody)
    expect(Object.fromEntries(form)).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'RT', client_id: 'cid', client_secret: 'sec' })
  })

  it('marks the account for re-auth on invalid_grant', async () => {
    const r = rig([route('POST', /\/token$/, () => json({ error: 'invalid_grant', error_description: 'revoked' }, 400))], { expiresAt: 0 })
    await expect(r.adapter.listLabels()).rejects.toThrow(/invalid_grant/)
    expect(r.reauth).toHaveBeenCalledWith(expect.stringMatching(/expired/i))
  })

  it('a 401 from Gmail forces a refresh and retries with the new token', async () => {
    let n = 0
    const r = rig([
      route('POST', /\/token$/, () => ({ access_token: 'NEWER', expires_in: 3600 })),
      route('GET', /\/labels$/, (c) => ((c.headers as Record<string, string>).Authorization === 'Bearer AT' && ++n ? json({ error: { message: 'Invalid Credentials' } }, 401) : { labels: [] }))
    ])
    await r.adapter.listLabels()
    expect(r.tokens.current?.accessToken).toBe('NEWER')
    expect(r.reauth).not.toHaveBeenCalled()
  })

  it('reports re-auth when signed out entirely', async () => {
    const r = rig([], {})
    r.tokens.current = null
    await expect(r.adapter.listLabels()).rejects.toThrow('Not signed in')
    expect(r.reauth).toHaveBeenCalled()
  })
})

describe('send / drafts', () => {
  const out: OutgoingMessage = { accountId: 'gmail-a', to: [{ email: 'zed@x.io' }], cc: [], bcc: [], subject: 'Hello', html: '<p>hi</p>', text: 'hi' }
  const rawOf = (c: Call): string => Buffer.from(c.body.raw, 'base64url').toString()

  it('sends via messages.send with a base64url raw body', async () => {
    const r = rig([route('POST', /\/messages\/send$/, () => ({ id: 'sent1' }))])
    await r.adapter.send(out)
    expect(r.calls).toHaveLength(1)
    expect(r.calls[0].body.threadId).toBeUndefined()
    expect(rawOf(r.calls[0])).toMatch(/^From: Me <me@example.com>/m)
    expect(rawOf(r.calls[0])).toMatch(/^To: zed@x.io/m)
    expect(rawOf(r.calls[0])).toMatch(/^Subject: Hello/m)
  })

  it('replies: sets threadId and copies Message-ID / References from the parent', async () => {
    const r = rig([
      route('GET', /\/messages\/parent1$/, (c) => {
        expect(c.url.searchParams.getAll('metadataHeaders')).toEqual(['Message-ID', 'References', 'In-Reply-To'])
        return msg('parent1', 'T1', { headers: [hdr('Message-ID', '<abc@mail>'), hdr('References', '<root@mail>')] })
      }),
      route('POST', /\/messages\/send$/, () => ({ id: 's' }))
    ])
    await r.adapter.send({ ...out, subject: 'Re: Hello', inReplyTo: { threadId: 'gmail-a:T1', messageId: 'gmail-a:parent1', mode: 'reply' } })
    const send = r.calls.find((c) => c.url.pathname.endsWith('/messages/send'))!
    expect(send.body.threadId).toBe('T1')
    expect(rawOf(send)).toMatch(/^In-Reply-To: <abc@mail>/m)
    expect(rawOf(send)).toMatch(/^References: <root@mail> <abc@mail>/m)
  })

  it('forwards start a new thread (no threadId, no parent lookup)', async () => {
    const r = rig([route('POST', /\/messages\/send$/, () => ({ id: 's' }))])
    await r.adapter.send({ ...out, inReplyTo: { threadId: 'gmail-a:T1', messageId: 'gmail-a:m1', mode: 'forward' } })
    expect(r.calls).toHaveLength(1)
    expect(r.calls[0].body.threadId).toBeUndefined()
  })

  it('still threads by threadId when the parent message is gone (404)', async () => {
    const r = rig([route('GET', /\/messages\/p$/, () => json({ error: { message: 'nf' } }, 404)), route('POST', /\/messages\/send$/, () => ({ id: 's' }))])
    await r.adapter.send({ ...out, inReplyTo: { threadId: 'T1', messageId: 'p', mode: 'reply' } })
    expect(r.calls.at(-1)!.body.threadId).toBe('T1')
  })

  it('sending an existing draft replaces its content and then drafts.send', async () => {
    const r = rig([route('PUT', /\/drafts\/r-1$/, () => ({ id: 'r-1' })), route('POST', /\/drafts\/send$/, () => ({ id: 'sent' }))])
    await r.adapter.send({ ...out, draftId: 'r-1' })
    expect(r.calls.map((c) => `${c.method} ${c.url.pathname.split('/').slice(5).join('/')}`)).toEqual(['PUT drafts/r-1', 'POST drafts/send'])
    expect(r.calls[0].body.id).toBe('r-1')
    expect(r.calls[1].body).toEqual({ id: 'r-1' })
  })

  it('saveDraft creates or updates, deleteDraft ignores 404', async () => {
    const r = rig([
      route('POST', /\/drafts$/, () => ({ id: 'r-9', message: { id: 'm' } })),
      route('PUT', /\/drafts\/r-9$/, () => ({ id: 'r-9' })),
      route('DELETE', /\/drafts\/gone$/, () => json({ error: { message: 'nf' } }, 404))
    ])
    expect(await r.adapter.saveDraft(out)).toEqual({ remoteDraftId: 'r-9' })
    expect(r.calls[0].body.message.raw).toBeTruthy()
    expect(await r.adapter.saveDraft({ ...out, draftId: 'r-9' })).toEqual({ remoteDraftId: 'r-9' })
    await expect(r.adapter.deleteDraft('gone')).resolves.toBeUndefined()
  })

  it('large messages go through the multipart upload endpoint', async () => {
    const r = rig([
      route('GET', /\/messages\/p$/, () => msg('p', 'T1')),
      route('POST', /\/upload\/gmail\/v1\/users\/me\/messages\/send$/, () => ({ id: 'u' }))
    ], {}, { uploadThresholdBytes: 10 })
    await r.adapter.send({ ...out, inReplyTo: { threadId: 'T1', messageId: 'p', mode: 'reply' } })
    const up = r.calls.find((c) => c.url.pathname.includes('/upload/'))!
    expect(up.url.searchParams.get('uploadType')).toBe('multipart')
    expect((up.headers as Record<string, string>)['Content-Type']).toMatch(/^multipart\/related; boundary=/)
    expect(up.rawBody).toContain('"threadId":"T1"')
    expect(up.rawBody).toContain('Content-Type: message/rfc822')
    expect(up.rawBody).toContain('Subject: Hello')
  })
})

describe('attachments + labels', () => {
  it('downloads by attachmentId', async () => {
    const r = rig([route('GET', /\/messages\/m1\/attachments\/ATT$/, () => ({ size: 3, data: Buffer.from([1, 2, 3]).toString('base64url') }))])
    expect([...(await r.adapter.fetchAttachment('m1', '1:ATT'))]).toEqual([1, 2, 3])
  })
  it('re-resolves through the partId when the attachmentId went stale', async () => {
    const full = msg('m1', 't')
    full.payload = { mimeType: 'multipart/mixed', parts: [{ partId: '1', mimeType: 'application/pdf', filename: 'a.pdf', body: { size: 3, attachmentId: 'FRESH' } }] }
    const r = rig([
      route('GET', /\/attachments\/STALE$/, () => json({ error: { message: 'nf' } }, 404)),
      route('GET', /\/attachments\/FRESH$/, () => ({ data: b64('pdf') })),
      route('GET', /\/messages\/m1$/, () => full)
    ])
    expect((await r.adapter.fetchAttachment('m1', '1:STALE')).toString()).toBe('pdf')
  })
  it('reads small inline parts straight from the message', async () => {
    const full = msg('m1', 't')
    full.payload = { mimeType: 'multipart/related', parts: [{ partId: '0.1', mimeType: 'image/png', filename: 'x.png', body: { size: 2, data: b64('hi') } }] }
    const r = rig([route('GET', /\/messages\/m1$/, () => full)])
    expect((await r.adapter.fetchAttachment('gmail-a:m1', '0.1:')).toString()).toBe('hi')
  })

  it('creates, updates and deletes labels with valid palette colours', async () => {
    const r = rig([
      route('POST', /\/labels$/, (c) => ({ id: 'Label_42', name: c.body.name, type: 'user', color: c.body.color })),
      route('PATCH', /\/labels\/Label_42$/, () => ({})),
      route('DELETE', /\/labels\/Label_42$/, () => new Response(null, { status: 204 }))
    ])
    const l = await r.adapter.createLabel('Clients/Acme', 'green')
    expect(r.calls[0].body).toMatchObject({ name: 'Clients/Acme', labelListVisibility: 'labelShow', messageListVisibility: 'show', color: { backgroundColor: '#16a766' } })
    expect(l).toMatchObject({ id: 'gmail-a:Label_42', remoteId: 'Label_42', color: 'green', kind: 'user' })
    await r.adapter.updateLabel('Label_42', { name: 'Acme', color: 'red' })
    expect(r.calls[1].body).toMatchObject({ name: 'Acme', color: { backgroundColor: '#fb4c2f' } })
    await r.adapter.updateLabel('gmail-a:Label_42', { name: 'Only name' })
    expect(r.calls[2].body).toEqual({ name: 'Only name' })
    await r.adapter.deleteLabel('Label_42')
    expect(r.calls[3].method).toBe('DELETE')
  })
})

describe('fetchThread', () => {
  it('returns the fully hydrated normalised thread', async () => {
    const r = rig([threadsGet({ t1: thread('t1', [msg('m1', 't1', { body: 'hi there' })]) })])
    const n = await r.adapter.fetchThread('t1')
    expect(n.thread.id).toBe('gmail-a:t1')
    expect(n.messages[0].bodyText).toBe('hi there')
    expect(r.calls[0].url.searchParams.get('format')).toBe('full')
  })
})
