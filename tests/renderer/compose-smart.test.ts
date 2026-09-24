import { describe, expect, it } from 'vitest'
import {
  domainOf, editDistance, findAttachmentMention, findDomainTypos, looksLikeMailingList, ownText,
  replyAllNote, sendNudges, suggestDomain
} from '@/features/compose/safety'
import { avatarHue, frecency, matchTier, rankContacts } from '@/features/compose/frecency'
import {
  CURSOR_MARK, containsCursor, expandDoc, expandText, firstNameOf, lastNameOf
} from '@/features/compose/snippetVars'
import { findByShortcut, type Snippet } from '@/features/compose/snippets'
import { smartQuote } from '@/features/compose/smartTypography'
import { detectSnippetTrigger } from '@/features/compose/trigger'
import { pickReplyAccount, signatureFor } from '@/features/compose/identity'
import { cleanPastedHtml } from '@shared/emailhtml'
import type { Contact } from '@shared/types'

describe('attachment mention detector', () => {
  it.each([
    'Please see the attached report.',
    'I have attached the invoice',
    'Find the attachment below',
    'Enclosed is my CV',
    'Vous trouverez ci-joint le devis',
    'Voir la pièce jointe',
    'Je vous joins le contrat',
    "J'ai mis le PDF en pièce jointe",
    'ci-jointe la facture',
    'Cf. PJ'
  ])('flags: %s', (text) => {
    expect(findAttachmentMention(text)).not.toBeNull()
  })

  it.each([
    'Hello, how are you?',
    'I detached the trailer',
    'A joint venture between us',
    'Let us join forces',
    'No attachment needed, just reply',
    'Sans pièce jointe cette fois'
  ])('ignores: %s', (text) => {
    expect(findAttachmentMention(text)).toBeNull()
  })

  it('ignores quoted history and the signature', () => {
    expect(findAttachmentMention('Thanks!\n\n> please see the attached file\n> more')).toBeNull()
    expect(findAttachmentMention('Thanks!\n\nOn Tue, 3 Mar 2026, Ada wrote:\nSee attached')).toBeNull()
    expect(findAttachmentMention('Le 3 mars 2026, Ada a écrit :\nCi-joint le plan')).toBeNull()
    expect(findAttachmentMention('Best,\nJo\n-- \nSent with attachment support')).toBeNull()
    expect(findAttachmentMention('See attached.\n> quoted')).not.toBeNull()
  })

  it('ownText keeps only what the author wrote', () => {
    expect(ownText('Hi\n> old\nBye\n--\nsig')).toBe('Hi\nBye')
  })
})

describe('recipient domain sanity', () => {
  const known = new Map([['acme-corp.com', 12], ['gmail.com', 40]])

  it('measures edit distance with transpositions', () => {
    expect(editDistance('gmail.com', 'gmial.com')).toBe(1)
    expect(editDistance('gmail.com', 'gmal.com')).toBe(1)
    expect(editDistance('gmail.com', 'gmail.com')).toBe(0)
    expect(editDistance('abc', 'xyz')).toBe(3)
  })

  it('suggests the domain you meant', () => {
    expect(suggestDomain('gmial.com', known)).toBe('gmail.com')
    expect(suggestDomain('acme-corp.co', new Map([['acme-corp.com', 5]]))).toBeNull() // .co is a real TLD
    expect(suggestDomain('acme-corpp.com', known)).toBe('acme-corp.com')
    expect(suggestDomain('gmail.con', known)).toBe('gmail.com')
    expect(suggestDomain('hotmial.com', new Map())).toBe('hotmail.com')
  })

  it('never flags a real domain, or one you already write to', () => {
    expect(suggestDomain('gmail.com', known)).toBeNull()
    expect(suggestDomain('mail.com', new Map())).toBeNull() // one letter from gmail.com, but real
    expect(suggestDomain('acme-corpp.com', new Map([['acme-corp.com', 1], ['acme-corpp.com', 3]]))).toBeNull()
    expect(suggestDomain('example.org', known)).toBeNull()
  })

  it('finds typos among recipients and offers the fixed address', () => {
    const t = findDomainTypos([{ name: 'Ada', email: 'ada@gmial.com' }, { email: 'ok@gmail.com' }], known)
    expect(t).toHaveLength(1)
    expect(t[0].fixed).toEqual({ name: 'Ada', email: 'ada@gmail.com' })
    expect(t[0].typedDomain).toBe('gmial.com')
    expect(domainOf('a@B.com')).toBe('b.com')
  })
})

