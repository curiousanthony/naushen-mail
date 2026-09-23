import { describe, expect, it } from 'vitest'
import { FOLDER_ROLE, buildThread, colorFromPreset, parseHeaders, presetFromColor, sortMessages, toAddress, type NormalizeContext } from '../../../src/main/providers/outlook/mapping'
import { LABEL_COLORS } from '../../../src/shared/types'
import { FOLDERS, gmsg, iso } from './fake'

const wkById = Object.fromEntries(Object.entries(FOLDERS).map(([wk, id]) => [id, wk])) as Record<string, keyof typeof FOLDERS>
const ctx = (cats: string[] = []): NormalizeContext => ({
  accountId: 'acc', knownCategories: new Set(cats),
  folderRole: (id) => { const wk = id ? wkById[id] : undefined; return wk ? { wk, role: FOLDER_ROLE[wk].role } : undefined }
})

describe('folder -> label role mapping', () => {
  it('maps the six well-known folders to system roles', () => {
    expect(Object.fromEntries(Object.entries(FOLDER_ROLE).map(([k, v]) => [k, v.role]))).toEqual({
      inbox: 'inbox', sentitems: 'sent', drafts: 'drafts', deleteditems: 'trash', junkemail: 'spam', archive: 'archive'
    })
  })
})

describe('category colour mapping', () => {
  it('maps every preset to one of our label colours', () => {
    for (let i = 0; i <= 24; i++) expect(LABEL_COLORS).toContain(colorFromPreset(`preset${i}`))
  })
  it('spot checks', () => {
    expect(colorFromPreset('preset0')).toBe('red')
    expect(colorFromPreset('preset7')).toBe('blue')
    expect(colorFromPreset('preset9')).toBe('pink')
    expect(colorFromPreset('preset12')).toBe('gray')
    expect(colorFromPreset('none')).toBeUndefined()
    expect(colorFromPreset(undefined)).toBeUndefined()
  })
  it('round-trips our colours through a preset', () => {
    for (const c of LABEL_COLORS) expect(colorFromPreset(presetFromColor(c))).toBe(c)
    expect(presetFromColor(undefined)).toBe('none')
  })
})

describe('addresses & headers', () => {
  it('drops empty names and missing addresses', () => {
    expect(toAddress({ emailAddress: { name: 'a@x.com', address: 'a@x.com' } })).toEqual({ email: 'a@x.com' })
    expect(toAddress({ emailAddress: { name: 'Ann', address: 'a@x.com' } })).toEqual({ name: 'Ann', email: 'a@x.com' })
    expect(toAddress({ emailAddress: {} })).toBeNull()
  })
  it('extracts threading + unsubscribe headers', () => {
    expect(parseHeaders([
      { name: 'Message-ID', value: '<m1@x>' }, { name: 'In-Reply-To', value: '<m0@x>' },
      { name: 'References', value: '<a@x> <b@x>\n <m0@x>' }, { name: 'List-Unsubscribe', value: '<https://u.example/x>' }
    ])).toEqual({ messageIdHeader: '<m1@x>', inReplyTo: '<m0@x>', references: ['<a@x>', '<b@x>', '<m0@x>'], listUnsubscribe: '<https://u.example/x>' })
  })
})

