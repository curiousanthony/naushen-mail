import { describe, expect, it } from 'vitest'
import type { Account, Label, Message, View } from '@shared/types'
import { filterRank, scoreMatch } from '@/features/commands/filter'
import { checkState, extendSelection, lastMessage, moveFocus, targetIds } from '@/features/commands/selection'
import { UndoStack, invertAction, toastText } from '@/features/commands/undo'
import { parseListUnsubscribe } from '@/features/commands/unsubscribe'
import { MAX_RECENT, pushRecent } from '@/features/commands/recent'
import { buildPaletteItems, groupItems, type PaletteCtx } from '@/features/commands/paletteItems'

describe('filter', () => {
  it('matches everything on an empty query', () => {
    expect(filterRank(['a', 'b'], '  ', (x) => ({ label: x }))).toEqual(['a', 'b'])
  })
  it('requires every token to match', () => {
    expect(scoreMatch('go inbox', 'Go to Inbox')).toBeGreaterThan(0)
    expect(scoreMatch('go sent', 'Go to Inbox')).toBe(0)
  })
  it('ranks prefixes above word starts above substrings, stably', () => {
    const items = ['Mark as read', 'Archive', 'Search archived', 'Set reminder']
    expect(filterRank(items, 'arch', (x) => ({ label: x }))).toEqual(['Archive', 'Search archived'])
    expect(filterRank(['xxread', 'Mark as read', 'read'], 'read', (x) => ({ label: x }))).toEqual(['read', 'Mark as read', 'xxread'])
  })
  it('matches keywords (weaker) and is case/diacritic insensitive', () => {
    expect(filterRank([{ l: 'Set reminder', k: ['snooze'] }], 'snooze', (x) => ({ label: x.l, keywords: x.k }))).toHaveLength(1)
    expect(scoreMatch('cafe', 'Café')).toBeGreaterThan(0)
  })
  it('falls back to subsequence for 3+ characters', () => {
    expect(scoreMatch('rmd', 'Set reminder')).toBeGreaterThan(0)
    expect(scoreMatch('zq', 'Set reminder')).toBe(0)
  })
})

describe('selection', () => {
  const ids = ['a', 'b', 'c', 'd']
  it('resolves action targets: selection > open > cursor', () => {
    expect(targetIds({ focusedId: 'a', selectedIds: ['b', 'c'], openThreadId: 'd' })).toEqual(['b', 'c'])
    expect(targetIds({ focusedId: 'a', selectedIds: [], openThreadId: 'd' })).toEqual(['d'])
    expect(targetIds({ focusedId: 'a', selectedIds: [], openThreadId: null })).toEqual(['a'])
    expect(targetIds({ focusedId: null, selectedIds: [], openThreadId: null })).toEqual([])
  })
  it('moves and clamps the cursor', () => {
    expect(moveFocus(ids, 'a', 1)).toBe('b')
    expect(moveFocus(ids, 'd', 1)).toBe('d')
    expect(moveFocus(ids, 'a', -1)).toBe('a')
    expect(moveFocus(ids, null, 1)).toBe('a')
    expect(moveFocus(ids, null, -1)).toBe('d')
    expect(moveFocus(ids, 'zz', 1)).toBe('a')
    expect(moveFocus([], 'a', 1)).toBeNull()
  })
  it('extends the selection with shift+down and shrinks when moving back', () => {
    let r = extendSelection(ids, 'a', [], 1)
    expect(r).toEqual({ focusedId: 'b', selectedIds: ['a', 'b'] })
    r = extendSelection(ids, r.focusedId, r.selectedIds, 1)
    expect(r).toEqual({ focusedId: 'c', selectedIds: ['a', 'b', 'c'] })
    r = extendSelection(ids, r.focusedId, r.selectedIds, -1)
    expect(r).toEqual({ focusedId: 'b', selectedIds: ['a', 'b'] })
  })
  it('extends upwards and stops at the edges', () => {
    expect(extendSelection(ids, 'c', [], -1)).toEqual({ focusedId: 'b', selectedIds: ['b', 'c'] })
    expect(extendSelection(ids, 'd', ['d'], 1)).toEqual({ focusedId: 'd', selectedIds: ['d'] })
  })
  it('picks the newest non-draft message', () => {
    const m = (id: string, date: number, isDraft = false) => ({ id, date, isDraft }) as Message
    expect(lastMessage([m('1', 1), m('3', 3, true), m('2', 2)])?.id).toBe('2')
    expect(lastMessage([m('1', 1, true)])?.id).toBe('1')
    expect(lastMessage([])).toBeUndefined()
  })
  it('computes tri-state label checkboxes', () => {
    const t = [{ labelIds: ['x'] }, { labelIds: ['x', 'y'] }]
    expect(checkState(t, 'x')).toBe('on')
    expect(checkState(t, 'y')).toBe('mixed')
    expect(checkState(t, 'z')).toBe('off')
    expect(checkState([], 'x')).toBe('off')
  })
})

