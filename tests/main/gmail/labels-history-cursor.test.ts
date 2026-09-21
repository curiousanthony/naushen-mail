import { describe, expect, it } from 'vitest'
import { decodeCursor, encodeCursor, type GmailCursor } from '../../../src/main/providers/gmail/cursor'
import { diffHistory } from '../../../src/main/providers/gmail/history'
import { colorFromGmail, GMAIL_COLOR_FOR, mapLabelIds, mapLabels, toGmailColor, toRemoteLabelId } from '../../../src/main/providers/gmail/labels'
import { LABEL_COLORS } from '../../../src/shared/types'

describe('label mapping', () => {
  const raw = [
    { id: 'INBOX', name: 'INBOX', type: 'system' as const },
    { id: 'SENT', name: 'SENT', type: 'system' as const },
    { id: 'DRAFT', name: 'DRAFT', type: 'system' as const },
    { id: 'TRASH', name: 'TRASH', type: 'system' as const },
    { id: 'SPAM', name: 'SPAM', type: 'system' as const },
    { id: 'IMPORTANT', name: 'IMPORTANT', type: 'system' as const },
    { id: 'STARRED', name: 'STARRED', type: 'system' as const },
    { id: 'UNREAD', name: 'UNREAD', type: 'system' as const },
    { id: 'CATEGORY_PROMOTIONS', name: 'CATEGORY_PROMOTIONS', type: 'system' as const },
    { id: 'CHAT', name: 'CHAT', type: 'system' as const },
    { id: 'Label_2', name: 'Clients/Acme', type: 'user' as const, color: { backgroundColor: '#16a766', textColor: '#ffffff' } },
    { id: 'Label_1', name: 'Alpha', type: 'user' as const }
  ]
  it('maps system labels to roles, drops UNREAD/CHAT/CATEGORY_*, sorts users by name', () => {
    const l = mapLabels('gmail-a', raw)
    expect(l.filter((x) => x.kind === 'system').map((x) => [x.remoteId, x.role, x.name])).toEqual([
      ['INBOX', 'inbox', 'Inbox'], ['SENT', 'sent', 'Sent'], ['DRAFT', 'drafts', 'Drafts'], ['TRASH', 'trash', 'Trash'],
      ['SPAM', 'spam', 'Spam'], ['IMPORTANT', 'important', 'Important'], ['STARRED', 'starred', 'Starred']
    ])
    expect(l.filter((x) => x.kind === 'user')).toEqual([
      { id: 'gmail-a:Label_1', accountId: 'gmail-a', remoteId: 'Label_1', name: 'Alpha', color: undefined, kind: 'user' },
      { id: 'gmail-a:Label_2', accountId: 'gmail-a', remoteId: 'Label_2', name: 'Clients/Acme', color: 'green', kind: 'user' }
    ])
  })
  it('keeps thread label ids consistent with listLabels (hidden ids never referenced)', () => {
    const listed = new Set(mapLabels('a', raw).map((l) => l.id))
    for (const id of mapLabelIds('a', ['INBOX', 'UNREAD', 'CATEGORY_UPDATES', 'CHAT', 'Label_1', 'STARRED'])) expect(listed.has(id)).toBe(true)
  })
  it('resolves local label ids to Gmail ids', () => {
    const labels = mapLabels('gmail-a', raw)
    expect(toRemoteLabelId('gmail-a', labels, 'gmail-a:Label_2')).toBe('Label_2')
    expect(toRemoteLabelId('gmail-a', labels, 'gmail-a:Label_404')).toBe('Label_404')
    expect(toRemoteLabelId('gmail-a', labels, 'Label_7')).toBe('Label_7')
  })
  it('maps Gmail palette colours onto our nine colours', () => {
    const cases: Record<string, string> = {
      '#fb4c2f': 'red', '#cc3a21': 'red', '#e66550': 'red', '#ffad47': 'orange', '#cf8933': 'orange', '#fad165': 'yellow', '#fef1d1': 'yellow',
      '#16a766': 'green', '#0b804b': 'green', '#4a86e8': 'blue', '#285bac': 'blue', '#a479e2': 'purple', '#653e9b': 'purple',
      '#f691b3': 'pink', '#b65775': 'pink', '#999999': 'gray', '#434343': 'gray', '#efefef': 'gray', '#a46a21': 'brown', '#822111': 'brown'
    }
    for (const [hex, want] of Object.entries(cases)) expect(colorFromGmail({ backgroundColor: hex, textColor: '#000000' }), hex).toBe(want)
    expect(colorFromGmail(undefined)).toBeUndefined()
  })
  it('round-trips our colours through Gmail palette pairs', () => {
    for (const c of LABEL_COLORS) expect(colorFromGmail(GMAIL_COLOR_FOR[c]), c).toBe(c)
    expect(toGmailColor('teal')).toBeUndefined()
    expect(toGmailColor(undefined)).toBeUndefined()
  })
})

describe('history diffing', () => {
  it('collects affected thread ids from every record kind, de-duplicated, in first-seen order', () => {
    const d = diffHistory([
      { id: '1', messagesAdded: [{ message: { id: 'm1', threadId: 't1' } }], messages: [{ id: 'm1', threadId: 't1' }] },
      { id: '2', labelsAdded: [{ message: { id: 'm2', threadId: 't2' }, labelIds: ['STARRED'] }] },
      { id: '3', labelsRemoved: [{ message: { id: 'm3', threadId: 't3' }, labelIds: ['UNREAD'] }, { message: { id: 'm4', threadId: 't1' }, labelIds: ['INBOX'] }] },
      { id: '4', messagesDeleted: [{ message: { id: 'm9', threadId: 't9' } }] }
    ])
    expect(d.threadIds).toEqual(['t1', 't2', 't3', 't9'])
    expect(diffHistory([]).threadIds).toEqual([])
  })
})

describe('cursor', () => {
  it('round-trips every phase', () => {
    const cursors: GmailCursor[] = [
      { v: 1, phase: 'backfill', historyId: '5', pageToken: 'tok', fetched: 100 },
      { v: 1, phase: 'backfill', historyId: '5', fetched: 500, extras: true },
      { v: 1, phase: 'incremental', historyId: '9', pending: ['a', 'b'] }
    ]
    for (const c of cursors) expect(decodeCursor(encodeCursor(c))).toEqual(c)
  })
  it('treats null as start, digits as a legacy incremental cursor, garbage as unrecognised', () => {
    expect(decodeCursor(null)).toBeNull()
    expect(decodeCursor('12345')).toEqual({ v: 1, phase: 'incremental', historyId: '12345' })
    expect(decodeCursor('not-a-cursor')).toBeNull()
    expect(decodeCursor(Buffer.from('{"v":2}').toString('base64url'))).toBeNull()
  })
})
