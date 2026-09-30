// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { sanitizeSignature } from '@/features/settings/lib/signatureSanitize'
import { renderSignatureTemplate, SIGNATURE_TEMPLATES } from '@/features/settings/sections/signatureTemplates'
import { buildOutgoing } from '@/features/compose/send'
import { sanitizeFragment } from '@shared/sanitize'

const photoTemplate = SIGNATURE_TEMPLATES.find((t) => t.id === 'photo-left')!

const httpsAvatar = { name: 'Ada Lovelace', email: 'ada@example.com', avatarUrl: 'https://cdn.example.com/ada.jpg', color: '#2383e2' }
const dataUriAvatar = { name: 'Ada Lovelace', email: 'ada@example.com', avatarUrl: 'data:image/jpeg;base64,AAAA', color: '#2383e2' }
const noAvatar = { name: 'Ada Lovelace', email: 'ada@example.com', color: '#2383e2' }

describe('renderSignatureTemplate — token substitution', () => {
  it('fills {{name}} and {{email}} for every template, leaving placeholder text untouched', () => {
    for (const tpl of SIGNATURE_TEMPLATES) {
      const html = renderSignatureTemplate(tpl, noAvatar)
      expect(html).toContain('Ada Lovelace')
      if (tpl.body.includes('{{email}}')) expect(html).toContain('ada@example.com')
      expect(html).not.toContain('{{')
      expect(html.toLowerCase()).toContain('your title')
    }
  })

  it('escapes HTML-significant characters in name and email', () => {
    const html = renderSignatureTemplate(SIGNATURE_TEMPLATES[0], { name: '<b>Ada</b> & Co', email: 'a@b.test', color: '#000' })
    expect(html).not.toContain('<b>Ada</b>')
    expect(html).toContain('&lt;b&gt;Ada&lt;/b&gt; &amp; Co')
  })

  it('falls back to the email when the account has no name', () => {
    const html = renderSignatureTemplate(SIGNATURE_TEMPLATES[0], { name: '', email: 'noname@example.com', color: '#000' })
    expect(html).toContain('noname@example.com')
  })
})

describe('photo-left template — avatar selection', () => {
  it('uses an <img> for an https avatarUrl', () => {
    const html = renderSignatureTemplate(photoTemplate, httpsAvatar)
    expect(html).toContain('<img src="https://cdn.example.com/ada.jpg"')
    expect(html).toContain('border-radius:50%')
  })

  it('uses a data: URI avatar as the <img> (converted to a cid: part when sent)', () => {
    const html = renderSignatureTemplate(photoTemplate, dataUriAvatar)
    expect(html).toContain('<img src="data:image/jpeg;base64,AAAA"')
    expect(html).toContain('border-radius:50%')
  })

  it('falls back to initials for an SVG data: URI', () => {
    const html = renderSignatureTemplate(photoTemplate, { ...noAvatar, avatarUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' })
    expect(html).not.toContain('<img')
    expect(html).toContain('>A<')
  })

  it('falls back to an initials circle when there is no avatarUrl at all', () => {
    const html = renderSignatureTemplate(photoTemplate, noAvatar)
    expect(html).not.toContain('<img')
    expect(html).toContain('>A<')
  })
})

describe('sanitizeSignature — keeps real signature layouts intact', () => {
  it('keeps table/tr/td structure and inline styles for the photo-left template', () => {
    const rendered = renderSignatureTemplate(photoTemplate, httpsAvatar)
    const out = sanitizeSignature(rendered)
    expect(out).toContain('<table')
    expect(out).toContain('<tr>')
    expect(out).toContain('<td')
    expect(out).toContain('<img')
    expect(out).toContain('border-radius:50%')
    expect(out).toContain('Ada Lovelace')
    expect(out).toContain('ada@example.com')
  })

  it('is idempotent (it runs again on every keystroke and every preview render)', () => {
    const rendered = renderSignatureTemplate(photoTemplate, httpsAvatar)
    const once = sanitizeSignature(rendered)
    const twice = sanitizeSignature(once)
    expect(twice).toBe(once)
  })

  it('keeps the classic-block divider and the compact one-liner', () => {
    const classic = sanitizeSignature(renderSignatureTemplate(SIGNATURE_TEMPLATES.find((t) => t.id === 'classic')!, noAvatar))
    expect(classic).toContain('<hr')
    const compact = sanitizeSignature(renderSignatureTemplate(SIGNATURE_TEMPLATES.find((t) => t.id === 'compact')!, noAvatar))
    expect(compact).toContain('Ada Lovelace')
  })

  it('strips script tags and event handlers', () => {
    const out = sanitizeSignature('<p>hi</p><script>alert(1)</script><img src="https://a.test/x.png" onerror="alert(1)">')
    expect(out).not.toMatch(/script/i)
    expect(out.toLowerCase()).not.toContain('onerror')
  })

  it('drops dangerous CSS from a style attribute (expression/javascript/@import)', () => {
    const out = sanitizeSignature('<div style="color:red;width:expression(alert(1))">x</div>')
    expect(out).not.toMatch(/expression/i)
  })

  it('drops CSS properties outside the allowlist (e.g. position, which could restyle the app)', () => {
    const out = sanitizeSignature('<div style="position:fixed;top:0;left:0;color:red">x</div>')
    expect(out).not.toContain('position')
    expect(out).toContain('color:red')
  })

  it('rejects an SVG data-URI image (a script container) even though PNG/JPEG data URIs are kept', () => {
    const svg = sanitizeSignature('<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">')
    expect(svg).not.toContain('<img')
    const png = sanitizeSignature('<img src="data:image/png;base64,iVBORw0KGgo=">')
    expect(png).toContain('<img')
  })

  it('drops a plain http (non-https) image source', () => {
    const out = sanitizeSignature('<img src="http://a.test/x.png">')
    expect(out).not.toContain('<img')
  })

  it('does not let a table alone count as empty content', () => {
    // Sanity: a template that is just a photo (no text) must still be treated as "has content"
    // by the emptiness check the settings UI relies on to decide whether to confirm before replacing.
    const out = sanitizeSignature('<table><tr><td><img src="https://a.test/x.png"></td></tr></table>')
    expect(out).not.toBe('')
  })
})

describe('the outgoing pipeline does not re-mangle a templated signature', () => {
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Sure, sounds good.' }] }] }

  it('serializeToEmailHtml (via buildOutgoing) drops the sanitized template verbatim into the MIME body', () => {
    const signatureHtml = sanitizeSignature(renderSignatureTemplate(photoTemplate, httpsAvatar))
    const { message } = buildOutgoing({
      accountId: 'a', to: [{ email: 'x@y.test' }], cc: [], bcc: [], subject: 's', doc, signatureHtml
    })
    expect(message.html).toContain(signatureHtml)
    expect(message.html).toContain('<table')
    expect(message.html).toContain('border-radius:50%')
    expect(message.html).toContain('<img src="https://cdn.example.com/ada.jpg"')
    // Plain-text alternative: the crude tag-stripper still leaves the name and email readable.
    expect(message.text).toContain('Ada Lovelace')
  })

  it('sanitizeFragment (the composer\'s live signature preview) also keeps table/img/style', () => {
    const signatureHtml = sanitizeSignature(renderSignatureTemplate(photoTemplate, httpsAvatar))
    const out = sanitizeFragment(signatureHtml)
    expect(out).toContain('<table')
    expect(out).toContain('<img')
    expect(out).toContain('border-radius:50%')
  })
})