describe('reply-all guard', () => {
  const people = (n: number) => Array.from({ length: n }, (_, i) => ({ email: `p${i}@x.test` }))
  const base = { mode: 'replyAll', cc: [], selfEmails: ['me@x.test'] }

  it('stays quiet up to five people', () => {
    expect(replyAllNote({ ...base, to: people(5) })).toBeNull()
  })
  it('speaks up past five, not counting yourself', () => {
    expect(replyAllNote({ ...base, to: [...people(5), { email: 'ME@x.test' }] })).toBeNull()
    expect(replyAllNote({ ...base, to: people(6) })).toEqual({ count: 6, list: false })
  })
  it('recognises mailing lists', () => {
    expect(replyAllNote({ ...base, to: [{ email: 'dev-list@lists.example.org' }, { email: 'a@x.test' }] })?.list).toBe(true)
    expect(replyAllNote({ ...base, to: people(2), originalIsList: true })?.list).toBe(true)
    expect(replyAllNote({ ...base, to: [{ email: 'solo@x.test' }], originalIsList: true })).toBeNull()
    expect(looksLikeMailingList('friend@gmail.com')).toBe(false)
    expect(looksLikeMailingList('announce@acme.com')).toBe(true)
    expect(looksLikeMailingList('x@googlegroups.com')).toBe(true)
  })
  it('only applies to reply-all', () => {
    expect(replyAllNote({ ...base, mode: 'reply', to: people(9) })).toBeNull()
    expect(replyAllNote({ ...base, mode: 'new', to: people(9) })).toBeNull()
  })
})

describe('send nudges', () => {
  const ok = { subject: 'Hi', bodyText: 'Hello there', attachmentCount: 0, hasInlineImage: false, typos: [] }
  it('is empty for a healthy message', () => {
    expect(sendNudges(ok)).toEqual([])
  })
  it('flags empty subject, missing attachment and empty body in order of importance', () => {
    expect(sendNudges({ ...ok, subject: ' ' }).map((n) => n.id)).toEqual(['subject'])
    expect(sendNudges({ ...ok, bodyText: 'See attached' }).map((n) => n.id)).toEqual(['attachment'])
    expect(sendNudges({ ...ok, bodyText: '' }).map((n) => n.id)).toEqual(['empty'])
    expect(sendNudges({ ...ok, bodyText: 'See attached', subject: '' }).map((n) => n.id)).toEqual(['attachment', 'subject'])
  })
  it('an attachment or inline image satisfies the promise', () => {
    expect(sendNudges({ ...ok, bodyText: 'See attached', attachmentCount: 1 })).toEqual([])
    expect(sendNudges({ ...ok, bodyText: 'See attached', hasInlineImage: true })).toEqual([])
  })
})

describe('recipient frecency', () => {
  const now = Date.UTC(2026, 5, 1)
  const day = 86_400_000
  const c = (email: string, useCount: number, ageDays: number, name?: string): Contact => ({
    email, name, useCount, lastUsedAt: now - ageDays * day
  })

  it('prefers frequent and recent', () => {
    expect(frecency(c('a@x', 50, 1), now)).toBeGreaterThan(frecency(c('b@x', 50, 400), now))
    expect(frecency(c('a@x', 50, 1), now)).toBeGreaterThan(frecency(c('b@x', 2, 1), now))
    expect(frecency(c('old@x', 3, 9999), now)).toBeGreaterThan(0)
  })
  it('lets a recent contact beat a merely frequent, long-dormant one', () => {
    const ranked = rankContacts([c('old@x.test', 30, 500), c('new@x.test', 12, 2)], '', { now })
    expect(ranked[0].email).toBe('new@x.test')
  })
  it('match tier outranks frecency', () => {
    const list = [c('zoe.ada@x.test', 99, 1), c('ada@y.test', 1, 300, 'Ada Lovelace')]
    expect(rankContacts(list, 'ada', { now })[0].email).toBe('ada@y.test')
    expect(matchTier(c('bob@x', 1, 1, 'Bob'), 'zzz')).toBe(0)
    expect(matchTier(c('x@x', 1, 1, 'Ada Lovelace'), 'love')).toBe(2)
    expect(matchTier(c('x@x', 1, 1, 'Ada Lovelace'), 'ace')).toBe(1)
  })
  it('excludes already-added addresses, case-insensitively, and honours the limit', () => {
    const list = [c('a@x', 5, 1), c('b@x', 4, 1), c('c@x', 3, 1)]
    expect(rankContacts(list, '', { now, exclude: ['A@x'], limit: 1 }).map((x) => x.email)).toEqual(['b@x'])
  })
  it('gives each address a stable hue', () => {
    expect(avatarHue('Ada@x.test')).toBe(avatarHue('ada@x.test'))
    expect(avatarHue('a@x')).toBeLessThan(360)
  })
})

