/** Google OAuth constants + pure (fetch-only) helpers. No Electron imports so they are unit-testable. */
import type { StoredTokens } from '../types'

export const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
export const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'
export const GMAIL_MODIFY_SCOPE = 'https://www.googleapis.com/auth/gmail.modify'
export const SCOPES = ['openid', 'email', 'profile', GMAIL_MODIFY_SCOPE]

export const MISSING_CLIENT_MESSAGE =
  'Add your Google OAuth client ID and secret in Settings → Accounts → OAuth setup before connecting Gmail.'

export interface OAuthClient { clientId: string; clientSecret: string }

export function buildAuthUrl(client: OAuthClient, redirectUri: string, state: string, challenge: string, loginHint?: string): string {
  const q = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    access_type: 'offline',
    prompt: 'consent'
  })
  if (loginHint) q.set('login_hint', loginHint)
  return `${AUTH_URL}?${q.toString()}`
}

export interface TokenResponse {
  access_token: string
  expires_in: number
  refresh_token?: string
  scope?: string
  id_token?: string
  token_type?: string
}

export class OAuthError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message)
    this.name = 'OAuthError'
  }
}

async function postForm<T>(url: string, body: Record<string, string>, doFetch: typeof fetch): Promise<T> {
  const r = await doFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) })
  const text = await r.text()
  let json: unknown
  try { json = JSON.parse(text) } catch { json = { error: text } }
  if (!r.ok) {
    const j = json as { error?: string; error_description?: string }
    throw new OAuthError(`${j.error ?? r.status}: ${j.error_description ?? ''}`.trim(), j.error)
  }
  return json as T
}

export function toStoredTokens(r: TokenResponse, previousRefresh?: string, now = Date.now()): StoredTokens {
  return {
    accessToken: r.access_token,
    refreshToken: r.refresh_token ?? previousRefresh ?? '',
    expiresAt: now + r.expires_in * 1000,
    scope: r.scope
  }
}

export async function exchangeCode(
  client: OAuthClient, code: string, verifier: string, redirectUri: string, doFetch: typeof fetch = fetch
): Promise<StoredTokens> {
  const r = await postForm<TokenResponse>(TOKEN_URL, {
    client_id: client.clientId,
    client_secret: client.clientSecret,
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code'
  }, doFetch)
  return toStoredTokens(r)
}

/** Refresh: Google returns a new access token but NOT a new refresh token, so the caller keeps the old one. */
export async function refreshAccessToken(client: OAuthClient, refreshToken: string, doFetch: typeof fetch = fetch): Promise<StoredTokens> {
  if (!client.clientId || !client.clientSecret) throw new OAuthError(MISSING_CLIENT_MESSAGE, 'missing_client')
  const r = await postForm<TokenResponse>(TOKEN_URL, {
    client_id: client.clientId,
    client_secret: client.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  }, doFetch)
  return toStoredTokens(r, refreshToken)
}

export interface UserInfo { email: string; name?: string; picture?: string; sub?: string }

export async function fetchUserInfo(accessToken: string, doFetch: typeof fetch = fetch): Promise<UserInfo> {
  const r = await doFetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!r.ok) throw new OAuthError(`Could not read your Google profile (HTTP ${r.status}).`)
  const j = (await r.json()) as UserInfo
  if (!j.email) throw new OAuthError('Google did not return an email address for this account.')
  return j
}

export async function revokeToken(token: string, doFetch: typeof fetch = fetch): Promise<void> {
  await doFetch(REVOKE_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }) })
}

/** Stable, colon-free local account id for an email address: `gmail-<slug>-<6 hex of sha1>`. */
export function accountIdFor(email: string, sha1Hex: (s: string) => string): string {
  const e = email.trim().toLowerCase()
  const slug = e.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return `gmail-${slug}-${sha1Hex(e).slice(0, 6)}`
}
