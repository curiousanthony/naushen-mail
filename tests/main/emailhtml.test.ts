import { describe, expect, it } from 'vitest'
import { serializeToEmailHtml } from '@shared/emailhtml/serialize'
import { htmlToDoc } from '@shared/emailhtml/htmlToDoc'
import { safeColor, safeUrl } from '@shared/emailhtml/escape'
import { parseHtml, decodeEntities } from '@shared/emailhtml/htmlparse'
import {
  forwardSubject, formatQuoteDate, quoteAttribution, replyRecipients, replySubject
} from '@shared/emailhtml/reply'
import type { DocNode } from '@shared/emailhtml/types'

const doc = (...content: DocNode[]): DocNode => ({ type: 'doc', content })
const p = (text: string, marks?: DocNode['marks']): DocNode => ({
  type: 'paragraph', content: [{ type: 'text', text, ...(marks ? { marks } : {}) }]
})
const ser = (d: DocNode, opts = {}): ReturnType<typeof serializeToEmailHtml> =>
  serializeToEmailHtml(d, { cidPrefix: 'cid0', ...opts })

// A document exercising every block in docs/05-email-html-contract.md.
const RICH: DocNode = doc(
  { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Weekly update' }] },
  { type: 'paragraph', content: [
    { type: 'text', text: 'Hello ' },
    { type: 'text', text: 'Ada', marks: [{ type: 'bold' }] },
    { type: 'text', text: ', see the ' },
    { type: 'text', text: 'notes', marks: [{ type: 'link', attrs: { href: 'https://example.com/n?a=1&b=2' } }] },
    { type: 'text', text: '.' }
  ] },
  { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Shipped' }] },
  { type: 'bulletList', content: [
    { type: 'listItem', content: [p('Composer')] },
    { type: 'listItem', content: [p('Serializer')] }
  ] },
  { type: 'orderedList', attrs: { start: 1 }, content: [
    { type: 'listItem', content: [p('First')] },
    { type: 'listItem', content: [p('Second')] }
  ] },
  { type: 'taskList', content: [
    { type: 'taskItem', attrs: { checked: true }, content: [p('Write tests')] },
    { type: 'taskItem', attrs: { checked: false }, content: [p('Ship it')] }
  ] },
  { type: 'details', content: [
    { type: 'detailsSummary', content: [{ type: 'text', text: 'Details' }] },
    { type: 'detailsContent', content: [p('Hidden in Notion, flattened in email.')] }
  ] },
  { type: 'blockquote', content: [p('A quote.')] },
  { type: 'horizontalRule' },
  { type: 'callout', attrs: { emoji: '💡', background: '#f7f6f3' }, content: [p('Remember the milk.')] },
  { type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: 'const a = 1 < 2\nconsole.log(a)' }] },
  { type: 'table', content: [
    { type: 'tableRow', content: [
      { type: 'tableHeader', content: [p('Name')] },
      { type: 'tableHeader', content: [p('Role')] }
    ] },
    { type: 'tableRow', content: [
      { type: 'tableCell', content: [p('Ada')] },
      { type: 'tableCell', content: [p('Engineer')] }
    ] }
  ] },
  { type: 'paragraph', content: [
    { type: 'text', text: 'coloured', marks: [{ type: 'textStyle', attrs: { color: '#c4554d' } }] },
    { type: 'text', text: ' ' },
    { type: 'text', text: 'highlighted', marks: [{ type: 'highlight', attrs: { color: '#fdecc8' } }] },
    { type: 'text', text: ' ' },
    { type: 'text', text: 'code()', marks: [{ type: 'code' }] },
    { type: 'emoji', attrs: { name: 'rocket', emoji: '🚀' } }
  ] },
  { type: 'image', attrs: { src: 'data:image/png;base64,iVBORw0KGgo=', alt: 'A tiny png', title: 'tiny.png' } }
)

