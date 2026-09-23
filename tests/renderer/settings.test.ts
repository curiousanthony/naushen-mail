import { describe, expect, it } from 'vitest'
import type { AppSettings, View } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { EXT_DEFAULTS, extPatch, readExt } from '@/features/settings/lib/settings-ext'
import { cleanIpcError, friendlyConnectError, missingCredentials, validateGoogleClientId, validateMicrosoftClientId } from '@/features/settings/lib/errors'
import { accountStatus } from '@/features/settings/lib/account-status'
import {
  htmlToPreview, loadSnippets, normalizeShortcut, parseSnippets, saveSnippets, shortcutTaken, SNIPPETS_KEY, upsertSnippet
} from '@/features/settings/lib/snippets'
import { describeFilter, dropOrder, moveView, reorderViews } from '@/features/settings/lib/views'
import { normalizeUrl } from '@/features/settings/lib/links'

const view = (id: string, position: number, extra: Partial<View> = {}): View => ({ id, name: id, filter: {}, position, showInSidebar: true, showAsTab: false, ...extra })
const memStore = (): Pick<Storage, 'getItem' | 'setItem'> & { data: Record<string, string> } => {
  const data: Record<string, string> = {}
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v } }
}

describe('settings extension fields', () => {
  it('falls back to defaults for missing or invalid values', () => {
    expect(readExt(DEFAULT_SETTINGS)).toEqual(EXT_DEFAULTS)
    const bad = { ...DEFAULT_SETTINGS, threadStyle: 'sideways', autoAdvance: 3, signatureInReplies: 'yes' } as unknown as AppSettings
    expect(readExt(bad)).toEqual(EXT_DEFAULTS)
  })
  it('reads valid values', () => {
    const s = { ...DEFAULT_SETTINGS, ...extPatch({ threadStyle: 'full', autoAdvance: 'close', signatureInReplies: false }) }
    expect(readExt(s)).toEqual({ threadStyle: 'full', autoAdvance: 'close', signatureInReplies: false })
  })
})

describe('connect errors', () => {
  const empty = DEFAULT_SETTINGS.oauth
  it('flags missing credentials before opening the browser', () => {
    expect(missingCredentials('gmail', empty)?.hint).toBe('oauth-setup')
    expect(missingCredentials('outlook', empty)?.hint).toBe('oauth-setup')
    expect(missingCredentials('mock', empty)).toBeNull()
    expect(missingCredentials('gmail', { ...empty, googleClientId: 'x.apps.googleusercontent.com' })).toBeNull()
    expect(missingCredentials('outlook', { ...empty, microsoftClientId: '  ' })).not.toBeNull()
  })
  it('strips the Electron IPC wrapper', () => {
    expect(cleanIpcError(new Error("Error invoking remote method 'api:accounts.connect': Error: Sign-in timed out"))).toBe('Sign-in timed out')
  })
  it('maps common failures to friendly messages', () => {
    expect(friendlyConnectError('gmail', new Error('invalid_client: Unauthorized')).hint).toBe('oauth-setup')
    expect(friendlyConnectError('outlook', new Error('AADSTS50011 redirect')).hint).toBe('oauth-setup')
    expect(friendlyConnectError('gmail', new Error('Sign-in timed out')).message).toMatch(/timed out/i)
    expect(friendlyConnectError('gmail', new Error('access_denied')).message).toMatch(/cancelled/i)
    expect(friendlyConnectError('outlook', new Error('The outlook connector is not available in this build.')).message).toMatch(/not available/)
    expect(friendlyConnectError('gmail', new Error('fetch failed')).message).toMatch(/internet/)
    expect(friendlyConnectError('gmail', 'weird thing').message).toBe('weird thing')
  })
  it('soft-validates client ids', () => {
    expect(validateGoogleClientId('')).toBeNull()
    expect(validateGoogleClientId('123-abc.apps.googleusercontent.com')).toBeNull()
    expect(validateGoogleClientId('nope')).not.toBeNull()
    expect(validateMicrosoftClientId('11111111-2222-3333-4444-555555555555')).toBeNull()
    expect(validateMicrosoftClientId('abc')).not.toBeNull()
  })
})

describe('account status', () => {
  const now = 1_700_000_000_000
  it('describes each state', () => {
    expect(accountStatus({ status: 'syncing', lastSyncAt: null }, now)).toEqual({ text: 'Syncing…', tone: 'busy' })
    expect(accountStatus({ status: 'reauth', lastSyncAt: 1 }, now).tone).toBe('warn')
    expect(accountStatus({ status: 'error', statusMessage: 'Boom', lastSyncAt: 1 }, now)).toEqual({ text: 'Boom', tone: 'error' })
    expect(accountStatus({ status: 'ok', lastSyncAt: null }, now).text).toBe('Not synced yet')
    expect(accountStatus({ status: 'ok', lastSyncAt: now - 10_000 }, now).text).toBe('Synced just now')
    expect(accountStatus({ status: 'ok', lastSyncAt: now - 5 * 60_000 }, now).text).toBe('Synced 5 minutes ago')
  })
})