describe('undo', () => {
  it('inverts reversible actions and refuses irreversible ones', () => {
    expect(invertAction({ type: 'archive' })).toEqual({ type: 'unarchive' })
    expect(invertAction({ type: 'star' })).toEqual({ type: 'unstar' })
    expect(invertAction({ type: 'addLabel', labelId: 'L' })).toEqual({ type: 'removeLabel', labelId: 'L' })
    expect(invertAction({ type: 'snooze', until: 5 })).toEqual({ type: 'unsnooze' })
    expect(invertAction({ type: 'remind', at: 5 })).toEqual({ type: 'remind', at: null })
    expect(invertAction({ type: 'deleteForever' })).toBeNull()
  })
  it('is a bounded LIFO', () => {
    const s = new UndoStack(2)
    s.push(['1'], { type: 'unarchive' }, 'a')
    s.push(['2'], { type: 'untrash' }, 'b')
    s.push(['3'], { type: 'notSpam' }, 'c')
    expect(s.size).toBe(2)
    expect(s.pop()?.ids).toEqual(['3'])
    expect(s.pop()?.ids).toEqual(['2'])
    expect(s.pop()).toBeUndefined()
  })
  it('lets a toast take its own entry out of order', () => {
    const s = new UndoStack()
    const a = s.push(['1'], { type: 'unarchive' }, 'a')
    s.push(['2'], { type: 'untrash' }, 'b')
    expect(s.take(a.id)?.ids).toEqual(['1'])
    expect(s.take(a.id)).toBeUndefined()
    expect(s.size).toBe(1)
  })
  it('writes toast copy', () => {
    expect(toastText('archive', 1)).toBe('Conversation archived')
    expect(toastText('trash', 3)).toBe('3 conversations moved to trash')
  })
})

describe('parseListUnsubscribe', () => {
  it('prefers https and also parses mailto', () => {
    const r = parseListUnsubscribe('<mailto:unsub@x.com?subject=Unsubscribe%20me>, <https://x.com/u?id=1>')
    expect(r.https).toBe('https://x.com/u?id=1')
    expect(r.mailto).toEqual({ to: 'unsub@x.com', subject: 'Unsubscribe me' })
  })
  it('handles missing / malformed values', () => {
    expect(parseListUnsubscribe(undefined)).toEqual({})
    expect(parseListUnsubscribe('<javascript:alert(1)>')).toEqual({})
    expect(parseListUnsubscribe('https://plain.example/unsub')).toEqual({ https: 'https://plain.example/unsub' })
  })
})

describe('recent searches', () => {
  it('dedupes case-insensitively, newest first, capped', () => {
    expect(pushRecent(['b', 'a'], 'A')).toEqual(['A', 'b'])
    expect(pushRecent([], '  ')).toEqual([])
    let l: string[] = []
    for (let i = 0; i < 20; i++) l = pushRecent(l, `q${i}`)
    expect(l).toHaveLength(MAX_RECENT)
    expect(l[0]).toBe('q19')
  })
})

describe('palette items are context aware', () => {
  const base: PaletteCtx = {
    targetCount: 0, targetStarred: false, targetUnread: false, hasThread: false, navRole: 'inbox', accountId: 'all', accounts: [], views: [], labels: [],
    theme: 'system', sidebarCollapsed: false, canUndo: false
  }
  const labels = (items: ReturnType<typeof buildPaletteItems>): string[] => items.map((i) => i.label)
  it('offers no thread actions without a target', () => {
    const l = labels(buildPaletteItems(base))
    expect(l).not.toContain('Archive conversation')
    expect(l).not.toContain('Reply')
    expect(l).toContain('Go to Inbox')
    expect(l).toContain('New message')
  })
  it('offers thread actions for a target and pluralises', () => {
    expect(labels(buildPaletteItems({ ...base, targetCount: 1, hasThread: true }))).toEqual(expect.arrayContaining(['Archive conversation', 'Star', 'Set reminder…', 'Label…', 'Mark as unread', 'Reply', 'Reply all', 'Forward', 'Unsubscribe']))
    expect(labels(buildPaletteItems({ ...base, targetCount: 3 }))).toContain('Archive 3 conversations')
  })
  it('flips toggles by state and hides Move to Inbox in the inbox', () => {
    const a = labels(buildPaletteItems({ ...base, targetCount: 1, targetStarred: true, targetUnread: true }))
    expect(a).toContain('Remove star')
    expect(a).toContain('Mark as read')
    expect(a).not.toContain('Move conversation to Inbox')
    expect(labels(buildPaletteItems({ ...base, targetCount: 1, navRole: 'trash' }))).toContain('Move conversation to Inbox')
  })
  it('lists views, user labels and account shortcuts', () => {
    const acc = (id: string, email: string) => ({ id, email, name: email.split('@')[0] }) as Account
    const items = buildPaletteItems({
      ...base, accounts: [acc('a1', 'x@a.com'), acc('a2', 'y@b.com')],
      views: [{ id: 'v1', name: 'Unread', emoji: '🔵' } as View],
      labels: [{ id: 'l1', accountId: 'a1', name: 'Receipts', kind: 'user', color: 'green' } as Label, { id: 'l2', accountId: 'a1', name: 'INBOX', kind: 'system' } as Label]
    })
    const l = labels(items)
    expect(l).toContain('Go to Unread')
    expect(l).toContain('Go to Receipts')
    expect(l).not.toContain('Go to INBOX')
    expect(items.find((i) => i.arg === 'a2')?.binding).toBe('ctrl+2')
  })
  it('scopes labels to the active account', () => {
    const lab = (id: string, accountId: string, name: string) => ({ id, accountId, name, kind: 'user' }) as Label
    const l = labels(buildPaletteItems({ ...base, accountId: 'a2', labels: [lab('1', 'a1', 'Mine'), lab('2', 'a2', 'Theirs')] }))
    expect(l).toContain('Go to Theirs')
    expect(l).not.toContain('Go to Mine')
  })
  it('groups in display order and filters via filterRank', () => {
    const items = buildPaletteItems({ ...base, targetCount: 1 })
    expect(groupItems(items).map((g) => g.group)).toEqual(['Actions', 'Navigate', 'Compose', 'Settings'])
    expect(labels(filterRank(items, 'snooze', (i) => ({ label: i.label, keywords: i.keywords })))).toEqual(['Set reminder…', 'Go to Reminders'])
    expect(labels(filterRank(items, 'dark', (i) => ({ label: i.label, keywords: i.keywords })))).toContain('Theme: Dark')
  })
})
