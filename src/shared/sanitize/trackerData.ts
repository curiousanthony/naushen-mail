/**
 * Bundled list of well-known email-tracking infrastructure.
 *
 * Provenance: hand-compiled from publicly documented ESP / open-tracking endpoints (vendor docs,
 * the domains that show up in the headers of real newsletters, and the categories covered by
 * public pixel-blocker projects such as "Ugly Email" and Hey's tracker blocking). It is *not* a
 * copy of any of those lists. It is deliberately conservative: it names domains that exist to
 * count opens/clicks, and for hosts that also serve real content (SendGrid, Mailchimp's
 * `list-manage`, Facebook, LinkedIn, Salesforce…) it matches on the tracking PATH only, so
 * legitimate images from the same vendor keep loading.
 *
 * Matching is by domain suffix: an entry for `mandrillapp.com` also matches `track.mandrillapp.com`.
 * Every entry is `[domain, service name]`. Extend by appending.
 */

/** Whole domain is tracking infrastructure: any image from it is a tracker. */
export const TRACKER_DOMAINS: ReadonlyArray<readonly [string, string]> = [
  // ---- ESPs and marketing automation
  ['mandrillapp.com', 'Mailchimp (Mandrill)'],
  ['hubspotemail.net', 'HubSpot'],
  ['hubspotlinks.com', 'HubSpot'],
  ['hs-analytics.net', 'HubSpot'],
  ['hsadspixel.net', 'HubSpot'],
  ['exct.net', 'Salesforce Marketing Cloud'],
  ['pardot.com', 'Salesforce Pardot'],
  ['mktoresp.com', 'Marketo'],
  ['mktdns.com', 'Marketo'],
  ['rs6.net', 'Constant Contact'],
  ['klaviyomail.com', 'Klaviyo'],
  ['a.klaviyo.com', 'Klaviyo'],
  ['klclick.com', 'Klaviyo'],
  ['klclick1.com', 'Klaviyo'],
  ['klclick2.com', 'Klaviyo'],
  ['klclick3.com', 'Klaviyo'],
  ['sibautomation.com', 'Brevo (Sendinblue)'],
  ['pstmrk.it', 'Postmark'],
  ['awstrack.me', 'Amazon SES'],
  ['spgo.io', 'SparkPost'],
  ['sparkpostmail.com', 'SparkPost'],
  ['customeriomail.com', 'Customer.io'],
  ['appboy.com', 'Braze'],
  ['links.iterable.com', 'Iterable'],
  ['mjt.lu', 'Mailjet'],
  ['mailgun.org', 'Mailgun'],
  ['convertkit-mail.com', 'ConvertKit'],
  ['convertkit-mail2.com', 'ConvertKit'],
  ['dripemail2.com', 'Drip'],
  ['mlsend.com', 'MailerLite'],
  ['openrate.aweber.com', 'AWeber'],
  ['e2ma.net', 'Emma'],
  ['getvero.com', 'Vero'],
  ['intercom-mail.com', 'Intercom'],
  ['intercom-clicks.com', 'Intercom'],
  ['sendgrid.com', 'SendGrid'],
  ['ct.sendgrid.net', 'SendGrid'],
  ['emltrk.com', 'Litmus'],
  ['returnpath.net', 'Validity (Return Path)'],
  ['250ok.com', 'Validity (250ok)'],
  ['bananatag.com', 'Bananatag'],
  ['bmetrack.com', 'Bronto'],
  ['rsys2.net', 'Oracle Responsys'],
  ['rsys5.net', 'Oracle Responsys'],
  ['bluehornet.com', 'BlueHornet'],
  // ---- Sender-side "read receipt" tools
  ['mailtrack.io', 'Mailtrack'],
  ['yesware.com', 'Yesware'],
  ['mailfoogae.appspot.com', 'Streak'],
  ['mixmax.com', 'Mixmax'],
  ['getnotify.com', 'GetNotify'],
  ['readnotify.com', 'ReadNotify'],
  ['didtheyreadit.com', 'DidTheyReadIt'],
  ['getmailspring.com', 'Mailspring'],
  ['polymail.io', 'Polymail'],
  ['cirrusinsight.com', 'Cirrus Insight'],
  ['mailshake.com', 'Mailshake'],
  // ---- Product analytics and data pipelines
  ['mixpanel.com', 'Mixpanel'],
  ['mxpnl.com', 'Mixpanel'],
  ['segment.io', 'Segment'],
  ['segment.com', 'Segment'],
  ['amplitude.com', 'Amplitude'],
  ['heapanalytics.com', 'Heap'],
  ['hotjar.com', 'Hotjar'],
  ['fullstory.com', 'FullStory'],
  ['clarity.ms', 'Microsoft Clarity'],
  // ---- Ad networks and audience measurement
  ['google-analytics.com', 'Google Analytics'],
  ['googleadservices.com', 'Google Ads'],
  ['googlesyndication.com', 'Google Ads'],
  ['doubleclick.net', 'Google (DoubleClick)'],
  ['omtrdc.net', 'Adobe Analytics'],
  ['2o7.net', 'Adobe Analytics'],
  ['demdex.net', 'Adobe Audience Manager'],
  ['everesttech.net', 'Adobe Advertising'],
  ['scorecardresearch.com', 'Comscore'],
  ['quantserve.com', 'Quantcast'],
  ['criteo.com', 'Criteo'],
  ['criteo.net', 'Criteo'],
  ['adsrvr.org', 'The Trade Desk'],
  ['taboola.com', 'Taboola'],
  ['outbrain.com', 'Outbrain'],
  ['bat.bing.com', 'Microsoft Advertising'],
  ['ads-twitter.com', 'X Ads'],
  ['analytics.twitter.com', 'X Analytics'],
  ['adnxs.com', 'Xandr'],
  ['rubiconproject.com', 'Magnite'],
  ['pubmatic.com', 'PubMatic'],
  ['bluekai.com', 'Oracle BlueKai'],
  ['krxd.net', 'Salesforce DMP'],
  ['liveintent.com', 'LiveIntent'],
  ['liadm.com', 'LiveIntent'],
  ['rlcdn.com', 'LiveRamp'],
  ['agkn.com', 'Neustar'],
  ['tapad.com', 'Tapad']
]