describe('snippet variables', () => {
  const ctx = {
    recipient: { name: 'Ada Lovelace', email: 'ada@x.test' },
    me: { name: 'Grace Hopper', email: 'grace@y.test' },
    now: new Date(2026, 2, 3, 9, 5),
    locale: 'en-GB'
  }

  it('expands names and the date', () => {
    expect(expandText('Hi {{first_name}}, — {{my_name}}', ctx)).toBe('Hi Ada, — Grace Hopper')
    expect(expandText('On {{date}}', ctx)).toBe('On 3 March 2026')
    expect(expandText('{{ First Name }}/{{last_name}}/{{email}}', ctx)).toBe('Ada/Lovelace/ada@x.test')
  })
  it('leaves unknown variables and missing data alone, unless a fallback is given', () => {
    expect(expandText('Hi {{first_name}}', {})).toBe('Hi {{first_name}}')
    expect(expandText('Hi {{first_name|there}}', {})).toBe('Hi there')
    expect(expandText('Hi {{first_name|there}}', ctx)).toBe('Hi Ada')
    expect(expandText('{{nope}}', ctx)).toBe('{{nope}}')
  })
  it('derives a first name from awkward inputs', () => {
    expect(firstNameOf({ name: 'Lovelace, Ada', email: 'a@x' })).toBe('Ada')
    expect(firstNameOf({ email: 'ada.lovelace@x.test' })).toBe('Ada')
    expect(firstNameOf({ email: 'info@x.test' })).toBe('')
    expect(firstNameOf({ email: 'jsmith@x.test' })).toBe('')
    expect(firstNameOf({ name: 'ada@x.test', email: 'ada@x.test' })).toBe('')
    expect(lastNameOf({ name: 'Lovelace, Ada', email: 'a@x' })).toBe('Lovelace')
  })
  it('expands inside a document tree and reports the caret marker', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi {{first_name}},', marks: [{ type: 'bold' }] }, { type: 'text', text: '{{cursor}}' }] }]
    }
    const out = expandDoc(doc, ctx)
    expect(out.content?.[0].content?.[0]).toEqual({ type: 'text', text: 'Hi Ada,', marks: [{ type: 'bold' }] })
    expect(containsCursor(out)).toBe(true)
    expect(out.content?.[0].content?.[1].text).toBe(CURSOR_MARK)
    expect(doc.content[0].content[0].text).toBe('Hi {{first_name}},') // input untouched
  })
  it('drops text nodes that expand to nothing', () => {
    const doc = { type: 'paragraph', content: [{ type: 'text', text: '{{first_name|}}' }] }
    expect(expandDoc(doc, {}).content).toEqual([])
  })
})

describe(';shortcut snippets', () => {
  const snip = (id: string, shortcut?: string): Snippet => ({
    id, name: id, shortcut, doc: { type: 'doc' }, createdAt: 0, updatedAt: 0
  })
  it('detects a `;word` at a word boundary', () => {
    expect(detectSnippetTrigger('hello ;sig')).toEqual({ query: 'sig', from: 4 })
    expect(detectSnippetTrigger(';thanks')?.query).toBe('thanks')
    expect(detectSnippetTrigger('well;ok')).toBeNull()
    expect(detectSnippetTrigger('hello ;')).toBeNull()
    expect(detectSnippetTrigger('a ;) b')).toBeNull()
  })
  it('matches by shortcut prefix, exact first', () => {
    const list = [snip('a', 'signoff'), snip('b', 'sig'), snip('c'), snip('d', 'thanks')]
    expect(findByShortcut(list, 'sig').map((s) => s.id)).toEqual(['b', 'a'])
    expect(findByShortcut(list, 'zzz')).toEqual([])
    expect(findByShortcut(list, '')).toEqual([])
  })
})