describe('serializeToEmailHtml', () => {
  it('serialises a rich document (snapshot)', () => {
    expect(ser(RICH).html).toMatchSnapshot()
  })

  it('produces a readable plain-text alternative (snapshot)', () => {
    expect(ser(RICH).text).toMatchSnapshot()
  })

  it('wraps the body in a max-width container with a system font stack', () => {
    const { html } = ser(doc(p('hi')))
    expect(html).toMatch(/^<div style="font-family:-apple-system/)
    expect(html).toContain('max-width:640px')
    expect(ser(doc(p('hi')), { maxWidth: 520 }).html).toContain('max-width:520px')
  })

  it('renders an empty document as a non-collapsing paragraph', () => {
    expect(ser(doc()).html).toContain('&nbsp;')
    expect(ser(doc()).text).toBe('')
  })

  it('never emits raw markup from user text', () => {
    const { html, text } = ser(doc(p('<script>alert(1)</script> & "quotes" \'n\' <b>no</b>')))
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('&amp;')
    expect(text).toContain('<script>alert(1)</script>')
  })

  it('drops links with a non-whitelisted scheme but keeps their text', () => {
    for (const href of ['javascript:alert(1)', 'data:text/html,<script>', 'file:///etc/passwd', 'vbscript:x', 'jav\tascript:alert(1)', '/relative']) {
      const { html } = ser(doc(p('click', [{ type: 'link', attrs: { href } }])))
      expect(html, href).not.toContain('<a ')
      expect(html, href).toContain('click')
    }
  })

  it('keeps whitelisted schemes', () => {
    for (const href of ['https://a.test/x?y=1', 'http://a.test', 'mailto:ada@a.test', 'tel:+441234']) {
      expect(ser(doc(p('x', [{ type: 'link', attrs: { href } }]))).html, href).toContain(`href="${href.replace(/&/g, '&amp;')}"`)
    }
  })

  it('escapes ampersands and quotes inside href', () => {
    const { html } = ser(doc(p('x', [{ type: 'link', attrs: { href: 'https://a.test/?a=1&b=2' } }])))
    expect(html).toContain('href="https://a.test/?a=1&amp;b=2"')
    // A quote in the URL would break out of the attribute, so the URL is refused entirely.
    expect(ser(doc(p('x', [{ type: 'link', attrs: { href: 'https://a.test/"onmouseover=x' } }]))).html).not.toContain('<a ')
  })

  it('rejects CSS injection through colours', () => {
    const bad = ser(doc(p('x', [{ type: 'textStyle', attrs: { color: 'red;background:url(javascript:1)' } }]))).html
    expect(bad).not.toContain('url(')
    expect(bad).not.toContain('<span')
    expect(ser(doc(p('x', [{ type: 'textStyle', attrs: { color: '#ff0000' } }]))).html).toContain('color:#ff0000')
  })

  it('turns data: images into cid attachments and leaves remote ones alone', () => {
    const { html, inlineImages } = ser(doc(
      { type: 'image', attrs: { src: 'data:image/jpeg;base64,/9j/4AAQ', alt: 'photo' } },
      { type: 'image', attrs: { src: 'https://a.test/x.png', alt: 'remote' } }
    ))
    expect(inlineImages).toEqual([
      { cid: 'cid0-1@mailroom.local', filename: 'image-1.jpg', mimeType: 'image/jpeg', dataBase64: '/9j/4AAQ' }
    ])
    expect(html).toContain('src="cid:cid0-1@mailroom.local"')
    expect(html).toContain('src="https://a.test/x.png"')
  })

  it('refuses a non-image data: URI', () => {
    const { html, inlineImages } = ser(doc({ type: 'image', attrs: { src: 'data:text/html;base64,PHNjcmlwdD4=', alt: 'x' } }))
    expect(inlineImages).toEqual([])
    expect(html).not.toContain('data:')
  })

  it('renders to-dos with ballot characters and strikes completed ones', () => {
    const { html, text } = ser(doc({ type: 'taskList', content: [
      { type: 'taskItem', attrs: { checked: true }, content: [p('done')] },
      { type: 'taskItem', attrs: { checked: false }, content: [p('todo')] }
    ] }))
    expect(html).toContain('&#9745;')
    expect(html).toContain('&#9744;')
    expect(html).toContain('line-through')
    expect(text).toContain('[x] done')
    expect(text).toContain('[ ] todo')
  })

  it('renders a callout as a table with a bgcolor attribute', () => {
    const { html } = ser(doc({ type: 'callout', attrs: { emoji: '🔥' }, content: [p('hot')] }))
    expect(html).toContain('<table cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#f7f6f3"')
    expect(html).toContain('🔥')
    // The last block inside the callout must not add a trailing margin.
    expect(html).toContain('<p style="margin:0">hot</p>')
  })

  it('flattens toggles to a bold summary plus indented children', () => {
    const { html, text } = ser(doc({ type: 'details', content: [
      { type: 'detailsSummary', content: [{ type: 'text', text: 'More' }] },
      { type: 'detailsContent', content: [p('inside')] }
    ] }))
    expect(html).toContain('font-weight:600')
    expect(html).toContain('padding-left:18px')
    expect(text).toContain('More')
    expect(text).toContain('  inside')
  })

  it('nests marks deterministically with link outermost and code innermost', () => {
    const { html } = ser(doc(p('x', [
      { type: 'code' }, { type: 'bold' }, { type: 'link', attrs: { href: 'https://a.test' } }
    ])))
    expect(html).toContain('<a href="https://a.test" target="_blank" rel="noopener noreferrer"')
    expect(html.indexOf('<a ')).toBeLessThan(html.indexOf('<strong>'))
    expect(html.indexOf('<strong>')).toBeLessThan(html.indexOf('<code'))
  })

  it('appends the signature and the quoted original in order', () => {
    const { html, text } = ser(doc(p('Sure.')), {
      signatureHtml: '<p>— Ada</p>',
      quoted: { attribution: 'On 1 Jan 2026 at 09:00, Bob wrote:', html: '<p>Original</p>' }
    })
    expect(html.indexOf('Sure.')).toBeLessThan(html.indexOf('— Ada'))
    expect(html.indexOf('— Ada')).toBeLessThan(html.indexOf('Original'))
    expect(html).toContain('<blockquote type="cite"')
    expect(text).toBe('Sure.\n\n— Ada\n\nOn 1 Jan 2026 at 09:00, Bob wrote:\n> Original')
  })

  it('does not duplicate the URL in text when the anchor text is the URL', () => {
    expect(ser(doc(p('https://a.test', [{ type: 'link', attrs: { href: 'https://a.test' } }]))).text).toBe('https://a.test')
    expect(ser(doc(p('here', [{ type: 'link', attrs: { href: 'https://a.test' } }]))).text).toBe('here <https://a.test>')
  })

  it('renders children of an unknown block instead of dropping them', () => {
    expect(ser(doc({ type: 'futureBlock', content: [p('kept')] })).html).toContain('kept')
  })

  it('generates unique cids per image', () => {
    const { inlineImages } = ser(doc(
      { type: 'image', attrs: { src: 'data:image/png;base64,AAAA' } },
      { type: 'image', attrs: { src: 'data:image/png;base64,BBBB' } }
    ))
    expect(new Set(inlineImages.map((i) => i.cid)).size).toBe(2)
  })
})

describe('safeUrl / safeColor', () => {
  it('normalises and whitelists schemes', () => {
    expect(safeUrl('  https://a.test/x  ')).toBe('https://a.test/x')
    expect(safeUrl('HTTPS://A.test')).toBe('HTTPS://A.test')
    expect(safeUrl('javascript:alert(1)')).toBeNull()
    expect(safeUrl('java script:alert(1)')).toBeNull()
    expect(safeUrl('')).toBeNull()
    expect(safeUrl(42)).toBeNull()
  })

  it('whitelists colour syntax', () => {
    expect(safeColor('#ABC')).toBe('#abc')
    expect(safeColor('rgb(1, 2, 3)')).toBe('rgb(1, 2, 3)')
    expect(safeColor('rgba(1,2,3,0.5)')).toBe('rgba(1,2,3,0.5)')
    expect(safeColor('red')).toBe('red')
    expect(safeColor('expression(alert(1))')).toBeNull()
    expect(safeColor('#fff;position:fixed')).toBeNull()
  })
})

describe('parseHtml', () => {
  it('handles implicit closes, void elements and comments', () => {
    const root = parseHtml('<ul><li>a<li>b</ul><!--x--><br><p>c')
    expect(root.children.length).toBe(3)
    const ul = root.children[0]
    expect(ul.kind === 'el' && ul.children.length).toBe(2)
  })

  it('drops script and style content', () => {
    const root = parseHtml('<p>a</p><script>alert(1)</script><style>p{}</style><p>b</p>')
    const text = JSON.stringify(root)
    expect(text).not.toContain('alert(1)')
    expect(text).not.toContain('p{}')
  })

  it('decodes entities', () => {
    expect(decodeEntities('a &amp; b &#65; &#x42; &nbsp;&unknownentity;')).toBe('a & b A B  &unknownentity;')
  })
})

describe('htmlToDoc', () => {
  it('round-trips our own output for a rich document', () => {
    const first = ser(RICH)
    const second = ser(htmlToDoc(first.html))
    // Images become cid: references on the way back, so compare the text alternative and
    // the structural markers rather than the byte-identical HTML.
    expect(second.text).toBe(first.text)
    expect(second.html).toContain('<h1')
    expect(second.html).toContain('<ul')
    expect(second.html).toContain('<ol')
    expect(second.html).toContain('&#9745;')
    expect(second.html).toContain('<blockquote')
    expect(second.html).toContain('<hr')
    expect(second.html).toContain('<pre')
    expect(second.html).toContain('bgcolor=')
    expect(second.html).toContain('<th')
    expect(second.html).toContain('src="cid:cid0-1@mailroom.local"')
  })

  it('maps inline tags back to marks', () => {
    const d = htmlToDoc('<p><strong>b</strong><em>i</em><u>u</u><s>s</s><code>c</code>' +
      '<a href="https://a.test">l</a><span style="color:#ff0000">r</span></p>')
    const marks = (d.content?.[0].content ?? []).map((n) => (n.marks ?? []).map((m) => m.type).join('+'))
    expect(marks).toEqual(['bold', 'italic', 'underline', 'strike', 'code', 'link', 'textStyle'])
  })

  it('drops dangerous hrefs when parsing', () => {
    const d = htmlToDoc('<p><a href="javascript:alert(1)">x</a></p>')
    expect(JSON.stringify(d)).not.toContain('javascript')
  })

  it('recovers to-do lists from ballot characters', () => {
    const d = htmlToDoc('<p>☑&nbsp;done</p><p>☐ todo</p>')
    expect(d.content?.[0].type).toBe('taskList')
    expect(d.content?.[0].content?.length).toBe(2)
    expect(d.content?.[0].content?.[0].attrs?.checked).toBe(true)
    expect(d.content?.[0].content?.[1].attrs?.checked).toBe(false)
  })

  it('never returns an empty document', () => {
    expect(htmlToDoc('').content).toEqual([{ type: 'paragraph' }])
    expect(htmlToDoc('   ').content).toEqual([{ type: 'paragraph' }])
  })
})

describe('reply helpers', () => {
  it('does not stack Re:/Fwd: prefixes', () => {
    expect(replySubject('Hello')).toBe('Re: Hello')
    expect(replySubject('Re: Hello')).toBe('Re: Hello')
    expect(replySubject('RE[2]: Hello')).toBe('Re: Hello')
    expect(replySubject('')).toBe('Re: ')
    expect(forwardSubject('Fwd: Hello')).toBe('Fwd: Hello')
    expect(forwardSubject('FW: Hello')).toBe('Fwd: Hello')
  })

  it('formats the attribution line', () => {
    const ts = Date.UTC(2026, 2, 12, 9, 14)
    expect(formatQuoteDate(ts, 'UTC')).toBe('12 Mar 2026 at 09:14')
    expect(quoteAttribution({ name: 'Ada Lovelace', email: 'ada@a.test' }, ts, 'UTC'))
      .toBe('On 12 Mar 2026 at 09:14, Ada Lovelace wrote:')
    expect(quoteAttribution({ email: 'ada@a.test' }, ts, 'UTC')).toContain('ada@a.test wrote:')
  })

  it('computes reply and reply-all recipients', () => {
    const msg = {
      from: { name: 'Bob', email: 'bob@a.test' },
      to: [{ email: 'me@a.test' }, { email: 'carol@a.test' }],
      cc: [{ email: 'dave@a.test' }, { email: 'CAROL@a.test' }]
    }
    expect(replyRecipients(msg, 'reply', ['me@a.test'])).toEqual({ to: [msg.from], cc: [] })
    const all = replyRecipients(msg, 'replyAll', ['me@a.test'])
    expect(all.to).toEqual([msg.from])
    expect(all.cc.map((a) => a.email)).toEqual(['carol@a.test', 'dave@a.test'])
  })

  it('honours Reply-To', () => {
    const msg = { from: { email: 'bot@a.test' }, to: [], cc: [], replyTo: { email: 'human@a.test' } }
    expect(replyRecipients(msg, 'reply', []).to).toEqual([{ email: 'human@a.test' }])
  })

  it('replying to your own message keeps the original recipients', () => {
    const msg = { from: { email: 'me@a.test' }, to: [{ email: 'bob@a.test' }], cc: [] }
    expect(replyRecipients(msg, 'reply', ['me@a.test']).to).toEqual([{ email: 'bob@a.test' }])
  })
})
