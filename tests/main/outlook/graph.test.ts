import { describe, expect, it, vi } from 'vitest'
import { GraphClient, GraphError, buildQuery, enc, odataString } from '../../../src/main/providers/outlook/graph'
import { fakeFetch } from './fake'

const client = (f: ReturnType<typeof fakeFetch>, tokens = { get: vi.fn(async (_f?: boolean) => 'tok') }, sleep = vi.fn(async (_ms: number) => undefined)) =>
  ({ c: new GraphClient({ tokens, fetchImpl: f.fetchImpl, sleep }), tokens, sleep })

describe('GraphClient', () => {
  it('sends bearer + Prefer IdType=ImmutableId on every request and merges extra preferences', async () => {
    const f = fakeFetch([() => ({ json: { ok: 1 } })])
    const { c } = client(f)
    await c.get('/me')
    await c.get('/me/messages', { prefer: ['outlook.body-content-type="html"', 'odata.maxpagesize=50'] })
    await c.post('/me/messages/x/move', { destinationId: 'archive' })
    expect(f.calls[0].headers.authorization).toBe('Bearer tok')
    expect(f.calls[0].headers.prefer).toBe('IdType="ImmutableId"')
    expect(f.calls[1].headers.prefer).toBe('IdType="ImmutableId", outlook.body-content-type="html", odata.maxpagesize=50')
    expect(f.calls[2].headers.prefer).toContain('IdType="ImmutableId"')
    expect(f.calls[2].headers['content-type']).toBe('application/json')
  })

  it('retries 429/503 honouring Retry-After (seconds)', async () => {
    let n = 0
    const f = fakeFetch([() => (++n === 1 ? { status: 429, headers: { 'Retry-After': '7' } } : n === 2 ? { status: 503 } : { json: { done: true } })])
    const { c, sleep } = client(f)
    expect(await c.get('/me')).toEqual({ done: true })
    expect(f.calls).toHaveLength(3)
    expect(sleep).toHaveBeenNthCalledWith(1, 7000)
    expect(sleep.mock.calls[1][0]).toBeGreaterThanOrEqual(1000) // exponential fallback without Retry-After
  })

  it('gives up after maxRetries and surfaces a GraphError', async () => {
    const f = fakeFetch([() => ({ status: 429, headers: { 'Retry-After': '0' } })])
    const c = new GraphClient({ tokens: { get: async () => 't' }, fetchImpl: f.fetchImpl, sleep: async () => undefined, maxRetries: 2 })
    await expect(c.get('/me')).rejects.toMatchObject({ status: 429 })
    expect(f.calls).toHaveLength(3)
  })

  it('on 401 forces a token refresh and retries once', async () => {
    let n = 0
    const f = fakeFetch([() => (++n === 1 ? { status: 401, json: { error: { code: 'InvalidAuthenticationToken', message: 'expired' } } } : { json: { ok: true } })])
    const { c, tokens } = client(f)
    expect(await c.get('/me')).toEqual({ ok: true })
    expect(tokens.get.mock.calls.map((x) => x[0])).toEqual([false, true])
    // a second consecutive 401 is an error, not a loop
    const f2 = fakeFetch([() => ({ status: 401, json: { error: { code: 'InvalidAuthenticationToken', message: 'nope' } } })])
    await expect(client(f2).c.get('/me')).rejects.toBeInstanceOf(GraphError)
    expect(f2.calls).toHaveLength(2)
  })

  it('parses Graph errors and handles 202/204 empty bodies', async () => {
    const f = fakeFetch([(c) => (c.path === '/me/sendMail' ? { status: 202 } : { status: 400, json: { error: { code: 'ErrorInvalidIdMalformed', message: 'bad id' } } })])
    const { c } = client(f)
    expect(await c.post('/me/sendMail', {})).toBeUndefined()
    await expect(c.get('/me/messages/x')).rejects.toMatchObject({ status: 400, code: 'ErrorInvalidIdMalformed' })
  })

  it('refuses to send the token to a non-Graph link', async () => {
    const f = fakeFetch([() => ({ json: {} })])
    const { c } = client(f)
    await expect(c.get('https://evil.example/v1.0/me')).rejects.toThrow(/non-Graph/)
    expect(f.calls).toHaveLength(0)
    await c.get('https://graph.microsoft.com/v1.0/me/messages?$skiptoken=abc')
    expect(f.calls).toHaveLength(1)
  })

  it('getAll follows @odata.nextLink verbatim', async () => {
    const f = fakeFetch([(c) => (c.query.get('$skiptoken')
      ? { json: { value: [{ id: 2 }] } }
      : { json: { value: [{ id: 1 }], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/messages?$skiptoken=zz' } })])
    const { c } = client(f)
    expect(await c.getAll('/me/messages')).toEqual([{ id: 1 }, { id: 2 }])
  })

  it('never runs more than 4 requests at once', async () => {
    let active = 0; let max = 0
    const fetchImpl = (async () => { active++; max = Math.max(max, active); await new Promise((r) => setTimeout(r, 5)); active--; return new Response('{}') }) as unknown as typeof fetch
    const c = new GraphClient({ tokens: { get: async () => 't' }, fetchImpl })
    await Promise.all(Array.from({ length: 12 }, () => c.get('/me')))
    expect(max).toBe(4)
  })
})

describe('query helpers', () => {
  it('keeps OData punctuation readable but encodes the rest', () => {
    expect(buildQuery({ $select: 'id,name', $filter: "conversationId eq 'a+b='", $top: 5, x: undefined })).toBe("?$select=id,name&$filter=conversationId%20eq%20'a%2Bb='&$top=5")
    expect(enc('attachments($select=id)')).toBe('attachments($select=id)')
    expect(odataString("O'Neil")).toBe("O''Neil")
  })
})
