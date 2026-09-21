import { describe, expect, it } from 'vitest'
import { findLargeBodyParts, normalizeMessage, normalizeThread, parsePayload } from '../../../src/main/providers/gmail/normalize'
import { decodeMimeWords, parseAddressList, parseHeaderValue, decodeEntities } from '../../../src/main/providers/gmail/text'
import type { GmailPart } from '../../../src/main/providers/gmail/api-types'
import { b64, hdr, msg, textPart, thread } from './helpers'

const alt = (...parts: GmailPart[]): GmailPart => ({ mimeType: 'multipart/alternative', headers: [hdr('Content-Type', 'multipart/alternative')], parts })

describe('MIME payload parsing', () => {
  it('prefers html in multipart/alternative and keeps text as bodyText', () => {
    const p = parsePayload(alt(textPart('text/plain', 'plain body'), textPart('text/html', '<p>html body</p>')))
    expect(p.html).toBe('<p>html body</p>')
    expect(p.text).toBe('plain body')
    expect(p.attachments).toEqual([])
  })

  it('derives bodyText from html when there is no text part, and null html for text-only mail', () => {
    expect(parsePayload(textPart('text/html', '<div>Hello<br>World &amp; co</div>')).text).toBe('Hello\nWorld & co')
    const t = parsePayload(textPart('text/plain', 'just text'))
    expect(t.html).toBeNull()
    expect(t.text).toBe('just text')
  })

  it('handles multipart/related with inline cid images referenced by the html', () => {
    const payload: GmailPart = {
      mimeType: 'multipart/related', parts: [
        alt(textPart('text/plain', 'see logo'), textPart('text/html', '<img src="cid:logo123"> hi')),
        {
          partId: '1', mimeType: 'image/png', filename: 'logo.png',
          headers: [hdr('Content-ID', '<logo123>'), hdr('Content-Disposition', 'inline; filename="logo.png"')],
          body: { size: 5421, attachmentId: 'ATT1' }
        }
      ]
    }
    const p = parsePayload(payload)
    expect(p.html).toContain('cid:logo123')
    expect(p.attachments).toEqual([{ id: '1:ATT1', filename: 'logo.png', mimeType: 'image/png', size: 5421, contentId: 'logo123', inline: true }])
  })

  it('treats an inline resource the html never references as a regular attachment', () => {
    const p = parsePayload({
      mimeType: 'multipart/related', parts: [
        textPart('text/html', '<p>no images here</p>'),
        { partId: '1', mimeType: 'image/jpeg', filename: 'photo.jpg', headers: [hdr('Content-ID', '<x>'), hdr('Content-Disposition', 'inline')], body: { size: 10, attachmentId: 'A' } }
      ]
    })
    expect(p.attachments[0].inline).toBe(false)
  })

  it('collects attachments from multipart/mixed and marks Content-Disposition: attachment as downloadable', () => {
    const p = parsePayload({
      mimeType: 'multipart/mixed', parts: [
        alt(textPart('text/plain', 'x'), textPart('text/html', '<b>x</b>')),
        { partId: '1', mimeType: 'application/pdf', filename: 'report.pdf', headers: [hdr('Content-Disposition', 'attachment; filename="report.pdf"')], body: { size: 900, attachmentId: 'P1' } },
        { partId: '2', mimeType: 'text/plain', filename: 'notes.txt', body: { size: 3, data: b64('abc') } }
      ]
    })
    expect(p.html).toBe('<b>x</b>')
    expect(p.attachments.map((a) => [a.filename, a.inline, a.size])).toEqual([['report.pdf', false, 900], ['notes.txt', false, 3]])
    // a text/plain part with a filename is an attachment, never body text
    expect(p.text).toBe('x')
  })

  it('decodes non-UTF-8 charsets from the part Content-Type', () => {
    const latin1 = Buffer.from([0x43, 0x61, 0x66, 0xe9]) // "Café" in ISO-8859-1
    const p = parsePayload(textPart('text/plain', latin1, {}, '; charset="iso-8859-1"'))
    expect(p.text).toBe('Café')
    const sjis = Buffer.from([0x93, 0xfa, 0x96, 0x7b]) // "日本"
    expect(parsePayload(textPart('text/html', sjis, {}, '; charset=Shift_JIS')).html).toBe('日本')
    expect(parsePayload(textPart('text/plain', Buffer.from('héllo wörld'), {}, '; charset=utf-8')).text).toBe('héllo wörld')
  })

  it('falls back to windows-1252 when no charset is declared and the bytes are not valid UTF-8', () => {
    expect(parsePayload(textPart('text/plain', Buffer.from([0x63, 0x61, 0x66, 0xe9]))).text).toBe('café')
  })

  it('decodes RFC 2047 and RFC 2231 attachment names', () => {
    const p = parsePayload({
      mimeType: 'multipart/mixed', parts: [
        textPart('text/plain', 'hi'),
        { partId: '1', mimeType: 'application/pdf', filename: '=?UTF-8?B?csOpc3Vtw6kucGRm?=', body: { size: 1, attachmentId: 'A' } },
        {
          partId: '2', mimeType: 'application/pdf', filename: '',
          headers: [hdr('Content-Disposition', "attachment; filename*0*=UTF-8''r%C3%A9; filename*1*=sum%C3%A9.pdf")], body: { size: 1, attachmentId: 'B' }
        }
      ]
    })
    expect(p.attachments.map((a) => a.filename)).toEqual(['résumé.pdf', 'résumé.pdf'])
  })

  it('finds large body parts delivered by reference', () => {
    const big: GmailPart = { partId: '0', mimeType: 'text/html', filename: '', body: { size: 9e6, attachmentId: 'BIG' } }
    expect(findLargeBodyParts({ mimeType: 'multipart/alternative', parts: [textPart('text/plain', 'a'), big] })).toEqual([big])
  })
})

