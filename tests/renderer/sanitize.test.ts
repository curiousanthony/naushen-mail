// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { sanitizeEmailHtml } from '@shared/sanitize'
import {
  cidOf, cssUrls, isRemoteImageSrc, isSafeDataImage, isSafeLink, normalizeUrl,
  scrubInlineStyle, scrubStyleSheet, splitDeclarations, formatBytes
} from '@shared/sanitize/urls'
import { linkifyLine, plainTextToHtml, escapeHtml } from '@shared/sanitize/text'

const clean = (html: string, allowRemoteImages = false): string =>
  sanitizeEmailHtml(html, { allowRemoteImages }).html

describe('sanitizeEmailHtml — script execution vectors', () => {
  it('removes <script> and its contents', () => {
    const out = clean('<p>hi</p><script>alert(1)</script>')
    expect(out).not.toMatch(/script/i)
    expect(out).not.toContain('alert(1)')
    expect(out).toContain('hi')
  })

  it('strips every on* event handler', () => {
    for (const evt of ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onanimationstart']) {
      const out = clean(`<div ${evt}="alert(1)">x</div>`)
      expect(out.toLowerCase()).not.toContain(evt)
      expect(out).not.toContain('alert(1)')
    }
  })

  it('strips handlers written with odd casing and entities', () => {
    const out = clean('<img src="x" OnErRoR="alert(1)">')
    expect(out.toLowerCase()).not.toContain('onerror')
  })

  it('removes <iframe>, <object>, <embed> and <form>', () => {
    const out = clean(
      '<iframe src="https://evil.test"></iframe><object data="x.swf"></object>' +
      '<embed src="x"><form action="https://evil.test"><input name="pw"></form>'
    )
    expect(out).not.toMatch(/iframe|object|embed|<form|<input/i)
  })

  it('removes <base> so relative links cannot be re-pointed', () => {
    const out = clean('<base href="https://evil.test/"><a href="/x">x</a>')
    expect(out).not.toMatch(/<base/i)
  })

  it('removes <meta http-equiv="refresh"> — it navigates without scripts', () => {
    const out = clean('<meta http-equiv="refresh" content="0;url=https://evil.test">hello')
    expect(out).not.toMatch(/<meta/i)
    expect(out).not.toContain('evil.test')
  })

  it('removes <svg>, including script and animation payloads', () => {
    const out = clean('<svg><script>alert(1)</script><animate onbegin="alert(1)"/></svg>')
    expect(out).not.toMatch(/svg|animate|alert/i)
  })

  it('drops <noscript>/<template> smuggling wrappers', () => {
    const out = clean('<noscript><p title="</noscript><img src=x onerror=alert(1)>">x</p></noscript>')
    expect(out.toLowerCase()).not.toContain('onerror')
  })

  it('neutralises the classic mXSS mutation vector', () => {
    const out = clean('<noscript><p title="</noscript><img src=x onerror=alert(1)>">')
    expect(out.toLowerCase()).not.toContain('onerror')
    expect(out).not.toContain('alert(1)')
  })
})

describe('sanitizeEmailHtml — links', () => {
  it('rewrites safe links to open externally', () => {
    const out = clean('<a href="https://example.com/x">x</a>')
    expect(out).toContain('target="_blank"')
    expect(out).toContain('rel="noopener noreferrer nofollow"')
    expect(out).toContain('href="https://example.com/x"')
  })

  it('keeps mailto: and tel:', () => {
    expect(clean('<a href="mailto:a@b.test">m</a>')).toContain('mailto:a@b.test')
    expect(clean('<a href="tel:+33123">t</a>')).toContain('tel:+33123')
  })

  it('drops javascript: hrefs but keeps the text', () => {
    const out = clean('<a href="javascript:alert(1)">click</a>')
    expect(out).not.toContain('javascript:')
    expect(out).toContain('click')
  })

  it('drops javascript: obfuscated with control characters and entities', () => {
    for (const href of [
      'java\tscript:alert(1)',
      ' JaVaScRiPt:alert(1)',
      String.fromCharCode(1) + 'javascript:alert(1)',
      '&#106;avascript:alert(1)'
    ]) {
      const out = clean(`<a href="${href}">c</a>`)
      expect(out.replace(/[\x00-\x20]/g, '').toLowerCase()).not.toContain('javascript:alert')
    }
  })

  it('drops data: and vbscript: hrefs', () => {
    expect(clean('<a href="data:text/html,<script>alert(1)</script>">x</a>')).not.toContain('data:text/html')
    expect(clean('<a href="vbscript:msgbox(1)">x</a>')).not.toContain('vbscript')
  })

  it('removes the ping attribute', () => {
    expect(clean('<a href="https://e.test" ping="https://track.test">x</a>')).not.toContain('ping=')
  })
})