describe('conversation grouping -> NormalizedThread', () => {
  const msgs = [
    gmsg('m2', 'C1', 'inbox', { receivedDateTime: iso(30), isRead: false, bodyPreview: 'latest reply', subject: 'Re: Hello' }),
    gmsg('m1', 'C1', 'inbox', { receivedDateTime: iso(10), subject: 'Hello' }),
    gmsg('m3', 'C1', 'sentitems', { receivedDateTime: iso(20), from: { emailAddress: { address: 'me@outlook.com' } }, toRecipients: [{ emailAddress: { name: 'Dana', address: 'dana@contoso.com' } }] })
  ]

  it('builds one thread ordered by time with union of folder labels', () => {
    const t = buildThread('C1', msgs, ctx())!
    expect(t.thread.id).toBe('acc:C1')
    expect(t.thread.remoteId).toBe('C1')
    expect(t.messages.map((m) => m.remoteId)).toEqual(['m1', 'm3', 'm2'])
    expect(t.thread.subject).toBe('Hello')
    expect(t.thread.snippet).toBe('latest reply')
    expect(t.thread.messageCount).toBe(3)
    expect(t.thread.lastMessageAt).toBe(Date.parse(iso(30)))
    expect(t.thread.unread).toBe(true)
    expect(new Set(t.thread.labelIds)).toEqual(new Set(['acc:inbox', 'acc:sentitems']))
    expect(t.thread.participants.map((p) => p.email)).toEqual(['dana@contoso.com', 'me@outlook.com'])
    expect(t.messages.every((m) => m.threadId === 'acc:C1')).toBe(true)
  })

  it('maps flag, categories, attachments and bodies', () => {
    const t = buildThread('C2', [gmsg('a', 'C2', 'inbox', {
      flag: { flagStatus: 'flagged' }, categories: ['Work', 'Ghost'],
      attachments: [
        { id: 'at1', name: 'a.pdf', contentType: 'application/pdf', size: 10, isInline: false },
        { id: 'at2', name: 'logo.png', contentType: 'image/png', size: 5, isInline: true, contentId: '<logo@x>' }
      ]
    })], ctx(['Work']))!
    expect(t.thread.starred).toBe(true)
    expect(t.thread.hasAttachments).toBe(true)
    expect(t.thread.labelIds).toContain('acc:cat:Work')
    expect(t.thread.labelIds).not.toContain('acc:cat:Ghost') // not in masterCategories => no label
    expect(t.messages[0].attachments).toEqual([
      { id: 'at1', filename: 'a.pdf', mimeType: 'application/pdf', size: 10, contentId: undefined, inline: false },
      { id: 'at2', filename: 'logo.png', mimeType: 'image/png', size: 5, contentId: 'logo@x', inline: true }
    ])
    expect(t.messages[0].bodyHtml).toBe('<p>body a</p>')
    expect(t.messages[0].bodyText).toBeNull()
  })

  it('inline-only attachments do not count as hasAttachments; text bodies land in bodyText', () => {
    const t = buildThread('C3', [gmsg('a', 'C3', 'inbox', { body: { contentType: 'text', content: 'hi' }, attachments: [{ id: 'i', name: 'x.png', isInline: true, contentId: 'c' }] })], ctx())!
    expect(t.thread.hasAttachments).toBe(false)
    expect(t.messages[0].bodyText).toBe('hi')
    expect(t.messages[0].bodyHtml).toBeNull()
  })

  it('archive-folder messages carry the archive label but not inbox', () => {
    const t = buildThread('C4', [gmsg('a', 'C4', 'archive')], ctx())!
    expect(t.thread.labelIds).toEqual(['acc:archive'])
  })

  it('a trashed message in a live conversation is dropped so the thread stays in the inbox', () => {
    const t = buildThread('C5', [gmsg('a', 'C5', 'inbox', { receivedDateTime: iso(1) }), gmsg('b', 'C5', 'deleteditems', { receivedDateTime: iso(2) })], ctx())!
    expect(t.messages.map((m) => m.remoteId)).toEqual(['a'])
    expect(t.thread.labelIds).toEqual(['acc:inbox'])
  })

  it('a fully trashed / junked conversation gets only the trash / spam label', () => {
    expect(buildThread('C6', [gmsg('a', 'C6', 'deleteditems'), gmsg('b', 'C6', 'deleteditems')], ctx())!.thread.labelIds).toEqual(['acc:deleteditems'])
    expect(buildThread('C7', [gmsg('a', 'C7', 'junkemail')], ctx())!.thread.labelIds).toEqual(['acc:junkemail'])
  })

  it('returns null for an empty conversation', () => {
    expect(buildThread('C8', [], ctx())).toBeNull()
  })

  it('drafts are flagged and never make a thread unread', () => {
    const t = buildThread('C9', [gmsg('a', 'C9', 'inbox'), gmsg('d', 'C9', 'drafts', { isDraft: true, isRead: false, receivedDateTime: iso(5) })], ctx())!
    expect(t.messages.find((m) => m.remoteId === 'd')!.isDraft).toBe(true)
    expect(t.thread.unread).toBe(false)
    expect(t.thread.snippet).toBe('preview a') // draft is not the snippet
    expect(new Set(t.thread.labelIds)).toEqual(new Set(['acc:inbox', 'acc:drafts']))
  })

  it('sorts equal timestamps by conversationIndex length', () => {
    const s = sortMessages([gmsg('b', 'C', 'inbox', { conversationIndex: 'AAAA' }), gmsg('a', 'C', 'inbox', { conversationIndex: 'AA' })])
    expect(s.map((m) => m.id)).toEqual(['a', 'b'])
  })
})