describe('smart quotes', () => {
  it('curls by context', () => {
    expect(smartQuote('"', ' ', false)).toBe('\u201c')
    expect(smartQuote('"', 'o', false)).toBe('\u201d')
    expect(smartQuote('"', '(', false)).toBe('\u201c')
    expect(smartQuote("'", 'n', false)).toBe('\u2019')
    expect(smartQuote("'", ' ', false)).toBe('\u2018')
    expect(smartQuote("'", '', true)).toBe('\u2018')
  })
  it('leaves a block-start double quote for the blockquote shortcut', () => {
    expect(smartQuote('"', '', true)).toBeNull()
  })
})

describe('reply identity', () => {
  const accounts = [{ id: 'a' }, { id: 'b' }]
  it('replies from the mailbox the message lives in', () => {
    expect(pickReplyAccount({ accountId: 'b' }, accounts, 'a')).toBe('b')
    expect(pickReplyAccount({ accountId: 'gone' }, accounts, 'a')).toBe('a')
    expect(pickReplyAccount(undefined, accounts, 'a')).toBe('a')
  })
  it('signature follows the account', () => {
    expect(signatureFor({ a: ' <p>A</p> ', b: '' }, 'a')).toBe('<p>A</p>')
    expect(signatureFor({ a: 'x' }, 'b')).toBe('')
    expect(signatureFor(undefined, 'a')).toBe('')
  })
})

describe('clipboard HTML cleaning', () => {
  it('unwraps the Google Docs "normal weight" bold wrapper', () => {
    const html = '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><p dir="ltr" style="line-height:1.38"><span style="font-size:11pt;font-family:Arial;color:#000000;font-weight:400">Hello</span></p></b>'
    expect(cleanPastedHtml(html)).toBe('<p>Hello</p>')
  })
  it('keeps bold and italic but drops colours, fonts and backgrounds', () => {
    const html = '<p><span style="color:#fff;background-color:#111;font-weight:700;font-family:X">Hi</span> <i style="color:red">there</i></p>'
    expect(cleanPastedHtml(html)).toBe('<p><span style="font-weight:700">Hi</span> <i>there</i></p>')
  })
  it('drops junk elements and Word noise', () => {
    const html = '<html><head><style>p{color:red}</style></head><body><!--StartFragment--><p class="MsoNormal">A<o:p></o:p></p><p class="MsoNormal">&nbsp;</p><p class="MsoNormal">B</p><script>x()</script></body></html>'
    expect(cleanPastedHtml(html)).toBe('<p>A</p><p>B</p>')
  })
  it('turns Word fake lists into real lists', () => {
    const html = [
      '<p class="MsoListParagraph" style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">·<span>&nbsp;&nbsp;</span></span>One</p>',
      '<p class="MsoListParagraph" style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">·<span>&nbsp;&nbsp;</span></span>Two</p>',
      '<p class="MsoNormal">After</p>'
    ].join('')
    expect(cleanPastedHtml(html)).toBe('<ul><li>One</li><li>Two</li></ul><p>After</p>')
    const num = '<p style="mso-list:l1 level1 lfo2"><span style="mso-list:Ignore">1.<span>&nbsp;</span></span>First</p>'
    expect(cleanPastedHtml(`<span class="MsoNormal"></span>${num}`)).toContain('<ol><li>First</li></ol>')
  })
  it('keeps structure: links, images (http/data only), tables, headings', () => {
    const html = '<h2 class="x">T</h2><p><a href="https://a.test/x" target="_blank" style="color:blue">l</a> <a href="javascript:alert(1)">bad</a></p>' +
      '<img src="file:///C:/x.png"><img src="https://a.test/i.png" alt="i" width="10"><table><tr><td colspan="2" style="border:1px">c</td></tr></table>'
    const out = cleanPastedHtml(html)
    expect(out).toContain('<h2>T</h2>')
    expect(out).toContain('<a href="https://a.test/x">l</a>')
    expect(out).not.toContain('javascript')
    expect(out).not.toContain('file:')
    expect(out).toContain('<img src="https://a.test/i.png" alt="i">')
    expect(out).toContain('<td colspan="2">c</td>')
  })
  it('removes the Apple Mail interchange newline and never throws', () => {
    expect(cleanPastedHtml('a<br class="Apple-interchange-newline">')).toBe('a')
    expect(cleanPastedHtml('')).toBe('')
    expect(() => cleanPastedHtml('<<<>>>&&<p')).not.toThrow()
  })
})
