import { describe, expect, it, vi } from 'vitest'
import { fetchImageDataUri, googlePictureUrl } from '../../src/main/providers/avatar'
import { serializeToEmailHtml } from '../../src/shared/emailhtml'

const resp = (body: Uint8Array, type: string, ok = true): Response =>
  ({ ok, status: ok ? 200 : 403, headers: new Headers({ 'content-type': type }), arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) }) as unknown as Response

describe('googlePictureUrl', () => {
  it('upsizes the =s96-c suffix', () => {
    expect(googlePictureUrl('https://lh3.googleusercontent.com/a/abc=s96-c')).toBe('https://lh3.googleusercontent.com/a/abc=s256-c')
  })
  it('leaves other URLs alone', () => {
    expect(googlePictureUrl('https://x.test/p.jpg')).toBe('https://x.test/p.jpg')
  })
})

describe('fetchImageDataUri', () => {
  it('returns a data URI for an image response', async () => {
    const f = vi.fn().mockResolvedValue(resp(new Uint8Array([1, 2, 3]), 'image/jpeg; charset=x'))
    expect(await fetchImageDataUri('https://x.test/a', f as unknown as typeof fetch)).toBe('data:image/jpeg;base64,AQID')
  })
  it('rejects non-https, HTTP errors, non-images, svg, oversized and thrown fetches', async () => {
    const f = (r: Response | Error): typeof fetch =>
      vi.fn().mockImplementation(async () => { if (r instanceof Error) throw r; return r }) as unknown as typeof fetch
    expect(await fetchImageDataUri('http://x.test/a', f(resp(new Uint8Array([1]), 'image/png')))).toBeUndefined()
    expect(await fetchImageDataUri('https://x.test/a', f(resp(new Uint8Array([1]), 'image/png', false)))).toBeUndefined()
    expect(await fetchImageDataUri('https://x.test/a', f(resp(new Uint8Array([1]), 'text/html')))).toBeUndefined()
    expect(await fetchImageDataUri('https://x.test/a', f(resp(new Uint8Array([1]), 'image/svg+xml')))).toBeUndefined()
    expect(await fetchImageDataUri('https://x.test/a', f(resp(new Uint8Array(600 * 1024), 'image/png')))).toBeUndefined()
    expect(await fetchImageDataUri('https://x.test/a', f(new Error('offline')))).toBeUndefined()
  })
})

describe('signature data: images are sent as inline cid parts', () => {
  const sig = '<table><tr><td><img src="data:image/jpeg;base64,AQID" width="56"></td><td>Ada</td></tr></table>'
  it('rewrites the src to cid: and attaches the image once', () => {
    const r = serializeToEmailHtml({ type: 'doc', content: [] }, { signatureHtml: sig + sig, cidPrefix: 'p' })
    expect(r.html).not.toContain('data:image')
    expect(r.html.match(/cid:p-\d+@mailroom\.local/g)).toHaveLength(2)
    expect(r.inlineImages).toHaveLength(1)
    expect(r.inlineImages[0]).toMatchObject({ mimeType: 'image/jpeg', dataBase64: 'AQID' })
  })
  it('leaves https images untouched', () => {
    const r = serializeToEmailHtml({ type: 'doc', content: [] }, { signatureHtml: '<img src="https://x.test/a.png">' })
    expect(r.html).toContain('https://x.test/a.png')
    expect(r.inlineImages).toHaveLength(0)
  })
})
