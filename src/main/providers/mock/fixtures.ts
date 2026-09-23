import type { Address, Label, LabelColor, Message, SystemRole } from '@shared/types'
import { makeId } from '@shared/types'
import type { NormalizedThread } from '../types'

/** `${remoteMessageId}:${attachmentId}` -> raw content, for attachments whose `attach` entry set `content`. */
export const MOCK_ATTACHMENT_CONTENT = new Map<string, string>()

const H = 3600_000
const D = 24 * H

interface Tpl {
  key: string
  subject: string
  labels?: string[] // user label names
  roles?: SystemRole[]
  unread?: boolean
  starred?: boolean
  ago: number // ms ago for last message
  /** `content`, when set, is what MockAdapter.fetchAttachment() returns (see MOCK_ATTACHMENT_CONTENT below) — otherwise it's generic placeholder text. */
  attach?: { filename: string; mimeType: string; size: number; content?: string }[]
  msgs: { from: Address; to?: Address[]; cc?: Address[]; html: string; agoOffset?: number; unsubscribe?: string }[]
}

const p = (name: string, email: string): Address => ({ name, email })
const wrap = (inner: string): string =>
  `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#222">${inner}</div>`

const newsletterHtml = (title: string, body: string): string =>
  `<table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f5f4"><tr><td align="center" style="padding:24px 12px">
  <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;font-family:Georgia,serif"><tr><td style="padding:32px">
  <h1 style="font-size:24px;margin:0 0 12px">${title}</h1><p style="font-size:16px;line-height:1.6;color:#333">${body}</p>
  <p style="margin-top:24px"><a href="https://example.com" style="background:#2383e2;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;font-family:sans-serif;font-size:14px">Read more</a></p>
  <p style="color:#999;font-size:12px;font-family:sans-serif;margin-top:32px">You received this because you subscribed. <a href="https://example.com/unsub">Unsubscribe</a></p>
  </td></tr></table></td></tr></table>`

/** A realistic Teams-style meeting invite .ics, ~1 week out, so InviteCard has something real to parse. */
function teamsInvite(me: Address): string {
  const start = new Date(Date.now() + 7 * D)
  start.setUTCHours(15, 0, 0, 0)
  const end = new Date(start.getTime() + 30 * 60_000)
  const fmt = (d: Date): string => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return [
    'BEGIN:VCALENDAR', 'PRODID:-//Mock//Teams//EN', 'VERSION:2.0', 'METHOD:REQUEST',
    'BEGIN:VEVENT',
    'UID:mock-design-review-001@acme.example',
    'SEQUENCE:0',
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    'SUMMARY:Design review',
    'LOCATION:Microsoft Teams Meeting',
    'ORGANIZER;CN=Jordan Lee:mailto:jordan@acme.example',
    `ATTENDEE;CN=${me.name};PARTSTAT=NEEDS-ACTION:mailto:${me.email}`,
    'ATTENDEE;CN=Jordan Lee;PARTSTAT=ACCEPTED:mailto:jordan@acme.example',
    'END:VEVENT', 'END:VCALENDAR', ''
  ].join('\r\n')
}

export const USER_LABELS: { name: string; color: LabelColor }[] = [
  { name: 'Newsletters', color: 'purple' },
  { name: 'Receipts', color: 'green' },
  { name: 'Travel', color: 'blue' },
  { name: 'Team', color: 'orange' },
  { name: 'Personal', color: 'pink' },
  { name: 'To read', color: 'yellow' }
]

