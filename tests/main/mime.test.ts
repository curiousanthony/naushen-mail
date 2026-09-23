import { describe, expect, it } from 'vitest'
import { angle, buildRfc822, generateMessageId, toBase64, toBase64Url } from '../../src/main/mime'
import type { Address, OutgoingMessage } from '@shared/types'

const FROM: Address = { name: 'Ada Lovelace', email: 'ada@example.test' }
const DATE = Date.UTC(2026, 0, 2, 3, 4, 5)

const base = (over: Partial<OutgoingMessage> = {}): OutgoingMessage => ({
  accountId: 'acct-1',
  to: [{ name: 'Bob', email: 'bob@example.test' }],
  cc: [],
  bcc: [],
  subject: 'Hello there',
  html: '<div><p>Hi <strong>Bob</strong></p></div>',
  text: 'Hi Bob',
  ...over
})

/** Split a MIME message into headers and body without a parser dependency. */
function headers(raw: string): Record<string, string> {
  const head = raw.split(/\r?\n\r?\n/)[0]
  const unfolded = head.replace(/\r?\n[ \t]+/g, ' ')
  const out: Record<string, string> = {}
  for (const line of unfolded.split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i > 0) out[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim()
  }
  return out
}

const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

describe('buildRfc822', () => {
  it('writes the standard headers', async () => {
    const { raw, messageId } = await buildRfc822(base({ cc: [{ email: 'carol@example.test' }] }), FROM, { date: DATE })
    const h = headers(raw.toString('utf8'))
    expect(h.from).toBe('Ada Lovelace <ada@example.test>')
    expect(h.to).toBe('Bob <bob@example.test>')
    expect(h.cc).toBe('carol@example.test')
    expect(h.subject).toBe('Hello there')
    expect(h['message-id']).toBe(messageId)
    expect(h['mime-version']).toBe('1.0')
    expect(h.date).toContain('2 Jan 2026')
  })

  it('never leaks Bcc into the message headers', async () => {
    const { raw } = await buildRfc822(base({ bcc: [{ email: 'secret@example.test' }] }), FROM, { date: DATE })
    expect(raw.toString('utf8')).not.toContain('secret@example.test')
  })

  it('produces multipart/alternative with both a text and an html part', async () => {
    const raw = (await buildRfc822(base(), FROM, { date: DATE })).raw.toString('utf8')
    expect(headers(raw)['content-type']).toMatch(/^multipart\/alternative; boundary=/)
    expect(raw).toContain('Content-Type: text/plain')
    expect(raw).toContain('Content-Type: text/html')
    expect(raw).toContain('Hi Bob')
  })

  it('falls back to a stripped text alternative when none is supplied', async () => {
    const raw = (await buildRfc822(base({ text: '' }), FROM, { date: DATE })).raw.toString('utf8')
    expect(raw).toContain('Content-Type: text/plain')
    expect(raw).toMatch(/Hi Bob/)
  })

  it('RFC 2047-encodes non-ASCII subjects and display names', async () => {
    const { raw } = await buildRfc822(
      base({ subject: 'Déjeuner à 13h — ça marche ?', to: [{ name: 'Zoë Étienne', email: 'zoe@example.test' }] }),
      { name: 'Ada Løvelace', email: 'ada@example.test' },
      { date: DATE }
    )
    const h = headers(raw.toString('utf8'))
    expect(h.subject).toMatch(/^=\?UTF-8\?/)
    expect(h.subject).not.toContain('Déjeuner')
    expect(h.to).toMatch(/=\?UTF-8\?/)
    expect(h.from).toMatch(/=\?UTF-8\?/)
  })

  it('sets the threading headers and appends the parent to References', async () => {
    const { raw, references } = await buildRfc822(base(), FROM, {
      date: DATE,
      inReplyTo: 'parent@example.test',
      references: ['<root@example.test>', 'mid@example.test']
    })
    const h = headers(raw.toString('utf8'))
    expect(h['in-reply-to']).toBe('<parent@example.test>')
    expect(h.references).toBe('<root@example.test> <mid@example.test> <parent@example.test>')
    expect(references).toEqual(['<root@example.test>', '<mid@example.test>', '<parent@example.test>'])
  })

  it('does not repeat an id already present in References', async () => {
    const { references } = await buildRfc822(base(), FROM, {
      date: DATE, inReplyTo: '<a@x.test>', references: ['<a@x.test>']
    })
    expect(references).toEqual(['<a@x.test>'])
  })

  it('omits threading headers for a new message', async () => {
    const h = headers((await buildRfc822(base(), FROM, { date: DATE })).raw.toString('utf8'))
    expect(h['in-reply-to']).toBeUndefined()
    expect(h.references).toBeUndefined()
  })

  it('embeds inline images as multipart/related parts with a Content-ID', async () => {
    const { raw } = await buildRfc822(base({
      html: '<p><img src="cid:img1@mailroom.local" /></p>',
      attachments: [{ filename: 'tiny.png', mimeType: 'image/png', dataBase64: tinyPng, contentId: 'img1@mailroom.local', inline: true }]
    }), FROM, { date: DATE })
    const text = raw.toString('utf8')
    // multipart/alternative at the top, the html part wrapped in multipart/related below it.
    expect(headers(text)['content-type']).toMatch(/^multipart\/alternative/)
    expect(text).toMatch(/Content-Type: multipart\/related; type="text\/html"/)
    expect(text).toMatch(/Content-ID: <img1@mailroom\.local>/i)
    expect(text).toMatch(/Content-Disposition: inline/)
    expect(text).toContain('Content-Type: image/png')
  })

  it('adds regular attachments as multipart/mixed parts', async () => {
    const { raw } = await buildRfc822(base({
      attachments: [{ filename: 'report.pdf', mimeType: 'application/pdf', dataBase64: Buffer.from('%PDF-1.4 hello').toString('base64') }]
    }), FROM, { date: DATE })
    const text = raw.toString('utf8')
    expect(headers(text)['content-type']).toMatch(/^multipart\/mixed/)
    expect(text).toContain('Content-Type: application/pdf')
    expect(text).toMatch(/Content-Disposition: attachment; filename=(")?report\.pdf/)
    expect(text).toContain('Content-Transfer-Encoding: base64')
  })

  it('round-trips attachment bytes', async () => {
    const payload = Buffer.from('the quick brown fox'.repeat(20))
    const { raw } = await buildRfc822(base({
      attachments: [{ filename: 'a.txt', mimeType: 'text/plain', dataBase64: payload.toString('base64') }]
    }), FROM, { date: DATE })
    const text = raw.toString('utf8')
    const part = text.split('Content-Disposition: attachment')[1]
    const body = part.split(/\r?\n\r?\n/)[1].split('--')[0].replace(/\s+/g, '')
    expect(Buffer.from(body, 'base64').toString('utf8')).toBe(payload.toString('utf8'))
  })

  it('carries extra headers', async () => {
    const { raw } = await buildRfc822(base(), FROM, { date: DATE, headers: { 'X-Mailer': 'Mailroom' } })
    expect(headers(raw.toString('utf8'))['x-mailer']).toBe('Mailroom')
  })

  it('sets Reply-To when given', async () => {
    const { raw } = await buildRfc822(base(), FROM, { date: DATE, replyTo: { email: 'list@example.test' } })
    expect(headers(raw.toString('utf8'))['reply-to']).toBe('list@example.test')
  })

  it('uses CRLF line endings', async () => {
    const raw = (await buildRfc822(base(), FROM, { date: DATE })).raw.toString('utf8')
    expect(raw).toContain('\r\n')
    expect(raw.replace(/\r\n/g, '')).not.toContain('\n')
  })
})

describe('header helpers', () => {
  it('brackets message ids exactly once', () => {
    expect(angle('a@b')).toBe('<a@b>')
    expect(angle('<a@b>')).toBe('<a@b>')
    expect(angle('  a@b ')).toBe('<a@b>')
    expect(angle('')).toBe('')
  })

  it('generates a Message-ID on the sender domain', () => {
    expect(generateMessageId('ada@example.test')).toMatch(/^<[0-9a-f-]{36}@example\.test>$/)
    expect(generateMessageId('nonsense')).toContain('@mailroom.local>')
    expect(generateMessageId('a@x.test')).not.toBe(generateMessageId('a@x.test'))
  })

  it('encodes for Gmail raw and Graph', () => {
    const buf = Buffer.from([0xfb, 0xff, 0x00, 0x3e, 0x3f])
    expect(toBase64Url(buf)).toBe('-_8APj8')
    expect(toBase64(buf)).toBe('+/8APj8=')
    expect(Buffer.from(toBase64(buf), 'base64')).toEqual(buf)
  })
})