describe('sanitizeEmailHtml — style attributes and sheets', () => {
  it('drops expression() and -moz-binding declarations', () => {
    const out = clean('<div style="width:expression(alert(1));color:red;-moz-binding:url(x.xml)">x</div>')
    expect(out).not.toMatch(/expression|moz-binding/i)
    expect(out).toContain('color:red')
  })

  it('drops url() in inline styles when remote content is blocked', () => {
    const r = sanitizeEmailHtml('<div style="background-image:url(https://track.test/p.gif);color:#333">x</div>')
    expect(r.html).not.toContain('track.test')
    expect(r.html).toContain('color:#333')
  })

  it('keeps url() in inline styles when images are allowed', () => {
    const r = sanitizeEmailHtml('<div style="background-image:url(https://cdn.test/p.gif)">x</div>', { allowRemoteImages: true })
    expect(r.html).toContain('cdn.test')
  })

  it('keeps <style> but strips @import and javascript: from it', () => {
    const out = clean('<style>@import url("https://evil.test/x.css"); p { color: red } a { background: javascript:alert(1) }</style><p>x</p>')
    expect(out).toContain('<style>')
    expect(out).not.toMatch(/@import|javascript:/i)
    expect(out).toContain('color: red')
  })

  it('rewrites remote url() inside <style> when blocking', () => {
    const out = clean('<style>body{background:url(https://track.test/x.png)}</style>')
    expect(out).not.toContain('track.test')
  })

  it('reports authored colours', () => {
    expect(sanitizeEmailHtml('<div style="color:#111">x</div>').hasAuthoredColors).toBe(true)
    expect(sanitizeEmailHtml('<table><tr><td bgcolor="#f6f5f4">x</td></tr></table>').hasAuthoredColors).toBe(true)
    expect(sanitizeEmailHtml('<p>plain</p>').hasAuthoredColors).toBe(false)
  })

  it('separates an authored background from a mere text colour', () => {
    // Only a background means "designed for a light page" — that is what sends a message to
    // the reader's paper surface in dark mode.
    expect(sanitizeEmailHtml('<div style="color:#222">x</div>').hasAuthoredBackground).toBe(false)
    expect(sanitizeEmailHtml('<div style="background:#fff">x</div>').hasAuthoredBackground).toBe(true)
    expect(sanitizeEmailHtml('<div style="background-color:#fff">x</div>').hasAuthoredBackground).toBe(true)
    expect(sanitizeEmailHtml('<table><tr><td bgcolor="#eee">x</td></tr></table>').hasAuthoredBackground).toBe(true)
    expect(sanitizeEmailHtml('<style>.a{background:#fff}</style><p>x</p>').hasAuthoredBackground).toBe(true)
    expect(sanitizeEmailHtml('<p>plain</p>').hasAuthoredBackground).toBe(false)
  })

  it('tags elements whose text colour the reader may need to neutralise', () => {
    expect(sanitizeEmailHtml('<div style="color:#222">x</div>').html).toContain('data-mr-fg')
    expect(sanitizeEmailHtml('<font color="#222">x</font>').html).toContain('data-mr-fg')
    // A background is not a text colour: nothing to neutralise.
    expect(sanitizeEmailHtml('<div style="background:#fff">x</div>').html).not.toContain('data-mr-fg')
  })
})