function personalTemplates(me: Address): Tpl[] {
  return [
    { key: 'p1', subject: 'Dinner Saturday?', labels: ['Personal'], unread: true, ago: 25 * 60_000, roles: ['inbox'],
      msgs: [{ from: p('Léa Martin', 'lea.martin@example.com'), html: wrap('<p>Hey! Are you free Saturday evening? A few of us are trying the new place on rue Oberkampf around 8pm. 🍝</p><p>Let me know!<br>Léa</p>') }] },
    { key: 'p2', subject: 'Your flight to Lisbon is confirmed', labels: ['Travel', 'Receipts'], unread: true, starred: true, ago: 3 * H, roles: ['inbox'],
      attach: [{ filename: 'boarding-pass.pdf', mimeType: 'application/pdf', size: 184_320 }],
      msgs: [{ from: p('Air Meridian', 'no-reply@airmeridian.example'), html: wrap('<h2 style="margin:0 0 8px">Booking confirmed ✈️</h2><table cellpadding="6" style="border-collapse:collapse"><tr><td>Flight</td><td><b>AM 412</b></td></tr><tr><td>Route</td><td>CDG → LIS</td></tr><tr><td>Departure</td><td>Fri 14 Nov, 07:35</td></tr><tr><td>Booking ref</td><td><code>X7Q2LM</code></td></tr></table><p>Have a great trip!</p>') }] },
    { key: 'p3', subject: 'The Sunday Digest — issue #212', labels: ['Newsletters', 'To read'], ago: 9 * H, roles: ['inbox'],
      msgs: [{ from: p('The Sunday Digest', 'digest@sundaydigest.example'), unsubscribe: '<https://example.com/unsub>', html: newsletterHtml('Why slow software feels fast', 'Great interfaces respect attention. This week we look at optimistic updates, keyboard-first design, and why the best tools disappear.') }] },
    { key: 'p4', subject: 'Receipt from Corner Coffee', labels: ['Receipts'], ago: 1 * D + 2 * H, roles: ['inbox'],
      msgs: [{ from: p('Corner Coffee', 'receipts@cornercoffee.example'), html: wrap('<p>Thanks for stopping by!</p><table cellpadding="4"><tr><td>Flat white</td><td align="right">€3.80</td></tr><tr><td>Croissant</td><td align="right">€2.40</td></tr><tr><td><b>Total</b></td><td align="right"><b>€6.20</b></td></tr></table>') }] },
    { key: 'p5', subject: 'Re: Apartment viewing on Thursday', unread: false, ago: 1 * D + 6 * H, roles: ['inbox'],
      msgs: [
        { from: me, to: [p('Camille Roy', 'camille.roy@example.com')], agoOffset: 4 * H, html: wrap('<p>Hi Camille, would Thursday at 6pm work for a viewing of the 2-bedroom?</p>') },
        { from: p('Camille Roy', 'camille.roy@example.com'), to: [me], agoOffset: 2 * H, html: wrap('<p>Thursday 6pm is perfect. I\'ll meet you at the front door — the code is <b>4471</b>.</p><blockquote style="border-left:3px solid #ddd;margin:8px 0;padding-left:12px;color:#666">Hi Camille, would Thursday at 6pm work for a viewing of the 2-bedroom?</blockquote>') },
        { from: me, to: [p('Camille Roy', 'camille.roy@example.com')], agoOffset: 0, html: wrap('<p>Great, see you then!</p>') }
      ] },
    { key: 'p6', subject: 'Your monthly statement is ready', labels: ['Receipts'], ago: 2 * D, roles: ['inbox'], attach: [{ filename: 'statement-october.pdf', mimeType: 'application/pdf', size: 402_112 }],
      msgs: [{ from: p('Nordbank', 'statements@nordbank.example'), html: wrap('<p>Your October statement is now available. Log in to view it securely.</p>') }] },
    { key: 'p7', subject: 'Photos from the weekend 📸', labels: ['Personal'], ago: 3 * D, roles: ['inbox'],
      attach: [{ filename: 'IMG_2041.jpg', mimeType: 'image/jpeg', size: 2_402_112 }, { filename: 'IMG_2042.jpg', mimeType: 'image/jpeg', size: 2_012_004 }],
      msgs: [{ from: p('Marc Dubois', 'marc.dubois@example.com'), html: wrap('<p>Here are the best ones. The sunset one is my favorite!</p>') }] },
    { key: 'p8', subject: 'Security alert: new sign-in from Chrome on Mac', unread: false, ago: 4 * D, roles: ['inbox'],
      msgs: [{ from: p('Accounts', 'security@accounts.example'), html: wrap('<p>We noticed a new sign-in to your account from Chrome on macOS in Paris, France. If this was you, no action is needed.</p>') }] },
    { key: 'p9', subject: 'Welcome to Loom & Co.', labels: ['Newsletters'], ago: 6 * D, roles: ['archive'],
      msgs: [{ from: p('Loom & Co.', 'hello@loomco.example'), unsubscribe: '<https://example.com/unsub>', html: newsletterHtml('Welcome aboard!', 'Here is a 10% discount for your first order. Handcrafted textiles, delivered.') }] },
    { key: 'p10', subject: 'Weekend hike — trail map attached', ago: 8 * D, roles: ['archive'], starred: true, attach: [{ filename: 'trail-map.png', mimeType: 'image/png', size: 892_000 }],
      msgs: [{ from: p('Théo Bernard', 'theo.bernard@example.com'), html: wrap('<p>Here is the route we discussed. About 14km with 600m of elevation. Bring water!</p>') }] },
    { key: 'p11', subject: 'You won a free cruise!!!', ago: 5 * D, roles: ['spam'], unread: true,
      msgs: [{ from: p('Prize Center', 'winner@prizes-now.example'), html: wrap('<p>Click here to claim your prize.</p>') }] },
    { key: 'p12', subject: 'Draft: Birthday plans', ago: 1 * H, roles: ['drafts'],
      msgs: [{ from: me, to: [p('Léa Martin', 'lea.martin@example.com')], html: wrap('<p>So I was thinking we could do something low-key…</p>') }] },
    { key: 'p13', subject: 'Re: Bike repair quote', ago: 2 * D + 5 * H, roles: ['sent'],
      msgs: [{ from: me, to: [p('Vélo Atelier', 'atelier@velo.example')], html: wrap('<p>Thanks, the quote works for me. Can I drop it off Monday?</p>') }] }
  ]
}

