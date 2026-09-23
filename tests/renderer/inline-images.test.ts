// @vitest-environment jsdom
//
// Focused unit tests for the reader's cid: resolution: (1) the pure gate that decides whether
// a message is worth a `messages.inlineImages` IPC round trip, and (2) sanitizeEmailHtml's
// existing `cidMap` option (the mechanism MessageBody feeds a fake IPC response through) —
// asserting cid: srcs get swapped for data: URLs, and an unmatched contentId still falls back
// to the sanitiser's normal blocked-cid placeholder. No real IPC, no network.
import { describe, expect, it } from 'vitest'
import type { Attachment } from '@shared/types'
import { sanitizeEmailHtml } from '@shared/sanitize'
import { needsInlineImageResolution } from '@/features/reader/MessageBody'

const inlineAttachment = (over: Partial<Attachment> = {}): Attachment => ({
  id: 'att1', filename: 'logo.png', mimeType: 'image/png', size: 10, inline: true, contentId: 'logo123', ...over
})

describe('needsInlineImageResolution', () => {
  it('is false with no attachments', () => {
    expect(needsInlineImageResolution([])).toBe(false)
  })

  it('is false when every attachment is a regular (non-inline) one', () => {
    expect(needsInlineImageResolution([inlineAttachment({ inline: false })])).toBe(false)
  })

  it('is true as soon as one attachment is inline', () => {
    expect(needsInlineImageResolution([
      inlineAttachment({ id: 'doc', filename: 'invoice.pdf', mimeType: 'application/pdf', inline: false, contentId: undefined }),
      inlineAttachment()
    ])).toBe(true)
  })
})

describe('sanitizeEmailHtml cidMap resolution (fake IPC response)', () => {
  const html = '<p>Hi</p><img src="cid:logo123" width="40" height="40">'

  it('leaves a cid: image as an unresolved placeholder before the IPC call returns', () => {
    const out = sanitizeEmailHtml(html)
    expect(out.unresolvedCidCount).toBe(1)
    expect(out.html).not.toContain('data:image/png')
    expect(out.html).toContain('data-mr-cid="logo123"')
  })

  it('swaps the cid: src for the data: URL once a fake messages.inlineImages response arrives', () => {
    // Shape mirrors the real IPC handler's Record<contentId, dataUrl> result.
    const fakeIpcResponse: Record<string, string> = { logo123: 'data:image/png;base64,QUJD' }
    const out = sanitizeEmailHtml(html, { cidMap: fakeIpcResponse })
    expect(out.unresolvedCidCount).toBe(0)
    expect(out.html).toContain('src="data:image/png;base64,QUJD"')
    expect(out.html).not.toContain('data-mr-cid')
  })

  it('falls back to the placeholder when the IPC response has no entry for that Content-ID', () => {
    const out = sanitizeEmailHtml(html, { cidMap: { 'someone-elses-cid': 'data:image/png;base64,ZZZ' } })
    expect(out.unresolvedCidCount).toBe(1)
    expect(out.html).toContain('data-mr-cid="logo123"')
    expect(out.html).not.toContain('data:image/png;base64,ZZZ')
  })
})