describe('sanitizeEmailHtml — images', () => {
  it('blocks remote images and keeps a placeholder', () => {
    const r = sanitizeEmailHtml('<img src="https://cdn.test/hero.png" width="600" height="200" alt="Hero">')
    expect(r.remoteImageCount).toBe(1)
    expect(r.blockedImageCount).toBe(1)
    expect(r.html).toContain('data-mr-blocked="1"')
    expect(r.html).toContain('data:image/gif;base64')
    expect(r.html).not.toContain('cdn.test')
    expect(r.html).toContain('alt="Hero"')
  })

  it('pins the placeholder to the declared size so layout does not shift', () => {
    // Without this the 1x1 placeholder GIF's intrinsic ratio wins and a 520x200 banner
    // reserves a 520x520 hole.
    const r = sanitizeEmailHtml('<img src="https://cdn.test/hero.png" width="520" height="200">')
    expect(r.html).toContain('width:520px')
    expect(r.html).toContain('height:200px')
  })

  it('invents no size when the author declared none', () => {
    const r = sanitizeEmailHtml('<img src="https://cdn.test/hero.png">')
    expect(r.html).not.toContain('width:')
    expect(r.html).not.toContain('height:')
  })

  it('drops junk dimensions and never copies them into CSS', () => {
    const r = sanitizeEmailHtml('<img src="https://cdn.test/a.png" width="100%" height="expression(alert(1))">')
    expect(r.html).not.toContain('expression')
    // A percentage is a legitimate dimension, so it stays as an attribute…
    expect(r.html).toContain('width="100%"')
    // …but only plain pixel values are promoted into the pinned style.
    expect(r.html).not.toContain('width:100%')
  })

  it('pins unresolved cid: placeholders the same way', () => {
    const r = sanitizeEmailHtml('<img src="cid:missing@x" width="300" height="80">')
    expect(r.unresolvedCidCount).toBe(1)
    expect(r.html).toContain('width:300px')
    expect(r.html).toContain('height:80px')
  })

  it('loads remote images when allowed', () => {
    const r = sanitizeEmailHtml('<img src="https://cdn.test/hero.png">', { allowRemoteImages: true })
    expect(r.remoteImageCount).toBe(1)
    expect(r.blockedImageCount).toBe(0)
    expect(r.html).toContain('https://cdn.test/hero.png')
  })

  // Changed by the privacy shield: "load images" loads pictures, never the open beacon.
  it('removes tracking pixels whether or not images are allowed', () => {
    const px = '<p>hi</p><img src="https://track.test/o.gif" width="1" height="1">'
    const blocked = sanitizeEmailHtml(px)
    expect(blocked.blockedTrackerCount).toBe(1)
    expect(blocked.html).not.toContain('<img')

    const allowed = sanitizeEmailHtml(px, { allowRemoteImages: true })
    expect(allowed.blockedTrackerCount).toBe(1)
    expect(allowed.html).not.toContain('<img')
  })

  it('detects pixel-sized images declared in CSS', () => {
    const r = sanitizeEmailHtml('<p>x</p><img src="https://track.test/o.gif" style="width:1px;height:1px">')
    expect(r.blockedTrackerCount).toBe(1)
  })

  it('always removes srcset — it is a second image channel', () => {
    const r = sanitizeEmailHtml('<img src="https://cdn.test/a.png" srcset="https://cdn.test/a@2x.png 2x">', { allowRemoteImages: true })
    expect(r.html).not.toContain('srcset')
    expect(r.html).not.toContain('a@2x')
  })

  it('blocks the table background attribute', () => {
    const r = sanitizeEmailHtml('<table background="https://track.test/bg.png"><tr><td>x</td></tr></table>')
    expect(r.html).not.toContain('track.test')
    expect(r.blockedImageCount).toBe(1)
  })

  it('keeps inline data: images but rejects data:image/svg+xml', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo='
    expect(sanitizeEmailHtml(`<img src="${png}">`).html).toContain(png)
    const svg = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='
    expect(sanitizeEmailHtml(`<img src="${svg}">`).html).not.toContain('svg+xml')
  })

  it('resolves cid: images from the map and flags the rest', () => {
    const map = { 'logo@acme': 'data:image/png;base64,AAA=' }
    const ok = sanitizeEmailHtml('<img src="cid:logo@acme">', { cidMap: map })
    expect(ok.html).toContain('data:image/png;base64,AAA=')
    expect(ok.unresolvedCidCount).toBe(0)

    const missing = sanitizeEmailHtml('<img src="cid:other@acme">')
    expect(missing.unresolvedCidCount).toBe(1)
    expect(missing.html).toContain('data-mr-cid="other@acme"')
  })
})

describe('sanitizeEmailHtml — quoted text', () => {
  it('marks a trailing blockquote', () => {
    const r = sanitizeEmailHtml('<div><p>Sounds good.</p><blockquote>Original question?</blockquote></div>')
    expect(r.hasQuotedText).toBe(true)
    expect(r.html).toContain('data-mr-quote="1"')
    expect(r.html).toContain('Sounds good.')
  })

  it('marks an "On … wrote:" attribution line and everything after it', () => {
    const r = sanitizeEmailHtml(
      '<div><p>Yes.</p><div>On Mon, 3 Feb 2025 at 10:02, Ada &lt;ada@x.test&gt; wrote:</div><div>Can you?</div></div>'
    )
    expect(r.hasQuotedText).toBe(true)
    expect((r.html.match(/data-mr-quote/g) ?? []).length).toBe(2)
  })

  it('marks a gmail_quote container', () => {
    const r = sanitizeEmailHtml('<div><p>ok</p><div class="gmail_quote">old</div></div>')
    expect(r.hasQuotedText).toBe(true)
  })

  it('does not collapse a message that is entirely a quote', () => {
    const r = sanitizeEmailHtml('<blockquote>the whole message</blockquote>')
    expect(r.hasQuotedText).toBe(false)
    expect(r.html).not.toContain('data-mr-quote')
  })

  it('can be turned off', () => {
    const r = sanitizeEmailHtml('<div><p>a</p><blockquote>b</blockquote></div>', { detectQuotedText: false })
    expect(r.hasQuotedText).toBe(false)
  })
})