function workTemplates(me: Address): Tpl[] {
  return [
    { key: 'w1', subject: 'Q4 roadmap review — decisions needed', labels: ['Team'], unread: true, starred: true, ago: 40 * 60_000, roles: ['inbox'],
      msgs: [
        { from: p('Jordan Lee', 'jordan@acme.example'), to: [me, p('Priya Shah', 'priya@acme.example')], agoOffset: 3 * H, html: wrap('<p>Team — before Thursday I\'d like us to agree on three things:</p><ol><li>Ship the new onboarding in November</li><li>Defer the analytics rewrite to Q1</li><li>Hire one more designer</li></ol><p>Thoughts?</p>') },
        { from: p('Priya Shah', 'priya@acme.example'), to: [me, p('Jordan Lee', 'jordan@acme.example')], agoOffset: 40 * 60_000, html: wrap('<p>+1 on 1 and 2. On hiring — can we look at budget first?</p>') }
      ] },
    { key: 'w2', subject: '[acme/web] Pull request #482: Fix flaky checkout test', labels: ['Team'], unread: true, ago: 2 * H, roles: ['inbox'],
      msgs: [{ from: p('GitHub', 'notifications@github.example'), html: wrap('<p><b>sam-k</b> requested your review on <a href="https://example.com">#482</a>.</p><pre style="background:#f6f8fa;padding:12px;border-radius:6px">- await page.click(\'#pay\')\n+ await page.getByRole(\'button\', { name: \'Pay\' }).click()</pre>') }] },
    { key: 'w2b', subject: 'Invitation: Design review @ Thu Oct 8, 3:00 PM', labels: ['Team'], unread: true, ago: 30 * 60_000, roles: ['inbox'],
      attach: [{ filename: 'invite.ics', mimeType: 'text/calendar; method=REQUEST', size: 640, content: teamsInvite(me) }],
      msgs: [{ from: p('Jordan Lee', 'jordan@acme.example'), to: [me], html: wrap('<p>Sending an invite for the design review — agenda attached to the calendar item. Let me know if the time doesn\'t work.</p>') }] },
    { key: 'w3', subject: 'Invoice #2041 — October consulting', labels: ['Receipts'], ago: 5 * H, roles: ['inbox'], attach: [{ filename: 'invoice-2041.pdf', mimeType: 'application/pdf', size: 88_100 }],
      msgs: [{ from: p('Studio Nova', 'billing@studionova.example'), html: wrap('<p>Please find attached invoice <b>#2041</b> for <b>€2,400.00</b>, due in 14 days.</p>') }] },
    { key: 'w4', subject: 'Design critique notes', labels: ['Team'], ago: 1 * D + 1 * H, roles: ['inbox'],
      msgs: [{ from: p('Amara Okafor', 'amara@acme.example'), to: [me], html: wrap('<p>Notes from today:</p><ul><li>Sidebar density feels right</li><li>Keyboard shortcuts need a cheat sheet</li><li>Empty states could be warmer</li></ul>') }] },
    { key: 'w5', subject: 'Product Weekly: the rise of calm software', labels: ['Newsletters', 'To read'], ago: 1 * D + 8 * H, roles: ['inbox'],
      msgs: [{ from: p('Product Weekly', 'editor@productweekly.example'), unsubscribe: '<https://example.com/unsub>', html: newsletterHtml('The rise of calm software', 'Tools that stay out of your way are winning. We interviewed six teams about what "calm" means in practice.') }] },
    { key: 'w6', subject: 'Calendar: Sprint planning (Mon 10:00)', ago: 2 * D, roles: ['inbox'],
      msgs: [{ from: p('Calendar', 'calendar@acme.example'), html: wrap('<p><b>Sprint planning</b><br>Monday 10:00–11:00<br>Room: Atlas · <a href="https://example.com">Join video call</a></p>') }] },
    { key: 'w7', subject: 'Re: Customer interview schedule', labels: ['Team'], ago: 3 * D, roles: ['inbox'],
      msgs: [
        { from: p('Sam Keller', 'sam@acme.example'), to: [me], agoOffset: 5 * H, html: wrap('<p>Can you take the 2pm slot on Wednesday?</p>') },
        { from: me, to: [p('Sam Keller', 'sam@acme.example')], agoOffset: 0, html: wrap('<p>Yes — I\'ll be there.</p>') }
      ] },
    { key: 'w8', subject: 'Welcome to the team, Anthony!', ago: 12 * D, roles: ['archive'],
      msgs: [{ from: p('People Ops', 'people@acme.example'), html: wrap('<p>We\'re thrilled to have you! Your first-week checklist is attached below.</p>') }] },
    { key: 'w9', subject: 'Re: Pricing page copy', ago: 6 * D, roles: ['sent'],
      msgs: [{ from: me, to: [p('Jordan Lee', 'jordan@acme.example')], html: wrap('<p>Updated the headline — take a look when you have a minute.</p>') }] },
    { key: 'w10', subject: 'Reminder: expense reports due Friday', ago: 7 * D, roles: ['archive'],
      msgs: [{ from: p('Finance', 'finance@acme.example'), html: wrap('<p>Please submit all expense reports by end of day Friday.</p>') }] }
  ]
}