describe('header helpers', () => {
  it('decodes encoded words (B and Q, adjacent words joined, idempotent)', () => {
    expect(decodeMimeWords('=?UTF-8?B?SGVsbG8g?= =?UTF-8?B?V29ybGQ=?=')).toBe('Hello World')
    expect(decodeMimeWords('=?iso-8859-1?Q?Caf=E9_cr=E8me?=')).toBe('Café crème')
    expect(decodeMimeWords('plain subject')).toBe('plain subject')
    expect(decodeMimeWords(decodeMimeWords('=?UTF-8?Q?=E2=9C=93_done?='))).toBe('✓ done')
  })
  it('parses address lists with quoted commas, groups and encoded names', () => {
    expect(parseAddressList('"Doe, Jane" <jane@x.io>, bob@y.io, =?UTF-8?B?w4lsw6htZQ==?= <e@z.io>')).toEqual([
      { name: 'Doe, Jane', email: 'jane@x.io' }, { email: 'bob@y.io' }, { name: 'Élème', email: 'e@z.io' }
    ])
    expect(parseAddressList(undefined)).toEqual([])
  })
  it('parses header params', () => {
    expect(parseHeaderValue('text/html; charset="UTF-8"; format=flowed')).toEqual({ value: 'text/html', params: { charset: 'UTF-8', format: 'flowed' } })
  })
  it('unescapes snippet entities', () => {
    expect(decodeEntities('it&#39;s &amp; &quot;fine&quot; &#x1F600; &lt;3')).toBe('it\'s & "fine" 😀 <3')
  })
})

describe('normalizeMessage', () => {
  it('extracts headers, flags and ids', () => {
    const m = normalizeMessage('gmail-a', msg('m1', 't1', {
      labelIds: ['INBOX', 'UNREAD', 'STARRED', 'CATEGORY_UPDATES', 'Label_9'],
      headers: [
        hdr('Cc', 'c1@x.io'), hdr('Bcc', 'b@x.io'), hdr('Reply-To', 'Support <s@x.io>'),
        hdr('In-Reply-To', '<p@mail>'), hdr('References', '<r@mail>\r\n <p@mail>'),
        hdr('List-Unsubscribe', '<https://u.example/x>, <mailto:u@x.io>'), hdr('Date', 'Tue, 14 Nov 2023 22:13:20 +0000')
      ]
    }))
    expect(m).toMatchObject({
      id: 'gmail-a:m1', threadId: 'gmail-a:t1', remoteId: 'm1', subject: 'Hi', snippet: 'hello & welcome', date: 1700000000000,
      from: { name: 'Ann', email: 'ann@example.com' }, to: [{ email: 'me@example.com' }], cc: [{ email: 'c1@x.io' }], bcc: [{ email: 'b@x.io' }],
      replyTo: { name: 'Support', email: 's@x.io' }, messageIdHeader: '<m1@mail>', inReplyTo: '<p@mail>', references: ['<r@mail>', '<p@mail>'],
      listUnsubscribe: '<https://u.example/x>, <mailto:u@x.io>', unread: true, isDraft: false
    })
    // UNREAD and CATEGORY_* never leak into labelIds; STARRED/INBOX/user labels do.
    expect(m.labelIds.sort()).toEqual(['gmail-a:INBOX', 'gmail-a:Label_9', 'gmail-a:STARRED'])
  })
  it('falls back to the Date header when internalDate is missing and decodes encoded subjects', () => {
    const m = normalizeMessage('a', msg('m', 't', { internalDate: undefined, headers: [hdr('Date', 'Tue, 14 Nov 2023 22:13:20 +0000')] }))
    expect(m.date).toBe(1700000000000)
    const m2 = normalizeMessage('a', { ...msg('m', 't'), payload: { headers: [hdr('Subject', '=?UTF-8?Q?Caf=C3=A9?=')], body: {} } })
    expect(m2.subject).toBe('Café')
  })
})

