import { describe, expect, it, vi } from 'vitest'
import { accountIdFor, buildAuthUrl, exchangeCode, fetchUserInfo, refreshAccessToken, toStoredTokens } from '../../../src/main/providers/gmail/auth'
import { buildUrl, GmailApiError, GmailHttp, pool } from '../../../src/main/providers/gmail/http'
import { fakeFetch, json, route } from './helpers'

const noSleep = { sleep: async () => {}, random: () => 0 }

describe('GmailHttp', () => {
  it('serialises repeated query params and sends the bearer token', async () => {
    const { fetch, calls } = fakeFetch(route('GET', /history/, () => ({ ok: 1 })))
    const http = new GmailHttp({ getAccessToken: async () => 'TOK', fetch, ...noSleep })
    await http.get('/history', { historyTypes: ['messageAdded', 'labelAdded'], maxResults: 500, pageToken: undefined })
    expect(calls[0].url.href).toBe('https://gmail.googleapis.com/gmail/v1/users/me/history?historyTypes=messageAdded&historyTypes=labelAdded&maxResults=500')
    expect((calls[0].headers as Record<string, string>).Authorization).toBe('Bearer TOK')
    expect(buildUrl('/x')).toMatch(/users\/me\/x$/)
  })

  it('retries 429 and 5xx with backoff (honouring Retry-After) and then succeeds', async () => {
    const sleeps: number[] = []
    let n = 0
    const { fetch, calls } = fakeFetch(() => {
      n++
      if (n === 1) return json({ error: { message: 'slow down' } }, 429, { 'retry-after': '2' })
      if (n === 2) return json({ error: { message: 'boom' } }, 503)
      return json({ done: true })
    })
    const http = new GmailHttp({ getAccessToken: async () => 't', fetch, sleep: async (ms) => { sleeps.push(ms) }, random: () => 0 })
    await expect(http.get('/labels')).resolves.toEqual({ done: true })
    expect(calls).toHaveLength(3)
    expect(sleeps).toEqual([2000, 1000]) // Retry-After wins; then exponential 500*2^1
  })

  it('retries rate-limit 403s but not permission 403s or 404s', async () => {
    let n = 0
    const { fetch } = fakeFetch(() => (++n === 1 ? json({ error: { message: 'rl', errors: [{ reason: 'userRateLimitExceeded' }] } }, 403) : json({ ok: true })))
    await expect(new GmailHttp({ getAccessToken: async () => 't', fetch, ...noSleep }).get('/x')).resolves.toEqual({ ok: true })
    const perm = fakeFetch(() => json({ error: { message: 'nope', errors: [{ reason: 'insufficientPermissions' }] } }, 403))
    await expect(new GmailHttp({ getAccessToken: async () => 't', fetch: perm.fetch, ...noSleep }).get('/x')).rejects.toMatchObject({ status: 403, reason: 'insufficientPermissions' })
    expect(perm.calls).toHaveLength(1)
  })

  // Regression: a real account hit this during backfill. Gmail returns 403 (not 429) for its
  // per-user burst quota, and the reason string for "Quota exceeded for quota metric 'Queries'
  // and limit 'Queries per minute per user'" is literally 'quotaExceeded', a different string
  // from 'userRateLimitExceeded' -- both mean the same transient, retryable condition.
  it('retries a literal "quotaExceeded" 403 (not just rateLimitExceeded/userRateLimitExceeded)', async () => {
    let n = 0
    const { fetch, calls } = fakeFetch(() =>
      (++n === 1
        ? json({ error: { message: "Quota exceeded for quota metric 'Queries' and limit 'Queries per minute per user'", errors: [{ reason: 'quotaExceeded' }] } }, 403)
        : json({ ok: true }))
    )
    await expect(new GmailHttp({ getAccessToken: async () => 't', fetch, ...noSleep }).get('/x')).resolves.toEqual({ ok: true })
    expect(calls).toHaveLength(2)
  })

  it('a sustained quota 403 can outlast a ~100s rate-limit window before giving up (default retry budget)', async () => {
    const { fetch, calls } = fakeFetch(() => json({ error: { message: 'quota', errors: [{ reason: 'quotaExceeded' }] } }, 403))
    const sleeps: number[] = []
    const p = new GmailHttp({ getAccessToken: async () => 't', fetch, sleep: async (ms) => { sleeps.push(ms) }, random: () => 0 }).get('/x')
    await expect(p).rejects.toMatchObject({ status: 403, reason: 'quotaExceeded' })
    expect(calls.length).toBeGreaterThan(5) // old default (5) was not enough to span a real quota window
    expect(sleeps.reduce((a, b) => a + b, 0)).toBeGreaterThan(100_000)
  })

  it('gives up after maxRetries with a readable GmailApiError', async () => {
    const { fetch, calls } = fakeFetch(() => json({ error: { message: 'down' } }, 500))
    const p = new GmailHttp({ getAccessToken: async () => 't', fetch, maxRetries: 2, ...noSleep }).get('/x')
    await expect(p).rejects.toBeInstanceOf(GmailApiError)
    await expect(p).rejects.toThrow(/500: down/)
    expect(calls).toHaveLength(3)
  })

  it('retries network failures', async () => {
    let n = 0
    const fetchImpl = (async () => { if (++n === 1) throw new TypeError('fetch failed'); return json({ ok: 1 }) }) as unknown as typeof fetch
    await expect(new GmailHttp({ getAccessToken: async () => 't', fetch: fetchImpl, ...noSleep }).get('/x')).resolves.toEqual({ ok: 1 })
  })

  it('forces exactly one token refresh on 401, then reports rejected credentials', async () => {
    const tokens: boolean[] = []
    const rejected = vi.fn()
    const { fetch, calls } = fakeFetch(() => json({ error: { message: 'Invalid Credentials' } }, 401))
    const http = new GmailHttp({ getAccessToken: async (force) => { tokens.push(!!force); return 't' }, onAuthRejected: rejected, fetch, ...noSleep })
    await expect(http.get('/x')).rejects.toMatchObject({ status: 401 })
    expect(tokens).toEqual([false, true])
    expect(calls).toHaveLength(2)
    expect(rejected).toHaveBeenCalledOnce()
  })

  it('returns undefined for 204', async () => {
    const { fetch } = fakeFetch(() => new Response(null, { status: 204 }))
    await expect(new GmailHttp({ getAccessToken: async () => 't', fetch }).delete('/labels/x')).resolves.toBeUndefined()
  })
})

