// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { sanitizeEmailHtml } from '../../src/shared/sanitize'
import {
  classifyTrackerUrl, isClickRedirectHost, parseHttpUrl, summarizeTrackers
} from '../../src/shared/sanitize/trackers'
import { TRACKER_DOMAINS } from '../../src/shared/sanitize/trackerData'
import {
  cleanTrackingParams, describeLink, domainInText, phishingHint, registrableDomain
} from '../../src/shared/sanitize/links'

describe('tracker list', () => {
  it('ships roughly a hundred well-known domains, all lower-case and unique', () => {
    expect(TRACKER_DOMAINS.length).toBeGreaterThanOrEqual(90)
    const names = TRACKER_DOMAINS.map(([d]) => d)
    expect(new Set(names).size).toBe(names.length)
    for (const d of names) expect(d).toBe(d.toLowerCase())
  })
})

describe('classifyTrackerUrl', () => {
  const hits: [string, string][] = [
    ['https://mandrillapp.com/track/open.php?u=1&id=2', 'mandrillapp.com'],
    ['https://track.mandrillapp.com/x.gif', 'track.mandrillapp.com'],
    ['https://us1.list-manage.com/track/open.php?u=abc&id=def', 'us1.list-manage.com'],
    ['https://u123.ct.sendgrid.net/wf/open?upn=abcdef', 'u123.ct.sendgrid.net'],
    ['https://t.hubspotemail.net/e2t/o/1/abc', 't.hubspotemail.net'],
    ['https://api.mixpanel.com/track?img=1', 'api.mixpanel.com'],
    ['https://r20.rs6.net/on.jsp?t=1', 'r20.rs6.net'],
    ['https://cmail19.com/t/i-o-abc.gif', 'cmail19.com'],
    ['https://r.us-east-1.awstrack.me/I0/abc', 'r.us-east-1.awstrack.me'],
    ['https://www.facebook.com/tr?id=1&ev=PageView', 'www.facebook.com'],
    ['https://www.linkedin.com/emimp/ip_abc.gif', 'www.linkedin.com'],
    ['https://example.com/mail/open.gif?id=1', 'example.com'],
    ['https://example.com/pixel.gif', 'example.com'],
    ['//mandrillapp.com/x.gif', 'mandrillapp.com'],
    ['HTTPS://MANDRILLAPP.COM./x.gif', 'mandrillapp.com']
  ]
  it.each(hits)('flags %s', (url, host) => expect(classifyTrackerUrl(url)?.host).toBe(host))

  const clean = [
    'https://cdn.example.com/hero.png',
    'https://mcusercontent.com/abc/images/hero.png',
    'https://us1.list-manage.com/images/logo.png',
    'https://u123.sendgrid.net/assets/logo.png',
    'https://www.facebook.com/images/logo.png',
    'https://www.linkedin.com/company/logo.png',
    'https://image.s7.exacttarget.com/lib/abc/logo.png',
    'https://notmandrillapp.com/x.gif',
    'https://mandrillapp.com.evil.example/x.gif',
    'https://example.com/photos/open-house.jpg',
    'cid:logo',
    'data:image/png;base64,AAAA',
    ''
  ]
  it.each(clean)('leaves %s alone', (url) => expect(classifyTrackerUrl(url)).toBeNull())

  it('names the vendor', () => {
    expect(classifyTrackerUrl('https://mandrillapp.com/x')?.service).toBe('Mailchimp (Mandrill)')
    expect(classifyTrackerUrl('https://example.com/pixel.gif')?.service).toBeNull()
  })

  it('summarises by host', () => {
    const a = classifyTrackerUrl('https://mandrillapp.com/a')!
    const b = classifyTrackerUrl('https://mandrillapp.com/b')!
    const c = classifyTrackerUrl('https://example.com/pixel.gif')!
    expect(summarizeTrackers([a, c, b])).toEqual([
      { host: 'mandrillapp.com', service: 'Mailchimp (Mandrill)', count: 2 },
      { host: 'example.com', service: null, count: 1 }
    ])
  })

  it('parses hosts defensively', () => {
    expect(parseHttpUrl('https://user:pw@Example.com:8080/a?b#c')).toMatchObject({ host: 'example.com', path: '/a?b' })
    expect(parseHttpUrl('javascript:alert(1)')).toBeNull()
    expect(parseHttpUrl('https:// ')).toBeNull()
    expect(isClickRedirectHost('click.mandrillapp.com')).toBe(true)
    expect(isClickRedirectHost('example.com')).toBe(false)
  })
})

describe('sanitizer: tracker removal', () => {
  const html = '<p>hi</p><img src="https://mandrillapp.com/track/open.php?u=1" width="600" height="80">' +
    '<img src="https://cdn.example.com/hero.png" width="600" height="200">' +
    '<img src="https://other.example/o.gif" width="1" height="1">'

  it('drops trackers and blocks the rest while images are blocked', () => {
    const r = sanitizeEmailHtml(html)
    expect(r.blockedTrackerCount).toBe(2)
    expect(r.trackers.map((t) => t.host)).toEqual(['mandrillapp.com', 'other.example'])
    expect(r.blockedImageCount).toBe(1)
    expect(r.html).not.toContain('mandrillapp')
    expect(r.html).not.toContain('other.example')
  })

  it('"load images" loads the pictures but never the trackers', () => {
    const r = sanitizeEmailHtml(html, { allowRemoteImages: true })
    expect(r.blockedTrackerCount).toBe(2)
    expect(r.html).toContain('https://cdn.example.com/hero.png')
    expect(r.html).not.toContain('mandrillapp')
    expect(r.html).not.toContain('other.example')
  })

  it('treats hidden images as beacons but a lone 1px rule as an ordinary image', () => {
    const hidden = sanitizeEmailHtml('<img src="https://x.example/a.png" style="display:none">', { allowRemoteImages: true })
    expect(hidden.blockedTrackerCount).toBe(1)
    const rule = sanitizeEmailHtml('<img src="https://x.example/rule.png" width="600" height="1">', { allowRemoteImages: true })
    expect(rule.blockedTrackerCount).toBe(0)
    expect(rule.html).toContain('rule.png')
    const fullWidth = sanitizeEmailHtml('<img src="https://x.example/rule.png" style="width:100%;height:1px">', { allowRemoteImages: true })
    expect(fullWidth.blockedTrackerCount).toBe(0)
  })

  it('reports no trackers for clean mail', () => {
    const r = sanitizeEmailHtml('<p>hello</p>')
    expect(r.trackers).toEqual([])
    expect(r.blockedTrackerCount).toBe(0)
  })
})