describe('snippets storage', () => {
  it('round-trips and tolerates garbage', () => {
    const store = memStore()
    expect(loadSnippets(store)).toEqual([])
    expect(saveSnippets([{ id: 'a', title: 'Hello', html: '<p>Hi</p>', shortcut: 'hi' }], store, false)).toBe(true)
    expect(JSON.parse(store.data[SNIPPETS_KEY])).toEqual([{ id: 'a', title: 'Hello', html: '<p>Hi</p>', shortcut: 'hi' }])
    expect(loadSnippets(store)).toHaveLength(1)
    expect(parseSnippets('{oops')).toEqual([])
    expect(parseSnippets('{"a":1}')).toEqual([])
    expect(parseSnippets(JSON.stringify([{ id: 1 }, null, { id: 'ok', title: 't' }]))).toEqual([{ id: 'ok', title: 't', html: '' }])
    expect(saveSnippets([], null)).toBe(false)
  })
  it('normalises shortcuts and detects duplicates', () => {
    expect(normalizeShortcut(' /Meeting Times ')).toBe('meeting-times')
    const list = [{ id: 'a', title: 'A', html: '', shortcut: 'sig' }]
    expect(shortcutTaken(list, '/SIG')).toBe(true)
    expect(shortcutTaken(list, 'sig', 'a')).toBe(false)
    expect(shortcutTaken(list, '')).toBe(false)
  })
  it('upserts by id and cleans fields', () => {
    let list = upsertSnippet([], { id: 'a', title: '  ', html: '', shortcut: '/Hi' })
    expect(list).toEqual([{ id: 'a', title: 'Untitled snippet', html: '', shortcut: 'hi' }])
    list = upsertSnippet(list, { id: 'a', title: 'Greeting', html: '<b>x</b>', shortcut: '' })
    expect(list).toEqual([{ id: 'a', title: 'Greeting', html: '<b>x</b>' }])
  })
  it('previews html as text', () => {
    expect(htmlToPreview('<p>Hello&nbsp;<b>world</b></p><p>Bye</p>')).toBe('Hello world Bye')
    expect(htmlToPreview('x'.repeat(200), 10)).toHaveLength(10)
  })
})

describe('view ordering', () => {
  const views = [view('a', 0), view('b', 1), view('c', 2)]
  it('moves up and down and renumbers', () => {
    const r = moveView(views, 'b', -1)
    expect(r.ordered.map((v) => v.id)).toEqual(['b', 'a', 'c'])
    expect(r.changed.map((v) => v.id).sort()).toEqual(['a', 'b'])
    expect(moveView(views, 'a', -1).changed).toEqual([])
    expect(moveView(views, 'c', 1).changed).toEqual([])
    expect(moveView(views, 'zzz', 1).changed).toEqual([])
  })
  it('handles drag and drop order', () => {
    expect(dropOrder(views, 'a', null)).toEqual(['b', 'c', 'a'])
    expect(dropOrder(views, 'c', 'a')).toEqual(['c', 'a', 'b'])
    expect(dropOrder(views, 'a', 'b')).toEqual(['a', 'b', 'c'])
    const r = reorderViews(views, dropOrder(views, 'c', 'a'))
    expect(r.ordered.map((v) => [v.id, v.position])).toEqual([['c', 0], ['a', 1], ['b', 2]])
  })
  it('sorts unsorted input and describes filters', () => {
    expect(moveView([view('b', 5), view('a', 1)], 'a', 1).ordered.map((v) => v.id)).toEqual(['b', 'a'])
    expect(describeFilter({ role: 'inbox', unread: true })).toBe('Inbox · Unread')
    expect(describeFilter({})).toBe('All mail')
    expect(describeFilter({ from: ['a@x.com', 'b@x.com', 'c@x.com'], hasAttachment: true })).toBe('Has attachment · From a@x.com, b@x.com…')
  })
})

describe('link normalisation', () => {
  it('accepts safe links only', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com')
    expect(normalizeUrl('https://a.b/c')).toBe('https://a.b/c')
    expect(normalizeUrl('me@example.com')).toBe('mailto:me@example.com')
    expect(normalizeUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeUrl('data:text/html,x')).toBeNull()
    expect(normalizeUrl('two words.com')).toBeNull()
    expect(normalizeUrl('localhost')).toBeNull()
    expect(normalizeUrl('')).toBeNull()
  })
})