describe('normalizeThread', () => {
  it('aggregates unread/starred/attachments/participants and uses the newest non-draft for snippet + date', () => {
    const t = normalizeThread('a', 'me@example.com', thread('t1', [
      msg('m1', 't1', { internalDate: '1000', labelIds: ['INBOX'], snippet: 'first' }),
      msg('m2', 't1', {
        internalDate: '3000', labelIds: ['INBOX', 'UNREAD', 'STARRED'], snippet: 'newest',
        headers: [hdr('From', 'Bob <bob@example.com>')]
      }),
      msg('m3', 't1', { internalDate: '9000', labelIds: ['DRAFT'], snippet: 'draft', headers: [hdr('From', 'me@example.com')] })
    ]))!
    expect(t.thread).toMatchObject({
      id: 'a:t1', remoteId: 't1', subject: 'Hi', snippet: 'newest', lastMessageAt: 3000, messageCount: 3, unread: true, starred: true, hasAttachments: false
    })
    expect(t.thread.participants.map((p) => p.email)).toEqual(['ann@example.com', 'bob@example.com'])
    expect(t.messages.find((m) => m.remoteId === 'm3')!.isDraft).toBe(true)
    expect(t.thread.labelIds).toContain('a:DRAFT')
  })

  it('lists recipients for threads that only contain my own messages', () => {
    const t = normalizeThread('a', 'me@example.com', thread('t', [
      msg('m1', 't', { labelIds: ['SENT'], headers: [hdr('From', 'Me <me@example.com>'), hdr('To', 'Zed <zed@x.io>')] })
    ]))!
    expect(t.thread.participants.map((p) => p.email)).toEqual(['me@example.com', 'zed@x.io'])
  })

  it('hides trashed messages inside a live conversation but keeps a fully-trashed thread as trash', () => {
    const live = normalizeThread('a', 'me@x.io', thread('t', [msg('m1', 't', { labelIds: ['TRASH'] }), msg('m2', 't', { labelIds: ['INBOX'] })]))!
    expect(live.messages.map((m) => m.remoteId)).toEqual(['m2'])
    expect(live.thread.labelIds).toEqual(['a:INBOX'])
    const dead = normalizeThread('a', 'me@x.io', thread('t', [msg('m1', 't', { labelIds: ['TRASH'] })]))!
    expect(dead.thread.labelIds).toEqual(['a:TRASH'])
  })

  it('counts non-inline attachments only for hasAttachments', () => {
    const withAtt = msg('m', 't')
    withAtt.payload = { mimeType: 'multipart/mixed', headers: withAtt.payload!.headers, parts: [textPart('text/plain', 'x'), { partId: '1', mimeType: 'application/zip', filename: 'a.zip', body: { size: 5, attachmentId: 'Z' } }] }
    expect(normalizeThread('a', 'me@x.io', thread('t', [withAtt]))!.thread.hasAttachments).toBe(true)
  })

  it('returns null for a thread without messages and uses "(no subject)"', () => {
    expect(normalizeThread('a', 'x@y.z', { id: 't' })).toBeNull()
    const m = msg('m', 't'); m.payload!.headers = []
    expect(normalizeThread('a', 'x@y.z', thread('t', [m]))!.thread.subject).toBe('(no subject)')
  })
})
