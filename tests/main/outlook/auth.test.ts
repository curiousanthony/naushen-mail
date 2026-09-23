import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ shell: { openExternal: vi.fn() }, safeStorage: { isEncryptionAvailable: () => false } }))

import { createTokenSource, fetchProfile, refreshTokens, SCOPES, TOKEN_URL } from '../../../src/main/providers/outlook/auth'
import { outlookAccountId } from '../../../src/main/providers/outlook/register'
import { ReauthRequiredError } from '../../../src/main/providers/outlook/graph'
import type { StoredTokens } from '../../../src/main/providers/types'
import { fakeFetch } from './fake'

let stored: StoredTokens | null
const fresh = (): StoredTokens => ({ accessToken: 'old-at', refreshToken: 'old-rt', expiresAt: Date.now() + 3600_000 })
const deps = (over = {}) => ({
  getTokens: () => stored, saveTokens: vi.fn((t: StoredTokens) => { stored = t }), getClientId: () => 'client-123', markReauthNeeded: vi.fn(), ...over
})
const tokenReply = (over = {}) => ({ json: { access_token: 'new-at', refresh_token: 'new-rt', expires_in: 3600, scope: SCOPES, ...over } })

beforeEach(() => { stored = fresh(); vi.unstubAllGlobals() })

describe('token source', () => {
  it('returns the stored token while it is valid (no network)', async () => {
    const f = fakeFetch(); vi.stubGlobal('fetch', f.fetchImpl)
    expect(await createTokenSource(deps()).get()).toBe('old-at')
    expect(f.calls).toHaveLength(0)
  })

  it('refreshes near expiry with a public-client request (no secret) and stores the rotated refresh token', async () => {
    stored = { ...fresh(), expiresAt: Date.now() + 10_000 }
    const f = fakeFetch([() => tokenReply()]); vi.stubGlobal('fetch', f.fetchImpl)
    const d = deps()
    expect(await createTokenSource(d).get()).toBe('new-at')
    expect(f.calls[0].url).toBe(TOKEN_URL)
    const form = new URLSearchParams(String(f.calls[0].body instanceof URLSearchParams ? f.calls[0].body : f.calls[0].body))
    expect(Object.fromEntries(form)).toEqual({ client_id: 'client-123', scope: SCOPES, refresh_token: 'old-rt', grant_type: 'refresh_token' })
    expect(form.has('client_secret')).toBe(false)
    expect(stored).toMatchObject({ accessToken: 'new-at', refreshToken: 'new-rt' })
    expect(stored!.expiresAt).toBeGreaterThan(Date.now() + 3_000_000)
  })

  it('keeps the old refresh token when the response omits one', async () => {
    stored = { ...fresh(), expiresAt: 0 }
    vi.stubGlobal('fetch', fakeFetch([() => tokenReply({ refresh_token: undefined })]).fetchImpl)
    await createTokenSource(deps()).get()
    expect(stored!.refreshToken).toBe('old-rt')
  })

  it('force (Graph said 401) refreshes even though the token looks valid', async () => {
    const f = fakeFetch([() => tokenReply()]); vi.stubGlobal('fetch', f.fetchImpl)
    expect(await createTokenSource(deps()).get(true)).toBe('new-at')
    expect(f.calls).toHaveLength(1)
  })

  it('invalid_grant flags the account for re-auth and stops retrying', async () => {
    stored = { ...fresh(), expiresAt: 0 }
    const f = fakeFetch([() => ({ status: 400, json: { error: 'invalid_grant', error_description: 'AADSTS700082: expired' } })]); vi.stubGlobal('fetch', f.fetchImpl)
    const d = deps()
    const src = createTokenSource(d)
    await expect(src.get()).rejects.toBeInstanceOf(ReauthRequiredError)
    expect(d.markReauthNeeded).toHaveBeenCalledTimes(1)
    await expect(src.get()).rejects.toBeInstanceOf(ReauthRequiredError)
    expect(f.calls).toHaveLength(1) // second call short-circuits, no more token requests
  })

  it('interaction_required also triggers re-auth; other failures do not', async () => {
    stored = { ...fresh(), expiresAt: 0 }
    vi.stubGlobal('fetch', fakeFetch([() => ({ status: 400, json: { error: 'interaction_required' } })]).fetchImpl)
    const d1 = deps(); await expect(createTokenSource(d1).get()).rejects.toBeInstanceOf(ReauthRequiredError); expect(d1.markReauthNeeded).toHaveBeenCalled()
    vi.stubGlobal('fetch', fakeFetch([() => ({ status: 500, json: { error: 'server_error' } })]).fetchImpl)
    const d2 = deps(); await expect(createTokenSource(d2).get()).rejects.not.toBeInstanceOf(ReauthRequiredError); expect(d2.markReauthNeeded).not.toHaveBeenCalled()
  })

  it('not signed in => re-auth', async () => {
    stored = null
    const d = deps()
    await expect(createTokenSource(d).get()).rejects.toBeInstanceOf(ReauthRequiredError)
    expect(d.markReauthNeeded).toHaveBeenCalled()
  })

  it('refreshTokens demands a client id', async () => {
    await expect(refreshTokens('', 'rt')).rejects.toThrow(/Settings → Accounts → OAuth setup/)
  })
})

describe('profile & account id', () => {
  it('uses mail, falling back to userPrincipalName', async () => {
    const f = fakeFetch([() => ({ json: { displayName: 'Ann', mail: null, userPrincipalName: 'ann@outlook.com' } })])
    expect(await fetchProfile('tok', f.fetchImpl)).toEqual({ email: 'ann@outlook.com', name: 'Ann' })
    expect(f.calls[0].query.get('$select')).toContain('userPrincipalName')
    expect(f.calls[0].headers.authorization).toBe('Bearer tok')
    const f2 = fakeFetch([() => ({ json: { mail: 'a@b.co' } })])
    expect(await fetchProfile('t', f2.fetchImpl)).toEqual({ email: 'a@b.co', name: 'a@b.co' })
  })
  it('slugs the account id', () => {
    expect(outlookAccountId('Anthony.R+x@Outlook.com')).toBe('outlook-anthony-r-x-outlook-com')
  })
})