describe('sanitizeEmailHtml — structure', () => {
  it('keeps table layout, alignment and cell attributes', () => {
    const out = clean('<table width="560" cellpadding="0" bgcolor="#fff"><tr><td align="center" colspan="2">x</td></tr></table>')
    expect(out).toContain('width="560"')
    expect(out).toContain('align="center"')
    expect(out).toContain('colspan="2"')
  })

  it('reports empty bodies', () => {
    expect(sanitizeEmailHtml('').isEmpty).toBe(true)
    expect(sanitizeEmailHtml('   ').isEmpty).toBe(true)
    expect(sanitizeEmailHtml('<script>alert(1)</script>').isEmpty).toBe(true)
    expect(sanitizeEmailHtml('<p>x</p>').isEmpty).toBe(false)
  })

  it('is deterministic across calls (hook state does not leak)', () => {
    const html = '<img src="https://cdn.test/a.png"><a href="https://e.test">l</a>'
    const a = sanitizeEmailHtml(html)
    const b = sanitizeEmailHtml(html, { allowRemoteImages: true })
    const c = sanitizeEmailHtml(html)
    expect(c).toEqual(a)
    expect(b.blockedImageCount).toBe(0)
  })
})

describe('url helpers', () => {
  it('normalizeUrl strips control characters', () => {
    expect(normalizeUrl(' java\tscript:x ')).toBe('javascript:x')
  })
  it('isSafeLink', () => {
    expect(isSafeLink('https://a.test')).toBe(true)
    expect(isSafeLink('//a.test/x')).toBe(true)
    expect(isSafeLink('#anchor')).toBe(true)
    expect(isSafeLink('javascript:alert(1)')).toBe(false)
    expect(isSafeLink('data:text/html,x')).toBe(false)
    expect(isSafeLink('file:///etc/passwd')).toBe(false)
    expect(isSafeLink('')).toBe(false)
  })
  it('isRemoteImageSrc / isSafeDataImage / cidOf', () => {
    expect(isRemoteImageSrc('http://a.test/x.png')).toBe(true)
    expect(isRemoteImageSrc('cid:x')).toBe(false)
    expect(isSafeDataImage('data:image/png;base64,AA')).toBe(true)
    expect(isSafeDataImage('data:image/svg+xml;base64,AA')).toBe(false)
    expect(cidOf('cid:%3Cabc%3E')).toBe('abc')
    expect(cidOf('https://a.test')).toBe(null)
  })
  it('splitDeclarations does not split inside url(data:…;base64,…)', () => {
    const d = splitDeclarations('background:url(data:image/png;base64,AA==);color:red')
    expect(d).toHaveLength(2)
    expect(d[1]).toBe('color:red')
  })
  it('cssUrls finds quoted and unquoted urls', () => {
    expect(cssUrls("a{background:url('https://a.test/x.png')}")).toEqual(['https://a.test/x.png'])
  })
  it('scrubInlineStyle / scrubStyleSheet return null-ish for empty results', () => {
    expect(scrubInlineStyle('width:expression(alert(1))', true).style).toBe('')
    expect(scrubStyleSheet('@import url(https://a.test/x.css);', true)).toBe(null)
  })
  it('formatBytes', () => {
    expect(formatBytes(0)).toBe('0 KB')
    expect(formatBytes(900)).toBe('900 B')
    expect(formatBytes(184_320)).toBe('180 KB')
    expect(formatBytes(2_402_112)).toBe('2.3 MB')
  })
})

describe('plain text fallback', () => {
  it('escapes HTML', () => {
    expect(escapeHtml('<b>&"')).toBe('&lt;b&gt;&amp;&quot;')
    expect(linkifyLine('<script>alert(1)</script>')).not.toContain('<script>')
  })
  it('linkifies urls and emails', () => {
    expect(linkifyLine('see https://a.test/x now')).toContain('href="https://a.test/x"')
    expect(linkifyLine('mail me at a@b.test')).toContain('href="mailto:a@b.test"')
    expect(linkifyLine('www.a.test')).toContain('href="https://www.a.test"')
  })
  it('does not linkify inside an escaped tag', () => {
    const out = linkifyLine('<a href="https://evil.test">x</a>')
    expect(out).not.toContain('<a href="https://evil.test">')
    expect(out).toContain('&lt;a href=')
  })
  it('marks quoted lines', () => {
    const r = plainTextToHtml('Yes.\n\n> original\n> more')
    expect(r.hasQuotedText).toBe(true)
    expect((r.html.match(/data-mr-quote/g) ?? []).length).toBe(2)
  })
  it('does not mark when the whole body is quoted', () => {
    expect(plainTextToHtml('> only quote').hasQuotedText).toBe(false)
  })
})
