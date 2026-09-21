import { safeStorage } from 'electron'
import type { Repo } from '../db/repo'
import type { StoredTokens } from '../providers/types'

/**
 * OAuth tokens are encrypted with Electron safeStorage (macOS Keychain-backed key) and stored in
 * the local kv table as base64. Falls back to plaintext-in-app-data ONLY if encryption is unavailable.
 */
const key = (accountId: string): string => `tokens:${accountId}`

export function saveTokens(repo: Repo, accountId: string, t: StoredTokens): void {
  const json = JSON.stringify(t)
  const v = safeStorage.isEncryptionAvailable() ? 'e:' + safeStorage.encryptString(json).toString('base64') : 'p:' + Buffer.from(json).toString('base64')
  repo.kvSet(key(accountId), v)
}

export function loadTokens(repo: Repo, accountId: string): StoredTokens | null {
  const v = repo.kvGet(key(accountId))
  if (!v) return null
  try {
    const raw = v.slice(2)
    const json = v.startsWith('e:') ? safeStorage.decryptString(Buffer.from(raw, 'base64')) : Buffer.from(raw, 'base64').toString()
    return JSON.parse(json) as StoredTokens
  } catch { return null }
}

export function deleteTokens(repo: Repo, accountId: string): void {
  repo.db.prepare('DELETE FROM kv WHERE key = ?').run(key(accountId))
}

/** Returns a valid access token, refreshing via `refresh` when within 60s of expiry. */
export async function ensureAccessToken(
  get: () => StoredTokens | null,
  save: (t: StoredTokens) => void,
  refresh: (refreshToken: string) => Promise<StoredTokens>,
  onReauth: (msg: string) => void
): Promise<string> {
  const t = get()
  if (!t) { onReauth('Not signed in'); throw new Error('Not signed in') }
  if (t.expiresAt - 60_000 > Date.now()) return t.accessToken
  try {
    const next = await refresh(t.refreshToken)
    const merged = { ...t, ...next, refreshToken: next.refreshToken || t.refreshToken }
    save(merged)
    return merged.accessToken
  } catch (e) {
    const code = (e as { code?: string }).code
    if (code === 'invalid_grant' || code === 'interaction_required') onReauth('Your session expired. Sign in again.')
    throw e
  }
}
