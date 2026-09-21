import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ shell: { openExternal: vi.fn() }, safeStorage: { isEncryptionAvailable: () => false } }))
const { loopback } = vi.hoisted(() => ({ loopback: vi.fn() }))
vi.mock('../../../src/main/auth/oauth', async (orig) => ({ ...(await orig<typeof import('../../../src/main/auth/oauth')>()), loopbackAuth: loopback }))

import { openDb } from '../../../src/main/db/db'
import { Repo } from '../../../src/main/db/repo'
import { connectors } from '../../../src/main/accounts'
import { loadTokens } from '../../../src/main/auth/tokens'
import '../../../src/main/providers/outlook/register'
import { AUTHORIZE_URL, SCOPES, TOKEN_URL } from '../../../src/main/providers/outlook/auth'
import { fakeFetch } from './fake'
import { gmsg, FOLDERS } from './fake'
import { buildThread } from '../../../src/main/providers/outlook/mapping'
import type { Account } from '../../../src/shared/types'

let repo: Repo
beforeEach(() => { repo = new Repo(openDb(':memory:')); loopback.mockReset(); vi.unstubAllGlobals() })

describe('connectors.outlook', () => {
  it('registers itself', () => {
    expect(connectors.outlook).toBeDefined()
  })

  it('connect() without a client id fails with a pointer to Settings', async () => {
    await expect(connectors.outlook!.connect({ repo })).rejects.toThrow(/Settings → Accounts → OAuth setup/)
    expect(loopback).not.toHaveBeenCalled()
  })

  it('connect(): PKCE loopback on localhost, secret-less token exchange, /me identity, tokens saved, adapter returned', async () => {
    repo.setSettings({ oauth: { googleClientId: '', googleClientSecret: '', microsoftClientId: 'cid-42' } })
    let authUrl = ''
    loopback.mockImplementation(async (build: (r: string, s: string) => string, opts: { host?: string }) => {
      authUrl = build('http://localhost:5555', 'STATE')
      expect(opts.host).toBe('localhost')
      return { code: 'the-code', redirectUri: 'http://localhost:5555' }
    })
    const f = fakeFetch([
      (c) => (c.url === TOKEN_URL ? { json: { access_token: 'at', refresh_token: 'rt', expires_in: 3599, scope: SCOPES } } : undefined),
      (c) => (c.path === '/me' ? { json: { displayName: 'Anthony R', mail: null, userPrincipalName: 'Anthony@Outlook.com' } } : undefined)
    ])
    vi.stubGlobal('fetch', f.fetchImpl)

    const { account, adapter } = await connectors.outlook!.connect({ repo })

    const u = new URL(authUrl)
    expect(authUrl.startsWith(AUTHORIZE_URL)).toBe(true)
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      client_id: 'cid-42', response_type: 'code', redirect_uri: 'http://localhost:5555', scope: SCOPES, state: 'STATE', code_challenge_method: 'S256'
    })
    expect(u.searchParams.get('code_challenge')).toMatch(/^[\w-]{43}$/)
    const form = Object.fromEntries(new URLSearchParams(String(f.calls[0].body)))
    expect(form).toMatchObject({ client_id: 'cid-42', code: 'the-code', grant_type: 'authorization_code', redirect_uri: 'http://localhost:5555' })
    expect(form.code_verifier).toMatch(/^[\w-]{40,}$/)
    expect(form.client_secret).toBeUndefined()
    expect(f.calls[1].headers.authorization).toBe('Bearer at')

    expect(account).toMatchObject({ id: 'outlook-anthony-outlook-com', provider: 'outlook', email: 'Anthony@Outlook.com', name: 'Anthony R', status: 'ok' })
    expect(adapter.kind).toBe('outlook')
    expect(adapter.accountId).toBe(account.id)
    const saved = loadTokens(repo, account.id)!
    expect(saved).toMatchObject({ accessToken: 'at', refreshToken: 'rt' })
    expect(saved.expiresAt).toBeGreaterThan(Date.now() + 3_000_000)

    connectors.outlook!.forget!(account)
    expect(loadTokens(repo, account.id)).toBeNull()
  })

  it('restore() rebuilds an adapter whose removed-message lookup reads the local store', () => {
    const account: Account = { id: 'outlook-x', provider: 'outlook', email: 'x@outlook.com', name: 'X', color: '#000', createdAt: 1, syncCursor: null, lastSyncAt: null, status: 'ok' }
    repo.upsertAccount(account)
    const adapter = connectors.outlook!.restore(account, { repo })!
    expect(adapter.kind).toBe('outlook')
    const wk: Record<string, string> = Object.fromEntries(Object.entries(FOLDERS).map(([k, v]) => [v, k]))
    const t = buildThread('CONV9', [gmsg('msg-77', 'CONV9', 'inbox')], { accountId: 'outlook-x', knownCategories: new Set(), folderRole: (id) => (id && wk[id] ? { wk: wk[id] as never, role: 'inbox' } : undefined) })!
    repo.upsertNormalized(t)
    const lookup = (adapter as unknown as { deps: { lookupConversation(id: string): string | undefined } }).deps.lookupConversation
    expect(lookup('msg-77')).toBe('CONV9')
    expect(lookup('nope')).toBeUndefined()
  })

  it('a dead refresh token marks the account for re-auth in the store', async () => {
    const account: Account = { id: 'outlook-y', provider: 'outlook', email: 'y@outlook.com', name: 'Y', color: '#000', createdAt: 1, syncCursor: null, lastSyncAt: null, status: 'ok' }
    repo.upsertAccount(account)
    repo.setSettings({ oauth: { googleClientId: '', googleClientSecret: '', microsoftClientId: 'cid' } })
    const { saveTokens } = await import('../../../src/main/auth/tokens')
    saveTokens(repo, account.id, { accessToken: 'a', refreshToken: 'r', expiresAt: 0 })
    vi.stubGlobal('fetch', fakeFetch([() => ({ status: 400, json: { error: 'invalid_grant', error_description: 'expired' } })]).fetchImpl)
    const adapter = connectors.outlook!.restore(account, { repo })!
    await expect(adapter.sync(null)).rejects.toThrow(/expired|Reconnect/i)
    expect(repo.getAccount('outlook-y')!.status).toBe('reauth')
  })
})
