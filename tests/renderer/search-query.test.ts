import { describe, expect, it } from 'vitest'
import { parseSearchQuery } from '@/lib/searchQuery'
import type { Label } from '@shared/types'

const label = (id: string, name: string): Label => ({ id, accountId: 'a', remoteId: id, name, kind: 'user' })
const LABELS = [label('a:L_Travel', 'Travel'), label('a:L_Receipts', 'Receipts')]

describe('parseSearchQuery', () => {
  it('parses from/to/subject operators', () => {
    expect(parseSearchQuery('from:priya', []).filter).toEqual({ from: ['priya'] })
    expect(parseSearchQuery('to:jordan@acme.test', []).filter).toEqual({ to: ['jordan@acme.test'] })
    expect(parseSearchQuery('subject:invoice', []).filter).toEqual({ subjectContains: ['invoice'] })
  })

  it('unquotes a value with spaces', () => {
    expect(parseSearchQuery('from:"Jordan Lee"', []).filter).toEqual({ from: ['Jordan Lee'] })
  })

  it('parses has:attachment and is:unread/read/starred', () => {
    expect(parseSearchQuery('has:attachment', []).filter).toEqual({ hasAttachment: true })
    expect(parseSearchQuery('has:attachments', []).filter).toEqual({ hasAttachment: true })
    expect(parseSearchQuery('is:unread', []).filter).toEqual({ unread: true })
    expect(parseSearchQuery('is:read', []).filter).toEqual({ unread: false })
    expect(parseSearchQuery('is:starred', []).filter).toEqual({ starred: true })
  })

  it('resolves label: by name, case-insensitively, exact match preferred over substring', () => {
    expect(parseSearchQuery('label:travel', LABELS).filter).toEqual({ labelIds: ['a:L_Travel'] })
    expect(parseSearchQuery('label:Receipts', LABELS).filter).toEqual({ labelIds: ['a:L_Receipts'] })
  })

  it('parses before:/after: as local-midnight epoch ms', () => {
    const { filter } = parseSearchQuery('after:2026-01-01 before:2026-02-01', [])
    expect(filter.after).toBe(new Date(2026, 0, 1).getTime())
    expect(filter.before).toBe(new Date(2026, 1, 1).getTime())
  })

  it('mixes operators with free text, which goes to FTS', () => {
    const { filter, text } = parseSearchQuery('budget from:priya has:attachment forecast', [])
    expect(filter).toEqual({ from: ['priya'], hasAttachment: true })
    expect(text).toBe('budget forecast')
  })

  it('keeps an unresolvable operator as literal text instead of silently dropping it', () => {
    expect(parseSearchQuery('label:doesnotexist', LABELS)).toEqual({ filter: {}, text: 'label:doesnotexist' })
    expect(parseSearchQuery('before:not-a-date', [])).toEqual({ filter: {}, text: 'before:not-a-date' })
  })

  it('treats an unrecognised key: as plain text, byte-identical', () => {
    expect(parseSearchQuery('see http://example.com/x:y for details', []).text)
      .toBe('see http://example.com/x:y for details')
  })

  it('is empty in, empty out', () => {
    expect(parseSearchQuery('', [])).toEqual({ filter: {}, text: '' })
    expect(parseSearchQuery('   ', [])).toEqual({ filter: {}, text: '' })
  })

  it('plain free text with no operators is untouched', () => {
    expect(parseSearchQuery('quarterly roadmap', [])).toEqual({ filter: {}, text: 'quarterly roadmap' })
  })
})
