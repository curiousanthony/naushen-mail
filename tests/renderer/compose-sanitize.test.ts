// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { sanitizeFragment } from '@shared/sanitize'

// The composer renders three things with `sanitizeFragment` + `dangerouslySetInnerHTML`,
// straight into the app's own (unsandboxed) document, and reuses the same HTML verbatim in
// outgoing mail: the quoted/forwarded message preview and the signature preview. See
// `Composer.tsx` and `send.ts` -> `serializeToEmailHtml`.

describe('sanitizeFragment — script execution vectors', () => {
  it('removes <script> and its contents', () => {
    const out = sanitizeFragment('<p>hi</p><script>alert(1)</script>')
    expect(out).not.toMatch(/script/i)
    expect(out).not.toContain('alert(1)')
    expect(out).toContain('hi')
  })

  it('strips event handler attributes', () => {
    const out = sanitizeFragment('<img src="x" onerror="alert(1)">')
    expect(out).not.toContain('onerror')
  })

  it('drops javascript: links but keeps the text', () => {
    const out = sanitizeFragment('<a href="javascript:alert(1)">click</a>')
    expect(out).not.toContain('javascript:')
    expect(out).toContain('click')
  })

  it('adds safe rel/target to a kept http(s) link', () => {
    const out = sanitizeFragment('<a href="https://example.com">site</a>')
    expect(out).toContain('href="https://example.com"')
    expect(out).toContain('rel="noopener noreferrer nofollow"')
    expect(out).toContain('target="_blank"')
  })

  it('strips <style> — a fragment renders straight into the app document, with no iframe boundary', () => {
    const out = sanitizeFragment('<style>body{display:none}</style><p>hi</p>')
    expect(out).not.toMatch(/<style/i)
    expect(out).toContain('hi')
  })

  it('forbids iframe/object/form', () => {
    const out = sanitizeFragment('<iframe src="https://evil.example"></iframe><object></object><form></form>')
    expect(out).not.toMatch(/<iframe|<object|<form/i)
  })
})

describe('sanitizeFragment — must not rewrite content (outgoing-mail safety)', () => {
  it('leaves a remote <img src> untouched — the reply/forward preview reuses this HTML verbatim as the outgoing body', () => {
    const out = sanitizeFragment('<img src="https://example.com/logo.png" alt="logo">')
    expect(out).toContain('src="https://example.com/logo.png"')
    expect(out).not.toContain('data-mr-blocked')
    expect(out).not.toContain('data:image/gif') // no transparent-GIF placeholder swap
  })

  it('does not resolve or touch cid: image sources', () => {
    const out = sanitizeFragment('<img src="cid:abc123" alt="inline">')
    expect(out).toContain('src="cid:abc123"')
    expect(out).not.toContain('data-mr-cid')
  })

  it('does not add quoted-text markers', () => {
    const out = sanitizeFragment('<blockquote>On Tue, X wrote:</blockquote>')
    expect(out).not.toContain('data-mr-quote')
  })

  it('is idempotent — re-sanitising already-clean output changes nothing', () => {
    const once = sanitizeFragment('<p>Hello <b>world</b></p><img src="https://example.com/a.png">')
    const twice = sanitizeFragment(once)
    expect(twice).toBe(once)
  })
})

describe('sanitizeFragment — trivial input', () => {
  it('returns empty string for empty/whitespace input', () => {
    expect(sanitizeFragment('')).toBe('')
    expect(sanitizeFragment('   ')).toBe('')
  })

  it('passes plain text through unharmed', () => {
    expect(sanitizeFragment('<p>Just <em>text</em>.</p>')).toContain('Just <em>text</em>.')
  })
})