export interface MockMailbox {
  labels: Label[]
  threads: NormalizedThread[]
}

export function buildMockMailbox(accountId: string, email: string, name: string, flavor: 'personal' | 'work'): MockMailbox {
  const now = Date.now()
  const me: Address = { name, email }
  const roles: { role: SystemRole; name: string }[] = [
    { role: 'inbox', name: 'Inbox' }, { role: 'sent', name: 'Sent' }, { role: 'drafts', name: 'Drafts' },
    { role: 'trash', name: 'Trash' }, { role: 'spam', name: 'Spam' }, { role: 'important', name: 'Important' }
  ]
  const labels: Label[] = [
    ...roles.map((r) => ({ id: makeId(accountId, r.role.toUpperCase()), accountId, remoteId: r.role.toUpperCase(), name: r.name, kind: 'system' as const, role: r.role })),
    ...USER_LABELS.map((u) => ({ id: makeId(accountId, `L_${u.name}`), accountId, remoteId: `L_${u.name}`, name: u.name, color: u.color, kind: 'user' as const }))
  ]
  const roleId = (r: SystemRole): string => makeId(accountId, r.toUpperCase())
  const tpls = flavor === 'personal' ? personalTemplates(me) : workTemplates(me)

  const threads: NormalizedThread[] = tpls.map((t) => {
    const tid = makeId(accountId, `T_${t.key}`)
    const labelIds = [
      ...(t.roles ?? ['inbox']).filter((r) => r !== 'archive').map(roleId),
      ...(t.labels ?? []).map((n) => makeId(accountId, `L_${n}`))
    ]
    const messages: Message[] = t.msgs.map((m, i) => {
      const date = now - t.ago - (m.agoOffset ?? 0) + (t.msgs.length - 1 - i === 0 ? 0 : 0)
      const isLast = i === t.msgs.length - 1
      const fromMe = m.from.email === email
      const text = m.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      return {
        id: makeId(accountId, `M_${t.key}_${i}`), threadId: tid, accountId, remoteId: `M_${t.key}_${i}`,
        from: m.from, to: m.to ?? [me], cc: m.cc ?? [], bcc: [], subject: t.subject, date: t.msgs.length > 1 ? now - t.ago - (m.agoOffset ?? 0) : date,
        snippet: text.slice(0, 140), bodyHtml: m.html, bodyText: text,
        attachments: isLast || t.msgs.length === 1 ? (t.attach ?? []).map((a, k) => {
          const id = `A${k}`
          if (a.content !== undefined) MOCK_ATTACHMENT_CONTENT.set(`M_${t.key}_${i}:${id}`, a.content)
          return { id, filename: a.filename, mimeType: a.mimeType, size: a.size, inline: false }
        }) : [],
        unread: !!t.unread && isLast && !fromMe, messageIdHeader: `<${t.key}.${i}@mock.local>`, listUnsubscribe: m.unsubscribe,
        labelIds, isDraft: (t.roles ?? []).includes('drafts')
      }
    })
    const last = messages[messages.length - 1]
    const participants: Address[] = []
    for (const m of messages) for (const a of [m.from, ...m.to]) if (!participants.some((x) => x.email === a.email)) participants.push(a)
    return {
      thread: {
        id: tid, accountId, remoteId: `T_${t.key}`, subject: t.subject, snippet: last.snippet, lastMessageAt: last.date,
        messageCount: messages.length, unread: !!t.unread, starred: !!t.starred, hasAttachments: (t.attach?.length ?? 0) > 0,
        labelIds, participants
      },
      messages
    }
  })
  return { labels, threads }
}
