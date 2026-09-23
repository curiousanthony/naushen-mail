import { describe, expect, it } from 'vitest'
import { buildRaw } from '../../../src/main/providers/gmail/mime'
import type { OutgoingMessage } from '../../../src/shared/types'

const base: OutgoingMessage = {
  accountId: 'gmail-a', to: [{ name: 'Zoë Ünal', email: 'zoe@example.com' }], cc: [{ email: 'cc@example.com' }], bcc: [{ email: 'secret@example.com' }],
  subject: 'Réunion demain ✓', html: '<p>Bonjour <b>Zoë</b></p><img src="cid:logo1">', text: 'Bonjour Zoë'
}

describe('buildRaw (MailComposer)', () => {
  it('produces a multipart/alternative RFC 5322 message with encoded headers and keeps Bcc for Gmail', async () => {
    const raw = (await buildRaw(base, { from: { name: 'Anthony', email: 'me@gmail.com' } })).toString()
    expect(raw).toMatch(/^From: Anthony <me@gmail.com>/m)
    expect(raw).toMatch(/^To: =\?UTF-8\?Q\?Zo=C3=AB_=C3=9Cnal\?= <zoe@example.com>/m)
    expect(raw).toMatch(/^Cc: cc@example.com/m)
    expect(raw).toMatch(/^Bcc: secret@example.com/m)
    expect(raw).toMatch(/^Subject: =\?UTF-8\?/m)
    expect(raw).toMatch(/^Message-ID: </m)
    expect(raw).toMatch(/Content-Type: multipart\/alternative/)
    expect(raw).toMatch(/Content-Type: text\/plain/)
    expect(raw).toMatch(/Content-Type: text\/html/)
  })

  it('adds In-Reply-To / References for replies', async () => {
    const raw = (await buildRaw(base, { from: { email: 'me@gmail.com' }, inReplyTo: '<p2@mail>', references: ['<p1@mail>', '<p2@mail>'] })).toString()
    expect(raw).toMatch(/^In-Reply-To: <p2@mail>/m)
    expect(raw).toMatch(/^References: <p1@mail> <p2@mail>/m)
  })

  it('embeds attachments and cid-inline images (multipart/related inside mixed)', async () => {
    const raw = (await buildRaw({
      ...base,
      attachments: [
        { filename: 'notes.txt', mimeType: 'text/plain', dataBase64: Buffer.from('attached!').toString('base64') },
        { filename: 'logo.png', mimeType: 'image/png', dataBase64: Buffer.from([1, 2, 3]).toString('base64'), contentId: 'logo1', inline: true }
      ]
    }, { from: { email: 'me@gmail.com' } })).toString()
    expect(raw).toMatch(/multipart\/mixed/)
    expect(raw).toMatch(/multipart\/related/)
    expect(raw).toMatch(/Content-Id: <logo1>/i)
    expect(raw).toMatch(/Content-Disposition: attachment; filename=notes.txt/i)
    expect(raw).toContain(Buffer.from('attached!').toString('base64'))
  })
})