/** Domains that serve real content too: match only when the URL path looks like a beacon. */
export const TRACKER_PATH_DOMAINS: ReadonlyArray<{ domain: string; service: string; path: RegExp }> = [
  { domain: 'list-manage.com', service: 'Mailchimp', path: /\/track\/(?:open|click)/i },
  { domain: 'mailchimp.com', service: 'Mailchimp', path: /\/track\//i },
  { domain: 'sendgrid.net', service: 'SendGrid', path: /\/wf\/(?:open|click)/i },
  { domain: 'createsend.com', service: 'Campaign Monitor', path: /\/t\//i },
  { domain: 'postmarkapp.com', service: 'Postmark', path: /\/track/i },
  { domain: 'exacttarget.com', service: 'Salesforce Marketing Cloud', path: /\/(?:trk|open\.aspx)/i },
  { domain: 'sailthru.com', service: 'Sailthru', path: /\/beacon/i },
  { domain: 'facebook.com', service: 'Meta', path: /\/(?:tr\/?$|tr\?|email_open_log_pic\.php)/i },
  { domain: 'facebookmail.com', service: 'Meta', path: /\/email_open/i },
  { domain: 'linkedin.com', service: 'LinkedIn', path: /\/emimp\//i },
  { domain: 'substack.com', service: 'Substack', path: /\/api\/v1\/email\/open/i },
  { domain: 'lemlist.com', service: 'lemlist', path: /\/api\/opened/i },
  { domain: 'iterable.com', service: 'Iterable', path: /\/track/i },
  { domain: 'sendinblue.com', service: 'Brevo (Sendinblue)', path: /\/track/i },
  { domain: 'activehosted.com', service: 'ActiveCampaign', path: /\/lt\.php|\/open/i },
  { domain: 'helpscout.net', service: 'Help Scout', path: /\/beacon/i },
  { domain: 'zoho.com', service: 'Zoho', path: /\/(?:open|track)/i }
]

/** Host patterns for vendors that rotate numbered domains (`cmail19.com`, `sendibt2.com`…). */
export const TRACKER_HOST_PATTERNS: ReadonlyArray<{ re: RegExp; service: string }> = [
  { re: /(?:^|\.)cmail\d+\.com$/i, service: 'Campaign Monitor' },
  { re: /(?:^|\.)sendib[a-z]\d+\.com$/i, service: 'Brevo (Sendinblue)' }
]

/** Path shapes that name an open beacon on any host. */
export const BEACON_PATHS: readonly RegExp[] = [
  /\/(?:wf|track|trk|tracking|trace|e)\/o(?:pen)?\/[^/?]{6,}/i,
  /\/track\/open/i,
  /\/open\.(?:gif|png|php|aspx|jsp)(?:$|\?)/i,
  /\/(?:pixel|beacon|spacer|blank)\.(?:gif|png)(?:$|\?)/i,
  /\/(?:o|open|opens)\/[A-Za-z0-9_-]{20,}(?:\.(?:gif|png))?$/i
]

/**
 * Hosts that route *clicks* through a redirect. Never treated as trackers for images, but a link
 * to one of these with display text naming a different domain is normal marketing behaviour, so
 * the phishing hint stays quiet for them (the hover pill still shows the true host).
 */
export const CLICK_REDIRECT_SUFFIXES: readonly string[] = [
  'list-manage.com', 'mandrillapp.com', 'sendgrid.net', 'hubspotlinks.com', 'hubspotemail.net',
  'exct.net', 'rs6.net', 'klclick.com', 'klclick1.com', 'klclick2.com', 'klclick3.com', 'awstrack.me',
  'pstmrk.it', 'mjt.lu', 'links.iterable.com', 'customeriomail.com', 'intercom-clicks.com',
  'sparkpostmail.com', 'spgo.io', 'mailgun.org', 'sendibt2.com', 'sendibt3.com', 'sendibm1.com',
  'createsend.com', 'convertkit-mail.com', 'convertkit-mail2.com', 'mlsend.com', 'e2ma.net',
  'pardot.com', 'mktoresp.com', 'bit.ly', 't.co', 'lnkd.in', 'links.mail.beehiiv.com',
  'urldefense.com', 'safelinks.protection.outlook.com'
]