describe('pool', () => {
  it('bounds concurrency and preserves order', async () => {
    let active = 0, peak = 0
    const out = await pool([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
      active++; peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 5 - (n % 3)))
      active--
      return n * 2
    })
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14, 16])
    expect(peak).toBe(3)
  })
})

describe('google oauth helpers', () => {
  const client = { clientId: 'cid', clientSecret: 'sec' }
  it('builds an offline PKCE consent URL with the gmail.modify scope', () => {
    const u = new URL(buildAuthUrl(client, 'http://127.0.0.1:5555', 'st', 'chal'))
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    const q = Object.fromEntries(u.searchParams)
    expect(q).toMatchObject({
      client_id: 'cid', redirect_uri: 'http://127.0.0.1:5555', response_type: 'code', code_challenge: 'chal', code_challenge_method: 'S256',
      state: 'st', access_type: 'offline', prompt: 'consent'
    })
    expect(q.scope.split(' ')).toEqual(['openid', 'email', 'profile', 'https://www.googleapis.com/auth/gmail.modify'])
  })
  it('exchanges the code including client_secret and the PKCE verifier', async () => {
    const { fetch, calls } = fakeFetch(route('POST', /\/token$/, () => ({ access_token: 'A', refresh_token: 'R', expires_in: 3600, scope: 'x' })))
    const t = await exchangeCode(client, 'CODE', 'VER', 'http://127.0.0.1:1', fetch)
    const body = new URLSearchParams(calls[0].rawBody)
    expect(Object.fromEntries(body)).toMatchObject({ client_secret: 'sec', code: 'CODE', code_verifier: 'VER', grant_type: 'authorization_code', redirect_uri: 'http://127.0.0.1:1' })
    expect(t).toMatchObject({ accessToken: 'A', refreshToken: 'R' })
    expect(t.expiresAt).toBeGreaterThan(Date.now() + 3_500_000)
  })
  it('keeps the old refresh token on refresh and surfaces invalid_grant as a coded error', async () => {
    const ok = fakeFetch(route('POST', /\/token$/, () => ({ access_token: 'NEW', expires_in: 100 })))
    expect(await refreshAccessToken(client, 'OLD', ok.fetch)).toMatchObject({ accessToken: 'NEW', refreshToken: 'OLD' })
    const bad = fakeFetch(() => json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400))
    await expect(refreshAccessToken(client, 'OLD', bad.fetch)).rejects.toMatchObject({ code: 'invalid_grant' })
    await expect(refreshAccessToken({ clientId: '', clientSecret: '' }, 'OLD', ok.fetch)).rejects.toThrow(/OAuth setup/)
  })
  it('reads userinfo and rejects a response without an email', async () => {
    expect(await fetchUserInfo('T', fakeFetch(() => json({ email: 'a@b.c', name: 'A' })).fetch)).toMatchObject({ email: 'a@b.c' })
    await expect(fetchUserInfo('T', fakeFetch(() => json({})).fetch)).rejects.toThrow(/email/)
  })
  it('creates colon-free stable account ids', () => {
    const sha = (s: string): string => 'abcdef0123456789'.repeat(3) + s.length
    const id = accountIdFor('Anthony.Russo+tag@Gmail.com', sha)
    expect(id).toBe('gmail-anthony-russo-tag-gmail-com-abcdef')
    expect(id).not.toContain(':')
    expect(accountIdFor('anthony.russo+tag@gmail.com', sha)).toBe(id)
    expect(toStoredTokens({ access_token: 'a', expires_in: 1 }, 'keep', 0)).toEqual({ accessToken: 'a', refreshToken: 'keep', expiresAt: 1000, scope: undefined })
  })
})