describe('cleanTrackingParams', () => {
  it('strips utm_*, click ids and mailer ids, keeping the rest byte-for-byte', () => {
    const r = cleanTrackingParams('https://example.com/p?id=42&utm_source=nl&utm_medium=email&fbclid=abc&sig=a%2Fb#top')
    expect(r.url).toBe('https://example.com/p?id=42&sig=a%2Fb#top')
    expect(r.removed).toEqual(['utm_source', 'utm_medium', 'fbclid'])
  })
  it('drops the "?" when nothing is left', () => {
    expect(cleanTrackingParams('https://example.com/?gclid=1&mc_eid=2').url).toBe('https://example.com/')
  })
  it('handles HubSpot and Mailchimp ids', () => {
    expect(cleanTrackingParams('https://e.com/a?_hsenc=p2&_hsmi=9&mc_cid=1&x=1').url).toBe('https://e.com/a?x=1')
  })
  it('is case-insensitive on names and decodes them', () => {
    expect(cleanTrackingParams('https://e.com/a?UTM_Source=x&%75tm_medium=y&k=v').url).toBe('https://e.com/a?k=v')
  })
  it('does not touch anything else', () => {
    for (const u of [
      'https://example.com/a?id=1', 'https://example.com/a', 'mailto:a@b.co?subject=utm_x', 'tel:+33123456789',
      'https://example.com/a?utmx=1&mutm_source=2', 'not a url'
    ]) expect(cleanTrackingParams(u)).toEqual({ url: u, removed: [] })
  })
  it('leaves a fragment that merely contains a "?" alone', () => {
    expect(cleanTrackingParams('https://e.com/a#x?utm_source=1').url).toBe('https://e.com/a#x?utm_source=1')
  })
})

describe('describeLink', () => {
  it('splits host from the rest', () => {
    expect(describeLink('https://www.Example.com/a/b?x=1')).toEqual({ scheme: 'https', host: 'www.example.com', rest: '/a/b?x=1' })
    expect(describeLink('http://example.com/')).toEqual({ scheme: 'http', host: 'example.com', rest: '' })
    expect(describeLink('mailto:a%40b.co?subject=hi')).toEqual({ scheme: 'mailto', host: 'a@b.co', rest: '?subject=hi' })
    expect(describeLink('tel:+33123')).toMatchObject({ scheme: 'tel', host: '+33123' })
  })
  it('shows the true host, not what userinfo pretends', () => {
    expect(describeLink('https://paypal.com@evil.example/login').host).toBe('evil.example')
  })
})

describe('phishingHint', () => {
  it('flags text that names a different domain', () => {
    expect(phishingHint('paypal.com', 'https://evil.example/login')).toEqual({ shown: 'paypal.com', actual: 'evil.example' })
    expect(phishingHint('https://www.paypal.com/signin', 'https://paypal.com.evil.example/x')).toMatchObject({ shown: 'paypal.com', actual: 'paypal.com.evil.example' })
    expect(phishingHint('support@paypal.com', 'https://evil.example')).not.toBeNull()
  })
  it('flags an IP-address destination behind domain text', () => {
    expect(phishingHint('paypal.com', 'http://203.0.113.9/login')).not.toBeNull()
  })
  it('stays quiet when the registrable domains match', () => {
    expect(phishingHint('paypal.com', 'https://www.paypal.com/x')).toBeNull()
    expect(phishingHint('www.bbc.co.uk', 'https://news.bbc.co.uk/a')).toBeNull()
    expect(phishingHint('mail.google.com', 'https://accounts.google.com')).toBeNull()
  })
  it('stays quiet for prose, buttons and ordinary anchor text', () => {
    for (const t of ['Click here', 'Sign in to PayPal', 'Read more.', 'Visit paypal.com today', '', 'v1.2']) {
      expect(phishingHint(t, 'https://evil.example')).toBeNull()
    }
  })
  it('stays quiet for click-tracking wrappers', () => {
    expect(phishingHint('example.com', 'https://click.mandrillapp.com/track/click/1')).toBeNull()
    expect(phishingHint('example.com', 'https://abc.safelinks.protection.outlook.com/?url=x')).toBeNull()
  })
  it('ignores non-http destinations', () => {
    expect(phishingHint('paypal.com', 'mailto:a@b.co')).toBeNull()
  })
  it('extracts domains from address-like text only', () => {
    expect(domainInText('www.Example.com/path?q=1')).toBe('www.example.com')
    expect(domainInText('https://example.com')).toBe('example.com')
    expect(domainInText('two words.com')).toBeNull()
    expect(registrableDomain('a.b.example.co.uk')).toBe('example.co.uk')
    expect(registrableDomain('mail.example.com')).toBe('example.com')
  })
})
