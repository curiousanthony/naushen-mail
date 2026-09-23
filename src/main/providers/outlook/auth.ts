import { pkce, loopbackAuth, postForm } from '../../auth/oauth'
import { ensureAccessToken } from '../../auth/tokens'
import type { StoredTokens } from '../types'
import { GraphClient, ReauthRequiredError, type TokenSource } from './graph'

export const AUTHORIZE_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
export const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
export const SCOPES = 'openid profile email offline_access User.Read Mail.ReadWrite Mail.Send MailboxSettings.ReadWrite'

export const MISSING_CLIENT_ID = 'Add your Microsoft Application (client) ID first: Settings → Accounts → OAuth setup.'

interface TokenResponse { access_token: string; refresh_token?: string; expires_in: number; scope?: string }

const toStored = (r: TokenResponse, prevRefresh = ''): StoredTokens => ({
  accessToken: r.access_token, refreshToken: r.refresh_token || prevRefresh, expiresAt: Date.now() + r.expires_in * 1000, scope: r.scope
})

/**
 * Interactive sign-in: system browser + loopback redirect (registered as http://localhost, the port is ignored by Entra) + PKCE.
 * Public client: NO client secret. Node's fetch sends no `Origin` header, which is what makes Entra treat this as a native app
 * (an Origin header would trigger AADSTS9002327 "SPA-only" errors) — do not switch this to a browser-context fetch.
 */
export async function signIn(clientId: string): Promise<StoredTokens> {
  if (!clientId.trim()) throw new Error(MISSING_CLIENT_ID)
  const { verifier, challenge } = pkce()
  const { code, redirectUri } = await loopbackAuth((redirectUri, state) => {
    const q = new URLSearchParams({
      client_id: clientId, response_type: 'code', redirect_uri: redirectUri, response_mode: 'query', scope: SCOPES, state,
      code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account'
    })
    return `${AUTHORIZE_URL}?${q.toString()}`
  }, { host: 'localhost' })
  const res = await postForm<TokenResponse>(TOKEN_URL, {
    client_id: clientId, scope: SCOPES, code, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier
  })
  return toStored(res)
}

/** Microsoft rotates refresh tokens: the returned one replaces the stored one (ensureAccessToken persists it before use). */
export async function refreshTokens(clientId: string, refreshToken: string): Promise<StoredTokens> {
  if (!clientId.trim()) throw new Error(MISSING_CLIENT_ID)
  const res = await postForm<TokenResponse>(TOKEN_URL, { client_id: clientId, scope: SCOPES, refresh_token: refreshToken, grant_type: 'refresh_token' })
  return toStored(res, refreshToken)
}

export interface TokenSourceDeps {
  getTokens(): StoredTokens | null
  saveTokens(t: StoredTokens): void
  getClientId(): string
  markReauthNeeded(message: string): void
}

/**
 * TokenSource backed by ensureAccessToken. `force` (Graph answered 401) expires the stored token first so a refresh happens.
 * Dead refresh tokens (invalid_grant / interaction_required) flag the account for re-auth and stop further attempts.
 */
export function createTokenSource(d: TokenSourceDeps): TokenSource {
  let reauth: string | null = null
  const onReauth = (msg: string): void => { reauth = msg; d.markReauthNeeded(msg) }
  return {
    async get(force = false): Promise<string> {
      if (reauth) throw new ReauthRequiredError(reauth)
      if (force) { const t = d.getTokens(); if (t) d.saveTokens({ ...t, expiresAt: 0 }) }
      try {
        return await ensureAccessToken(d.getTokens, d.saveTokens, (rt) => refreshTokens(d.getClientId(), rt), onReauth)
      } catch (e) {
        if (reauth) throw new ReauthRequiredError(reauth)
        throw e
      }
    }
  }
}

/** GET /me with a bare access token: identity for a fresh sign-in. */
export async function fetchProfile(accessToken: string, fetchImpl?: typeof fetch): Promise<{ email: string; name: string }> {
  const c = new GraphClient({ tokens: { get: async () => accessToken }, fetchImpl, maxRetries: 2 })
  const me = await c.get<{ displayName?: string; mail?: string | null; userPrincipalName?: string }>('/me', { query: { $select: 'id,displayName,mail,userPrincipalName' } })
  const email = (me.mail || me.userPrincipalName || '').trim()
  if (!email) throw new Error('Microsoft did not return an email address for this account.')
  return { email, name: me.displayName?.trim() || email }
}
