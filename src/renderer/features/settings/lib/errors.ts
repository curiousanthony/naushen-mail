import type { AppSettings, ProviderKind } from '@shared/types'

export interface FriendlyError {
  message: string
  /** When set the UI offers a shortcut to the OAuth setup guide. */
  hint?: 'oauth-setup'
}

/** Electron wraps main-process errors as "Error invoking remote method 'api:x': Error: msg". */
export function cleanIpcError(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === 'string' ? e : 'Unknown error'
  return raw
    .replace(/^Error invoking remote method '[^']+':\s*/, '')
    .replace(/^(Error|TypeError):\s*/, '')
    .trim()
}

export const PROVIDER_LABEL: Record<ProviderKind, string> = { gmail: 'Gmail', outlook: 'Outlook', mock: 'Demo' }

/** Returns a message when the OAuth client for this provider has not been configured yet. */
export function missingCredentials(provider: ProviderKind, oauth: AppSettings['oauth']): FriendlyError | null {
  if (provider === 'gmail' && !oauth.googleClientId.trim()) {
    return { message: 'Add your Google OAuth client ID first. Mailroom has no backend, so you create the (free) OAuth app yourself.', hint: 'oauth-setup' }
  }
  if (provider === 'outlook' && !oauth.microsoftClientId.trim()) {
    return { message: 'Add your Microsoft application (client) ID first. Mailroom has no backend, so you register the (free) app yourself.', hint: 'oauth-setup' }
  }
  return null
}

export function friendlyConnectError(provider: ProviderKind, e: unknown): FriendlyError {
  const msg = cleanIpcError(e)
  const name = PROVIDER_LABEL[provider]
  if (/client[\s_-]?id|client[\s_-]?secret|not configured|invalid_client|unauthorized_client|AADSTS700016|AADSTS7000218/i.test(msg)) {
    return { message: `${name} rejected the OAuth client. Check the credentials in OAuth setup below. (${msg})`, hint: 'oauth-setup' }
  }
  if (/redirect[\s_-]?uri|AADSTS50011/i.test(msg)) {
    return { message: `${name} rejected the redirect address. Follow the redirect step in OAuth setup exactly. (${msg})`, hint: 'oauth-setup' }
  }
  if (/not available in this build/i.test(msg)) return { message: `The ${name} connector is not available in this build of Mailroom.` }
  if (/timed out/i.test(msg)) return { message: 'Sign-in timed out. Try again and finish signing in within a few minutes.' }
  if (/access_denied|cancel/i.test(msg)) return { message: 'Sign-in was cancelled. Nothing was connected.' }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network|fetch failed|offline/i.test(msg)) return { message: `Couldn't reach ${name}. Check your internet connection and try again.` }
  return { message: msg || `Couldn't connect ${name}. Try again.` }
}

const GOOGLE_ID = /^[\w-]+\.apps\.googleusercontent\.com$/i
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Soft validation for the OAuth fields. Returns a hint (not a blocker) or null when fine/empty. */
export function validateGoogleClientId(v: string): string | null {
  const t = v.trim()
  return !t || GOOGLE_ID.test(t) ? null : 'Google client IDs end in .apps.googleusercontent.com'
}
export function validateMicrosoftClientId(v: string): string | null {
  const t = v.trim()
  return !t || GUID.test(t) ? null : 'Expected a GUID like 00000000-0000-0000-0000-000000000000'
}
