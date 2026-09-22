import { describe, expect, it, beforeEach, vi } from 'vitest'
import type { Counts, Label, View } from '../../src/shared/types'
import {
  MAIL_ITEMS, accountLabel, accountTags, ambiguousLabelNames, filterSummary, loadCollapsed,
  mailNav, navEquals, saveCollapsed, sidebarLabels, sidebarViews, unreadFor
} from '../../src/renderer/features/sidebar/lib'

const label = (id: string, accountId: string, name: string, kind: Label['kind'] = 'user'): Label =>
  ({ id, accountId, remoteId: id.split(':')[1], name, kind })

const view = (id: string, position: number, extra: Partial<View> = {}): View =>
  ({ id, name: id, filter: {}, position, showInSidebar: true, showAsTab: false, ...extra })

describe('unreadFor', () => {
  // Shape produced by Repo.counts(): `${accountId|'all'}:${role|labelId}`, label ids embed the account.
  const counts: Counts = { unread: { 'all:inbox': 7, 'a:inbox': 5, 'all:a:L_Travel': 2, 'a:a:L_Travel': 2 } }

  it('reads role and label keys through the same lookup', () => {
    expect(unreadFor(counts, 'all', 'inbox')).toBe(7)
    expect(unreadFor(counts, 'a', 'inbox')).toBe(5)
    expect(unreadFor(counts, 'all', 'a:L_Travel')).toBe(2)
  })

  it('returns 0 for roles no label carries (All Mail, archive) and for unknown accounts', () => {
    expect(unreadFor(counts, 'all', 'all')).toBe(0)
    expect(unreadFor(counts, 'all', 'archive')).toBe(0)
    expect(unreadFor(counts, 'b', 'inbox')).toBe(0)
  })
})

describe('mail section', () => {
  it('lists Notion Mail\'s folders with All Mail first', () => {
    expect(MAIL_ITEMS.map((m) => m.name)).toEqual(['All Mail', 'Sent', 'Drafts', 'Reminders', 'Trash', 'Spam'])
  })
  it('maps rows to navs, with Reminders using the local snoozed nav', () => {
    expect(mailNav(MAIL_ITEMS[0])).toEqual({ kind: 'role', role: 'all' })
    expect(mailNav(MAIL_ITEMS[3])).toEqual({ kind: 'snoozed' })
  })
})

describe('sidebarLabels', () => {
  const labels = [
    label('b:L_Team', 'b', 'Team'), label('a:L_Travel', 'a', 'Travel'),
    label('a:INBOX', 'a', 'Inbox', 'system'), label('a:L_Team', 'a', 'Team')
  ]
  it('keeps user labels only, sorted by name then account', () => {
    expect(sidebarLabels(labels, 'all').map((l) => l.id)).toEqual(['a:L_Team', 'b:L_Team', 'a:L_Travel'])
  })
  it('narrows to the active account', () => {
    expect(sidebarLabels(labels, 'a').map((l) => l.id)).toEqual(['a:L_Team', 'a:L_Travel'])
  })
})

describe('sidebarViews', () => {
  it('orders by position and honours showInSidebar', () => {
    const views = [view('c', 2), view('a', 0), view('hidden', 1, { showInSidebar: false })]
    expect(sidebarViews(views).map((v) => v.id)).toEqual(['a', 'c'])
  })
})

describe('navEquals', () => {
  it('compares kind and payload', () => {
    expect(navEquals({ kind: 'role', role: 'inbox' }, { kind: 'role', role: 'inbox' })).toBe(true)
    expect(navEquals({ kind: 'role', role: 'inbox' }, { kind: 'role', role: 'sent' })).toBe(false)
    expect(navEquals({ kind: 'view', viewId: 'v1' }, { kind: 'view', viewId: 'v2' })).toBe(false)
    expect(navEquals({ kind: 'label', labelId: 'a:L' }, { kind: 'label', labelId: 'a:L' })).toBe(true)
    expect(navEquals({ kind: 'snoozed' }, { kind: 'snoozed' })).toBe(true)
    expect(navEquals({ kind: 'snoozed' }, { kind: 'role', role: 'inbox' })).toBe(false)
  })
})

describe('collapsed sections', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
      removeItem: (k: string) => { store.delete(k) }
    })
  })

  it('round-trips through localStorage', () => {
    saveCollapsed({ views: true, mail: false })
    expect(loadCollapsed()).toEqual({ views: true, mail: false })
  })

  it('ignores junk and survives storage that throws', () => {
    globalThis.localStorage.setItem('mailroom.sidebar.sections', '["nope"]')
    expect(loadCollapsed()).toEqual({})
    globalThis.localStorage.setItem('mailroom.sidebar.sections', '{"views":"yes"}')
    expect(loadCollapsed()).toEqual({})
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } })
    expect(loadCollapsed()).toEqual({})
    expect(() => saveCollapsed({ views: true })).not.toThrow()
  })
})

describe('filterSummary', () => {
  const labels = [label('a:L_Travel', 'a', 'Travel')]
  it('describes the saved filter', () => {
    expect(filterSummary(view('v', 0, { filter: { role: 'inbox', unread: true } }), labels)).toBe('Inbox · unread')
    expect(filterSummary(view('v', 0, { filter: { role: 'all', hasAttachment: true } }), labels)).toBe('All mail · has attachment')
    expect(filterSummary(view('v', 0, { filter: { labelIds: ['a:L_Travel'], from: ['lea'] } }), labels)).toBe('Travel · from lea')
    expect(filterSummary(view('v', 0), labels)).toBe('No filters')
  })
})

describe('accountLabel', () => {
  it('falls back to the mailbox part of the address', () => {
    expect(accountLabel('Anthony', 'a@x.io')).toBe('Anthony')
    expect(accountLabel('  ', 'anthony@x.io')).toBe('anthony')
  })
})

describe('ambiguousLabelNames', () => {
  it('flags only names carried by more than one account', () => {
    const names = ambiguousLabelNames([
      label('a:L_Receipts', 'a', 'Receipts'),
      label('b:L_Receipts', 'b', 'Receipts'),
      label('a:L_Travel', 'a', 'Travel')
    ])
    expect([...names]).toEqual(['Receipts'])
  })

  it('ignores system labels and a name repeated within one account', () => {
    const names = ambiguousLabelNames([
      label('a:INBOX', 'a', 'Inbox', 'system'),
      label('b:INBOX', 'b', 'Inbox', 'system'),
      label('a:L_1', 'a', 'Team'),
      label('a:L_2', 'a', 'Team')
    ])
    expect(names.size).toBe(0)
  })
})

describe('accountTags', () => {
  it('prefers the local part when it already separates the accounts', () => {
    expect(accountTags([
      { id: 'a', email: 'lea@acme.example' },
      { id: 'b', email: 'marc@acme.example' }
    ])).toEqual({ a: 'lea', b: 'marc' })
  })

  it('falls back to the domain when one person has two mailboxes', () => {
    expect(accountTags([
      { id: 'a', email: 'anthony@gmail.example' },
      { id: 'b', email: 'anthony@acme.example' }
    ])).toEqual({ a: 'gmail', b: 'acme' })
  })

  it('falls back to the full address when nothing shorter is unique', () => {
    expect(accountTags([
      { id: 'a', email: 'anthony@acme.example' },
      { id: 'b', email: 'anthony@acme.other' }
    ])).toEqual({ a: 'anthony@acme.example', b: 'anthony@acme.other' })
  })
})
