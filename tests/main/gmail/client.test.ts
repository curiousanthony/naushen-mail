import { describe, expect, it } from 'vitest'
import { builtInGoogleClient, requireGoogleClient, resolveGoogleClient } from '../../../src/main/providers/gmail/auth'

const BUILT = { clientId: 'built.apps.googleusercontent.com', clientSecret: 'built-secret' }

describe('builtInGoogleClient', () => {
  it('needs both env values, trimmed', () => {
    expect(builtInGoogleClient({ MAIN_VITE_GOOGLE_CLIENT_ID: ' id ', MAIN_VITE_GOOGLE_CLIENT_SECRET: ' s ' })).toEqual({ clientId: 'id', clientSecret: 's' })
    expect(builtInGoogleClient({ MAIN_VITE_GOOGLE_CLIENT_ID: 'id', MAIN_VITE_GOOGLE_CLIENT_SECRET: '' })).toBeNull()
    expect(builtInGoogleClient({ MAIN_VITE_GOOGLE_CLIENT_ID: '', MAIN_VITE_GOOGLE_CLIENT_SECRET: 's' })).toBeNull()
    expect(builtInGoogleClient({})).toBeNull()
  })
})

describe('resolveGoogleClient', () => {
  it('prefers a complete user override', () => {
    expect(resolveGoogleClient({ googleClientId: ' mine ', googleClientSecret: ' sec ' }, BUILT)).toEqual({ clientId: 'mine', clientSecret: 'sec' })
  })
  it('falls back to the built-in client when the override is empty or partial', () => {
    expect(resolveGoogleClient({ googleClientId: '', googleClientSecret: '' }, BUILT)).toEqual(BUILT)
    expect(resolveGoogleClient({ googleClientId: 'mine', googleClientSecret: '  ' }, BUILT)).toEqual(BUILT)
    expect(resolveGoogleClient(undefined, BUILT)).toEqual(BUILT)
  })
  it('is null with neither, and requireGoogleClient throws a coded error', () => {
    expect(resolveGoogleClient({ googleClientId: '', googleClientSecret: '' }, null)).toBeNull()
    expect(() => requireGoogleClient({ googleClientId: '', googleClientSecret: '' }, null)).toThrow(/OAuth/)
    try { requireGoogleClient(undefined, null) } catch (e) { expect((e as { code?: string }).code).toBe('missing_client') }
  })
})
