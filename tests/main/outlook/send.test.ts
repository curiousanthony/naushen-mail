import { describe, expect, it } from 'vitest'
import { INLINE_ATTACHMENT_LIMIT, mergeQuote } from '../../../src/main/providers/outlook/adapter'
import type { OutgoingMessage } from '../../../src/shared/types'
import { makeAdapter, type Handler } from './fake'

const ACC = 'outlook-me-outlook-com'
const base = (over: Partial<OutgoingMessage> = {}): OutgoingMessage => ({
  accountId: ACC, to: [{ name: 'Dana', email: 'dana@contoso.com' }], cc: [{ email: 'cc@x.com' }], bcc: [], subject: 'Hello', html: '<p>Hi</p>', text: 'Hi', ...over
})
const ok: Handler = (c) => (c.method === 'POST' && c.path.endsWith('/send') ? { status: 202 } : c.method === 'PATCH' ? { json: {} } : undefined)
const writes = (calls: ReturnType<typeof makeAdapter>['calls']) => calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`)

describe('send', () => {
  it('new message => POST /me/sendMail with an HTML body, recipients and saveToSentItems', async () => {
    const h = makeAdapter([(c) => (c.path === '/me/sendMail' ? { status: 202 } : undefined)])
    await h.adapter.send(base())
    const call = h.calls.at(-1)!
    expect(call.method).toBe('POST')
    expect(call.path).toBe('/me/sendMail')
    expect(call.headers.prefer).toContain('IdType="ImmutableId"')
    expect(call.body).toEqual({
      message: {
        subject: 'Hello', body: { contentType: 'HTML', content: '<p>Hi</p>' },
        toRecipients: [{ emailAddress: { address: 'dana@contoso.com', name: 'Dana' } }],
        ccRecipients: [{ emailAddress: { address: 'cc@x.com' } }], bccRecipients: [], attachments: []
      },
      saveToSentItems: true
    })
  })

  it('attachments become base64 fileAttachments; cid images are inline with a contentId', async () => {
    const h = makeAdapter([(c) => (c.path === '/me/sendMail' ? { status: 202 } : undefined)])
    await h.adapter.send(base({ attachments: [
      { filename: 'a.pdf', mimeType: 'application/pdf', dataBase64: 'QUJD' },
      { filename: 'logo.png', mimeType: 'image/png', dataBase64: 'AAAA', contentId: '<logo@mailroom>', inline: true }
    ] }))
    expect(h.calls.at(-1)!.body.message.attachments).toEqual([
      { '@odata.type': '#microsoft.graph.fileAttachment', name: 'a.pdf', contentType: 'application/pdf', contentBytes: 'QUJD', isInline: false },
      { '@odata.type': '#microsoft.graph.fileAttachment', name: 'logo.png', contentType: 'image/png', contentBytes: 'AAAA', isInline: true, contentId: 'logo@mailroom' }
    ])
  })

  it('reply => createReply, PATCH body (new text above the quote) + recipients, then send', async () => {
    const h = makeAdapter([ok, (c) => (c.path === '/me/messages/orig1/createReply' ? { status: 201, json: { id: 'draft1', subject: 'RE: Hello', body: { contentType: 'html', content: '<html><body><div>QUOTED</div></body></html>' } } } : undefined)])
    await h.adapter.send(base({ inReplyTo: { threadId: `${ACC}:C1`, messageId: `${ACC}:orig1`, mode: 'reply' }, subject: '', html: '<p>Thanks!</p>' }))
    expect(writes(h.calls)).toEqual(['POST /me/messages/orig1/createReply', 'PATCH /me/messages/draft1', 'POST /me/messages/draft1/send'])
    const patch = h.calls.find((c) => c.method === 'PATCH')!
    expect(patch.body.body).toEqual({ contentType: 'HTML', content: '<html><body><p>Thanks!</p><br><div>QUOTED</div></body></html>' })
    expect(patch.body.subject).toBe('RE: Hello')
    expect(patch.body.toRecipients).toEqual([{ emailAddress: { address: 'dana@contoso.com', name: 'Dana' } }])
  })

  it('replyAll / forward pick the right endpoint', async () => {
    for (const [mode, ep] of [['replyAll', 'createReplyAll'], ['forward', 'createForward']] as const) {
      const h = makeAdapter([ok, (c) => (c.path.endsWith(`/${ep}`) ? { status: 201, json: { id: 'd', body: { content: '' } } } : undefined)])
      await h.adapter.send(base({ inReplyTo: { threadId: 't', messageId: 'orig1', mode } }))
      expect(h.calls.filter((c) => c.method === 'POST')[0].path).toBe(`/me/messages/orig1/${ep}`)
    }
  })

  it('a composer quote (blockquote type=cite) is used as-is instead of Graph\'s', () => {
    const html = '<p>x</p><blockquote type="cite">old</blockquote>'
    expect(mergeQuote(html, '<html><body>GRAPH QUOTE</body></html>')).toBe(html)
    expect(mergeQuote('<p>x</p>', '')).toBe('<p>x</p>')
    expect(mergeQuote('<p>x</p>', '<div>q</div>')).toBe('<p>x</p><div>q</div>')
  })

  it('a failed reply send deletes the stray draft and rethrows', async () => {
    const h = makeAdapter([
      (c) => (c.path.endsWith('/send') ? { status: 400, json: { error: { code: 'ErrorInvalidRecipients', message: 'bad' } } } : undefined),
      ok, (c) => (c.path.endsWith('/createReply') ? { status: 201, json: { id: 'draft1', body: { content: '' } } } : undefined), (c) => (c.method === 'DELETE' ? { status: 204 } : undefined)
    ])
    await expect(h.adapter.send(base({ inReplyTo: { threadId: 't', messageId: 'orig1', mode: 'reply' } }))).rejects.toMatchObject({ code: 'ErrorInvalidRecipients' })
    expect(h.calls.at(-1)).toMatchObject({ method: 'DELETE', path: '/me/messages/draft1' })
  })

  it('sending an existing remote draft patches it and sends it (draft is kept if send fails)', async () => {
    const h = makeAdapter([ok, (c) => (c.method === 'GET' && c.path === '/me/messages/dr9/attachments' ? { json: { value: [] } } : undefined)])
    await h.adapter.send(base({ draftId: 'dr9' }))
    expect(writes(h.calls)).toEqual(['PATCH /me/messages/dr9', 'POST /me/messages/dr9/send'])
  })

  it('large attachments go through a draft + upload session (chunked PUT without the bearer token) then send', async () => {
    const big = Buffer.alloc(4_000_000, 1)
    const h = makeAdapter([
      ok,
      (c) => (c.method === 'POST' && c.path === '/me/messages' ? { status: 201, json: { id: 'draftB' } } : undefined),
      (c) => (c.path.endsWith('/createUploadSession') ? { status: 201, json: { uploadUrl: 'https://outlook.office.com/api/upload/xyz' } } : undefined),
      (c) => (c.url.startsWith('https://outlook.office.com/') ? { status: 201 } : undefined)
    ])
    await h.adapter.send(base({ attachments: [{ filename: 'big.bin', mimeType: 'application/octet-stream', dataBase64: big.toString('base64') }] }))
    expect(writes(h.calls)).toEqual(['POST /me/messages', 'POST /me/messages/draftB/attachments/createUploadSession', 'PUT /api/upload/xyz', 'PUT /api/upload/xyz', 'POST /me/messages/draftB/send'])
    const session = h.calls.find((c) => c.path.endsWith('createUploadSession'))!
    expect(session.body.AttachmentItem).toMatchObject({ attachmentType: 'file', name: 'big.bin', size: big.length })
    const puts = h.calls.filter((c) => c.method === 'PUT')
    expect(puts.every((p) => p.headers.authorization === undefined)).toBe(true)
    expect(puts[0].headers['content-range']).toBe(`bytes 0-3932159/${big.length}`)
    expect(puts[1].headers['content-range']).toBe(`bytes 3932160-${big.length - 1}/${big.length}`)
    expect(h.calls.find((c) => c.method === 'POST' && c.path === '/me/messages')!.body.attachments).toBeUndefined()
  })
})

describe('drafts', () => {
  it('saveDraft creates a draft and returns its id', async () => {
    const h = makeAdapter([(c) => (c.method === 'POST' && c.path === '/me/messages' ? { status: 201, json: { id: 'D1' } } : undefined)])
    expect(await h.adapter.saveDraft(base())).toEqual({ remoteDraftId: 'D1' })
    expect(h.calls.at(-1)!.body).toMatchObject({ subject: 'Hello', body: { contentType: 'HTML' } })
  })

  it('saveDraft with an existing id PATCHes and reconciles attachments by name', async () => {
    const h = makeAdapter([
      (c) => (c.method === 'GET' && c.path === '/me/messages/D1/attachments' ? { json: { value: [{ id: 'A1', name: 'old.txt' }, { id: 'A2', name: 'keep.txt' }] } } : undefined),
      (c) => (c.method === 'PATCH' ? { json: {} } : c.method === 'DELETE' ? { status: 204 } : c.method === 'POST' ? { status: 201, json: {} } : undefined)
    ])
    const r = await h.adapter.saveDraft(base({ draftId: `${ACC}:D1`, attachments: [{ filename: 'keep.txt', mimeType: 'text/plain', dataBase64: 'QQ==' }, { filename: 'new.txt', mimeType: 'text/plain', dataBase64: 'Qg==' }] }))
    expect(r.remoteDraftId).toBe('D1')
    expect(writes(h.calls)).toEqual(['PATCH /me/messages/D1', 'DELETE /me/messages/D1/attachments/A1', 'POST /me/messages/D1/attachments'])
    expect(h.calls.at(-1)!.body.name).toBe('new.txt')
  })

  it('deleteDraft DELETEs and ignores an already-deleted draft', async () => {
    const h = makeAdapter([(c) => (c.method === 'DELETE' ? { status: 404, json: { error: { code: 'ErrorItemNotFound', message: 'x' } } } : undefined)])
    await h.adapter.deleteDraft(`${ACC}:D1`)
    expect(h.calls.at(-1)).toMatchObject({ method: 'DELETE', path: '/me/messages/D1' })
  })
})

describe('fetchAttachment', () => {
  it('downloads raw bytes from $value', async () => {
    const h = makeAdapter([(c) => (c.path === '/me/messages/m1/attachments/a1/$value' ? { bytes: Buffer.from('hello') } : undefined)])
    expect((await h.adapter.fetchAttachment('m1', 'a1')).toString()).toBe('hello')
    expect(h.calls.at(-1)!.headers.accept).toBe('*/*')
  })
  it('falls back to contentBytes when $value is refused', async () => {
    const h = makeAdapter([
      (c) => (c.path.endsWith('/$value') ? { status: 400, json: { error: { code: 'BadRequest', message: 'no' } } } : undefined),
      (c) => (c.path === '/me/messages/m1/attachments/a1' ? { json: { contentBytes: Buffer.from('fallback').toString('base64') } } : undefined)
    ])
    expect((await h.adapter.fetchAttachment(`${ACC}:m1`, 'a1')).toString()).toBe('fallback')
  })
})
