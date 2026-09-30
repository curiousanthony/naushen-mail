import i18n from 'i18next'
import type { AppSettings, ProviderKind } from '@shared/types'

const t = (key: string, options?: Record<string, unknown>): string => i18n.t(key, { ns: 'settings', ...options }) as string

export interface FriendlyError {
  message: string
  /** When set the UI offers a shortcut to the OAuth setup guide. */
  hint?: 'oauth-setup'
}

/** Electron wraps main-process errors as "Error invoking remote method 'api:x': Error: msg". */
export function cleanIpcError(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === 'string' ? e : t('errors.unknown')
  return raw
    .replace(/^Error invoking remote method '[^']+':\s*/, '')
    .replace(/^(Error|TypeError):\s*/, '')
    .trim()
}

/** Provider names are product names and are not translated; only the demo account's label is. */
export const providerLabel = (p: ProviderKind): string => (p === 'gmail' ? 'Gmail' : p === 'outlook' ? 'Outlook' : t('providers.demo'))

/**
 * Returns a message when the OAuth client for this provider has not been configured yet.
 * With a built-in Google client (release builds) Gmail never needs your own credentials.
 */
export function missingCredentials(provider: ProviderKind, oauth: AppSettings['oauth'], builtInGoogle = false): FriendlyError | null {
  if (provider === 'gmail' && !builtInGoogle && !oauth.googleClientId.trim()) {
    return { message: t('errors.missingGoogle'), hint: 'oauth-setup' }
  }
  if (provider === 'outlook' && !oauth.microsoftClientId.trim()) {
    return { message: t('errors.missingMicrosoft'), hint: 'oauth-setup' }
  }
  return null
}

export function friendlyConnectError(provider: ProviderKind, e: unknown): FriendlyError {
  const msg = cleanIpcError(e)
  const name = providerLabel(provider)
  if (/client[\s_-]?id|client[\s_-]?secret|not configured|invalid_client|unauthorized_client|AADSTS700016|AADSTS7000218/i.test(msg)) {
    return { message: t('errors.clientRejected', { name, msg }), hint: 'oauth-setup' }
  }
  if (/redirect[\s_-]?uri|AADSTS50011/i.test(msg)) {
    return { message: t('errors.redirectRejected', { name, msg }), hint: 'oauth-setup' }
  }
  if (/not available in this build/i.test(msg)) return { message: t('errors.notInBuild', { name }) }
  if (/timed out/i.test(msg)) return { message: t('errors.timedOut') }
  if (/access_denied|cancel/i.test(msg)) return { message: t('errors.cancelled') }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network|fetch failed|offline/i.test(msg)) return { message: t('errors.offline', { name }) }
  return { message: msg || t('errors.generic', { name }) }
}

const GOOGLE_ID = /^[\w-]+\.apps\.googleusercontent\.com$/i
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Soft validation for the OAuth fields. Returns a hint (not a blocker) or null when fine/empty. */
export function validateGoogleClientId(v: string): string | null {
  const s = v.trim()
  return !s || GOOGLE_ID.test(s) ? null : t('errors.googleIdFormat')
}
export function validateMicrosoftClientId(v: string): string | null {
  const s = v.trim()
  return !s || GUID.test(s) ? null : t('errors.guidFormat')
}
